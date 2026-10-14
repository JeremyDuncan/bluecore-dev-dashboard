// diagnose_test_failure: gathers the evidence an agent needs to explain a failing test run. The tool
// doesn't guess on its own; it returns the error output, what changed since the last passing run,
// the test's history (flaky or not), and hints from common error patterns, and the calling agent
// (Claude Code, the Ask-the-docs chat, …) turns that into a diagnosis.
import {z} from 'zod';
import {ciMetrics, failureStage, triggerName} from './ci-metrics.mjs';
import {fetchJobLog, rest} from './github.mjs';
import {allTestSuites, integrationTestData} from './live-api.mjs';

const MAX_BLOCK_LINES = 60;
const MAX_BLOCKS = 3;

const lines = (log) => log.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '').trimEnd());

// The output of the step that failed: from the last "##[group]Run …" before the first
// "##[error]Process completed" (GitHub's marker for a failed step) up to that marker.
export function failedStepOutput(all) {
  const end = all.findIndex((l) => /^##\[error\]Process completed with exit code/.test(l));
  if (end === -1) return all;
  let start = end;
  while (start > 0 && !/^##\[group\]Run /.test(all[start])) start--;
  return all.slice(start, end);
}

// Split test-runner output into one block per failing test: [{name, text}]
export function failureBlocks(out) {
  const blocks = [];
  const take = (startRe, endRe, nameOf) => {
    for (let i = 0; i < out.length; i++) {
      const m = out[i].match(startRe);
      if (!m) continue;
      let j = i + 1;
      while (j < out.length && !startRe.test(out[j]) && !(endRe && endRe.test(out[j]))) j++;
      blocks.push({name: nameOf(m), text: out.slice(i, j).join('\n').trim()});
      i = j - 1;
    }
  };
  // pytest: "____ test_name ____" sections under "= FAILURES =" / "= ERRORS ="
  const pyStart = out.findIndex((l) => /^=+ (FAILURES|ERRORS) =+$/.test(l));
  if (pyStart !== -1) {
    const section = out.slice(pyStart);
    const stop = section.findIndex((l, k) => k > 0 && /^=+ (short test summary|warnings summary|.* in [\d.]+s)/.test(l));
    const body = stop === -1 ? section : section.slice(0, stop);
    const sub = [];
    for (let i = 0; i < body.length; i++) {
      const m = body[i].match(/^_{3,} (.+?) _{3,}$/);
      if (!m) continue;
      let j = i + 1;
      while (j < body.length && !/^_{3,} .+ _{3,}$/.test(body[j]) && !/^=+ /.test(body[j])) j++;
      sub.push({name: m[1], text: body.slice(i, j).join('\n').trim()});
      i = j - 1;
    }
    if (sub.length) return sub;
  }
  // Playwright: "  1) [chromium] › path:4:5 › Title"
  take(/^\s+\d+\) \[[^\]]+\] › (.+)$/, /^\s+\d+ (failed|passed|flaky)\b/, (m) => m[1].trim());
  if (blocks.length) return blocks;
  // Vitest: " FAIL  src/a.test.js > group > name" (in the "Failed Tests" section)
  take(/^\s*FAIL\s+(\S+ > .+)$/, /^\s*(Test Files|⎯{3,} Failed Tests|Tests\s{2})/, (m) => m[1].trim());
  if (blocks.length) return blocks;
  // Jest: "  ● Group › name"
  take(/^\s*● (.+›.+)$/, /^\s*(PASS|FAIL)\s|^\s*Test Suites:|^Summary:/, (m) => m[1].trim());
  return blocks;
}

