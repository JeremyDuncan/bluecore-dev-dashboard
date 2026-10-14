// Integration test metrics from a workflow's recent runs (see fetchWorkflowRuns in github.mjs).
// Pure functions, shared by the Integration Tests page and the MCP `integration_tests` tool.

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const DAY = 86400000;

// Which stage a failed run broke in, from its failed step names
export function failureStage(run) {
  const steps = (run.failedSteps ?? []).join(' ').toLowerCase();
  if (!steps) return run.tests?.failed || run.tests?.errors ? 'Tests' : 'Unknown';
  if (/\btest/.test(steps)) return 'Tests';
  if (/build|image|docker|push/.test(steps)) return 'Image build';
  if (/checkout|set up|setup|install|log in|login|resolve|create|verify|show/.test(steps)) return 'Setup';
  return 'Other';
}

// "api-integration-38312527050-1" → "api-integration" (what triggered a dispatched run)
export function triggerName(run) {
  if (run.event !== 'workflow_dispatch') return run.event;
  const name = (run.title ?? '').replace(/[-_ ]?\d[\d-]*$/, '');
  // Dispatched by another repo's workflow: "api-integration", "sinopia-integration", …
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : 'manual';
}

export function ciMetrics(data, now = Date.now()) {
  const done = data.runs.filter((r) => r.status === 'completed');
  const decided = done.filter((r) => r.conclusion === 'success' || r.conclusion === 'failure');
  const rate = (runs) => (runs.length ? Math.round((runs.filter((r) => r.conclusion === 'success').length / runs.length) * 1000) / 10 : null);
  const within = (days) => decided.filter((r) => now - new Date(r.createdAt).getTime() <= days * DAY);

  const okDurations = done.filter((r) => r.conclusion === 'success' && r.durationSec).map((r) => r.durationSec);
  const recent = okDurations.slice(0, 10);
  const earlier = okDurations.slice(10, 20);

  // Consecutive successes (or failures) from the latest decided run
  let streak = 0;
  for (const r of decided) {
    if (r.conclusion !== decided[0]?.conclusion) break;
    streak++;
  }

  // Time from a failure to the next success (runs are newest first)
  const recoveries = [];
  for (let i = decided.length - 1; i > 0; i--) {
    if (decided[i].conclusion === 'failure' && (i === decided.length - 1 || decided[i + 1].conclusion === 'success')) {
      const fix = decided.slice(0, i).reverse().find((r) => r.conclusion === 'success');
      if (fix) recoveries.push((new Date(fix.updatedAt) - new Date(decided[i].createdAt)) / 60000);
    }
  }

  const failed = decided.filter((r) => r.conclusion === 'failure');
  const stages = {};
  for (const r of failed) stages[failureStage(r)] = (stages[failureStage(r)] ?? 0) + 1;

  // Failing tests across runs whose logs were read
  const tests = new Map();
  for (const r of done) {
    for (const f of r.tests?.failures ?? []) {
      const t = tests.get(f.test) ?? {test: f.test, area: f.test.split('/').slice(0, -1).join('/'), failures: 0, runs: [], lastFailedAt: null, lastMessage: '', shas: new Set()};
      t.failures++;
      t.runs.push(r.number);
      t.shas.add(r.sha);
      if (!t.lastFailedAt || r.createdAt > t.lastFailedAt) {
        t.lastFailedAt = r.createdAt;
        t.lastMessage = f.message;
      }
      tests.set(f.test, t);
    }
  }
  // Is each test still failing? Compare with the latest run whose test results were read
  const lastTested = done.find((r) => r.tests);
  const failingNow = new Set((lastTested?.tests?.failures ?? []).map((f) => f.test));
  const topTests = [...tests.values()]
    .map(({shas, ...t}) => {
      const passedSince = failingNow.has(t.test) ? null : done.find((r) => r.tests && r.createdAt > t.lastFailedAt && !r.tests.failures.some((f) => f.test === t.test))?.createdAt ?? null;
      return {...t, failingNow: failingNow.has(t.test), passedSince};
    })
    .sort((a, b) => Number(b.failingNow) - Number(a.failingNow) || b.failures - a.failures || (b.lastFailedAt ?? '').localeCompare(a.lastFailedAt ?? ''));

  const triggers = {};
  for (const r of data.runs) triggers[triggerName(r)] = (triggers[triggerName(r)] ?? 0) + 1;

  const latestTests = done.find((r) => r.tests)?.tests ?? null;
  const days = data.runs.length ? Math.max(1, (now - new Date(data.runs[data.runs.length - 1].createdAt).getTime()) / DAY) : 1;

  return {
    latest: data.runs[0] ?? null,
    window: {runs: data.runs.length, since: data.runs[data.runs.length - 1]?.createdAt ?? null, totalRuns: data.totalRuns},
    counts: {
      success: done.filter((r) => r.conclusion === 'success').length,
      failure: failed.length,
      cancelled: done.filter((r) => r.conclusion === 'cancelled').length,
      inProgress: data.runs.length - done.length,
    },
    passRate: {window: rate(decided), last7Days: rate(within(7)), last30Days: rate(within(30)), last20Runs: rate(decided.slice(0, 20))},
    duration: {
      medianSec: median(okDurations),
      p90Sec: percentile(okDurations, 90),
      recentMedianSec: median(recent),
      earlierMedianSec: median(earlier),
    },
    streak: {kind: decided[0]?.conclusion ?? null, runs: streak},
    recoveryMinutes: {median: median(recoveries.map(Math.round)), count: recoveries.length},
    runsPerDay: Math.round((data.runs.length / days) * 10) / 10,
    failureStages: stages,
    latestTests,
    testsReadFrom: done.filter((r) => r.tests).length,
    topFailingTests: topTests.slice(0, 15),
    failingNow: topTests.filter((t) => t.failingNow).length,
    distinctFailingTests: topTests.length,
    triggers,
  };
}

export const formatDuration = (sec) => {
  if (sec === null || sec === undefined) return '–';
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.round(sec)}s`;
};