// Lines that look like errors, for steps that aren't tests (lint, type check, build, setup)
function errorLines(out) {
  const hits = out.filter((l) => /error|Error|ERROR|failed|FAILED|✗|×|exception|Exception|\bE\s{2,}|warning: /.test(l) && !/^##\[/.test(l));
  return (hits.length ? hits : out).slice(-MAX_BLOCK_LINES).join('\n');
}

const trimBlock = (text) => {
  const l = text.split('\n');
  return l.length > MAX_BLOCK_LINES ? [...l.slice(0, 15), `… (${l.length - MAX_BLOCK_LINES} lines skipped) …`, ...l.slice(-(MAX_BLOCK_LINES - 15))].join('\n') : text;
};

// Likely causes from common error patterns. Hints, not conclusions: the agent weighs them.
const HINTS = [
  [/ModuleNotFoundError|ImportError|Cannot find module|ERR_MODULE_NOT_FOUND|No module named/, 'A module can\'t be imported: a missing or renamed dependency, a changed import path, or a lock file that is out of date.'],
  [/ECONNREFUSED|Connection refused|ConnectionError|ConnectTimeout|ReadTimeout|TimeoutError|Timeout \d+ms exceeded|timed out|503 Service Unavailable|502 Bad Gateway|504 Gateway Timeout|Gateway Timeout|failed to fetch oauth token/i, 'A service wasn\'t reachable or was too slow: the service may not have been ready yet (startup order, health checks), or this is a flaky network or infrastructure failure. Check whether the same test passed on a rerun.'],
  [/\b401\b|\b403\b|Unauthorized|Forbidden|invalid_grant|invalid_client|token (is )?(expired|invalid)|Keycloak/i, 'Authentication failed: Keycloak realm or client settings, an expired or missing token, or changed roles.'],
  [/OperationalError|psycopg|relation ".+" does not exist|UndefinedTable|UndefinedColumn|alembic|migration/i, 'A database problem: a missing migration, a schema change the test data doesn\'t match, or the database not being ready.'],
  [/AssertionError|assert .+ ==|expect\(.+\)\.to|Expected:|Received:|toEqual|toBe\(|toContainText|toHaveText/, 'An assertion failed: the code now behaves differently from what the test expects. Compare with the changes since the last passing run: either the change broke behavior, or the test needs updating.'],
  [/KeyError|AttributeError|TypeError|is not a function|Cannot read propert|undefined is not|NoneType/, 'Code got data in a shape it didn\'t expect: a renamed field, a changed response format, or a missing value. Often caused by a change in another service (the API or bluecore-models).'],
  [/ValidationError|pydantic|422 Unprocessable/i, 'Validation failed: a request or model no longer matches its schema, often after a bluecore-models or API change.'],
  [/ruff|eslint|prettier|would reformat|Found \d+ error/i, 'Lint or formatting failed (the tests may not have run): run the linter locally and fix the reported lines.'],
  [/mypy|ty check|error: .+ \[[a-z-]+\]|Type error|TS\d{4}/i, 'Type checking failed (the tests may not have run): fix the reported types.'],
  [/No space left on device|Killed|out of memory|OOMKilled|rate limit|API rate limit exceeded|toomanyrequests/i, 'An infrastructure limit was hit (disk, memory or a rate limit), not a code problem. Rerunning usually helps.'],
  [/manifest unknown|pull access denied|failed to solve|ERROR \[.+\] RUN|docker build/i, 'An image failed to build or pull: check the Dockerfile change, the base image, or the image tag the stack uses (see the Version Drift page).'],
];

export function failureHints(text) {
  return HINTS.filter(([re]) => re.test(text)).map(([, hint]) => hint);
}

const day = (iso) => iso?.slice(0, 16).replace('T', ' ');

export async function diagnoseFailure(suite, {run: runNumber, test} = {}, token) {
  const {data} = await integrationTestData(suite);
  const runs = data.runs;
  const run = runNumber
    ? runs.find((r) => r.number === runNumber)
    : runs.find((r) => r.conclusion === 'failure' && (!test || r.tests?.failures?.some((f) => f.test.includes(test)))) ?? runs.find((r) => r.conclusion === 'failure');
  if (!run) return `No ${runNumber ? `run #${runNumber}` : 'failed run'} in the last ${runs.length} runs of ${suite.title ?? suite.repo}.`;

  const out = [];
  out.push(`# ${suite.title ?? suite.repo}: run #${run.number} ${run.conclusion}`);
  out.push(`- Run: ${run.url}`);
  out.push(`- Started ${day(run.createdAt)} UTC by ${triggerName(run)}${run.actor ? ` (${run.actor})` : ''} on ${run.branch ?? '?'} at commit ${run.sha}: "${run.title}"`);
  out.push(`- Failed in: ${failureStage(run)}${run.failedSteps?.length ? ` (${run.failedSteps.join(', ')})` : ''}`);
  if (run.tests) out.push(`- Tests: ${run.tests.passed} passed, ${run.tests.failed} failed, ${run.tests.errors} errors, ${run.tests.skipped} skipped`);

  // Error output from the log of the failed job
  let evidence = '';
  try {
    const jobs = await rest(`https://api.github.com/repos/${suite.org}/${suite.repo}/actions/runs/${run.id}/jobs?per_page=50`, token);
    const job = jobs.jobs.find((j) => j.conclusion === 'failure');
    if (!job) {
      out.push('', jobs.jobs.length ? 'No failed job found in this run.' : "No job started in this run: it failed before running (often a workflow file error or a dependency-update PR that couldn't start).");
    } else {
      const output = failedStepOutput(lines(await fetchJobLog({org: suite.org, repo: suite.repo, jobId: job.id}, token)));
      const blocks = failureBlocks(output);
      const wanted = test ? blocks.filter((b) => b.name.includes(test) || b.text.includes(test)) : blocks;
      out.push('', `## Error output (job "${job.name}")`);
      if (wanted.length) {
        for (const b of wanted.slice(0, MAX_BLOCKS)) {
          out.push('', `### ${b.name}`, '```text', trimBlock(b.text), '```');
          evidence += `${b.text}\n`;
        }
        if (wanted.length > MAX_BLOCKS) out.push('', `(${wanted.length - MAX_BLOCKS} more failing tests not shown; pass \`test\` to pick one.)`);
      } else {
        const text = errorLines(output);
        out.push('', '```text', text, '```');
        evidence += text;
      }
    }
  } catch (err) {
    out.push('', `Couldn't read the job log: ${err.message} (GitHub keeps logs for 90 days).`);
  }

  // What changed since the last passing run
  const index = runs.indexOf(run);
  const lastPass = runs.slice(index + 1).find((r) => r.conclusion === 'success');
  out.push('', '## What changed since the last passing run');
  if (!lastPass) {
    out.push(`No passing run in the last ${runs.length} runs.`);
  } else if (lastPass.sha === run.sha) {
    out.push(`Run #${lastPass.number} passed on the **same commit** (${run.sha}): the code didn't change. Suspect flakiness, test data or another service${suite.kind === 'integration' ? ` (this run was started by "${triggerName(run)}", so check that repo's recent changes)` : ''}.`);
  } else {
    try {
      const cmp = await rest(`https://api.github.com/repos/${suite.org}/${suite.repo}/compare/${lastPass.sha}...${run.sha}`, token);
      out.push(`Last pass: run #${lastPass.number} at ${lastPass.sha} (${day(lastPass.createdAt)}). ${cmp.ahead_by} commit(s) since, ${cmp.files?.length ?? 0} file(s) changed: ${cmp.html_url}`);
      for (const c of (cmp.commits ?? []).slice(-10).reverse()) out.push(`- ${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]} (${c.author?.login ?? c.commit.author?.name})`);
      const files = (cmp.files ?? []).slice(0, 25).map((f) => `${f.filename} (+${f.additions} −${f.deletions})`);
      if (files.length) out.push('', `Files: ${files.join(', ')}${cmp.files.length > 25 ? ', …' : ''}`);
    } catch (err) {
      out.push(`Couldn't compare ${lastPass.sha}...${run.sha}: ${err.message}`);
    }
    if (suite.kind === 'integration') out.push('', `This is the integration suite: it tests the stack against the other repos, so the cause may be in the repo that started the run ("${triggerName(run)}"). Check that repo's recent changes too.`);
  }

  // History of the failing tests: how often, since when, flaky?
  const failing = (run.tests?.failures ?? []).filter((f) => !test || f.test.includes(test)).slice(0, 5);
  if (failing.length) {
    const m = ciMetrics(data);
    out.push('', '## Test history');
    for (const f of failing) {
      const stats = m.topFailingTests.find((t) => t.test === f.test);
      const flaky = runs.some((r) => r.sha === run.sha && r.id !== run.id && r.tests && !r.tests.failures.some((x) => x.test === f.test));
      out.push(
        `- \`${f.test}\`: failed ${stats?.failures ?? 1}× in the runs read${stats?.failingNow ? ', still failing' : stats?.passedSince ? `, passing again since ${day(stats.passedSince)}` : ''}.` +
          (flaky ? ' **Passed in another run of the same commit: likely flaky.**' : ''),
      );
    }
  }

  const hints = failureHints(`${evidence}\n${(run.failedSteps ?? []).join('\n')}`);
  out.push('', '## Hints (from common error patterns, not conclusions)');
  out.push(...(hints.length ? hints.map((h) => `- ${h}`) : ['- No common pattern matched; read the error output above.']));
  out.push(
    '',
    '## Next steps for the agent',
    `Explain the most likely cause in plain words, with your confidence. Use get_file (repo "${suite.repo}" or the repo that changed) to read the failing test and the changed files before concluding, and suggest a concrete fix or the next thing to check.`,
  );
  return out.join('\n');
}

export function registerDiagnoseTool(server) {
  const suites = allTestSuites();
  if (!suites.length) return;
  server.registerTool(
    'diagnose_test_failure',
    {
      title: 'Diagnose a failing test run',
      description:
        "Evidence for why a test run failed, in the integration suite or a repo's own tests: the failing tests' error output (traceback / assertion), the failed step for lint, type check or build failures, commits and files changed since the last passing run, whether a test is flaky (passed on the same commit), and hints from common error patterns. " +
        `Suites: ${suites.map((s) => s.title ?? s.repo).join(', ')}. Use it, then read the relevant files with get_file, and explain the likely cause and a fix.`,
      inputSchema: {
        suite: z.string().optional().describe('Suite title or repo, e.g. "Integration Tests", "bluecore_api" (default: the integration suite)'),
        run: z.number().int().optional().describe('Run number (default: the latest failed run)'),
        test: z.string().optional().describe('Part of a test name or file, to focus on one failing test'),
      },
      annotations: {readOnlyHint: true, openWorldHint: true},
    },
    async ({suite, run, test}) => {
      const match = (fn) => suite && suites.find(fn);
      const s = match((x) => x.title === suite || x.slug === suite) || match((x) => x.repo === suite) || match((x) => (x.title ?? '').toLowerCase().includes(suite.toLowerCase())) || suites[0];
      try {
        return {content: [{type: 'text', text: await diagnoseFailure(s, {run, test}, process.env.GITHUB_TOKEN)}]};
      } catch (err) {
        return {content: [{type: 'text', text: `Couldn't diagnose ${s.title ?? s.repo}: ${err.message}`}], isError: true};
      }
    },
  );
}
