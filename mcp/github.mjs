// Reads GitHub Projects (v2) boards and repo issues, normalized for the "Project Status" pages.
//
// Shared by the sync (scripts/sync/project-status.mjs writes a snapshot into the site) and the
// MCP container (serves the same data live at /api/github/..., so the token never reaches a browser).
// Needs GITHUB_TOKEN; project boards also need the `read:project` scope.

const GRAPHQL = 'https://api.github.com/graphql';

function headers(token, accept = 'application/vnd.github+json') {
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return {Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'bluecore-dev-dashboard'};
}

async function graphql(query, variables, token) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {...headers(token), 'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const message = json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(/read:project/.test(message) ? 'token is missing the read:project scope (gh auth refresh -s read:project)' : message);
  }
  return json.data;
}

const PROJECT_QUERY = `
query($org: String!, $number: Int!, $after: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      title url public shortDescription
      field(name: "Status") { ... on ProjectV2SingleSelectField { options { name color } } }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isArchived type
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
            }
          }
          content {
            __typename
            ... on Issue {
              number title url state updatedAt closedAt
              repository { name }
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name color } }
              milestone { title dueOn }
              parent { number title url }
              subIssuesSummary { total completed }
            }
            ... on PullRequest {
              number title url state isDraft updatedAt closedAt
              repository { name }
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name color } }
              milestone { title dueOn }
            }
            ... on DraftIssue { title updatedAt assignees(first: 10) { nodes { login } } }
          }
        }
      }
    }
  }
}`;

// Built-in fields that are already part of `content`, so they aren't repeated as custom fields
const SKIP_FIELDS = new Set(['Title', 'Status']);

function normalizeItem(node) {
  const c = node.content ?? {};
  const fields = {};
  let status = null;
  for (const v of node.fieldValues?.nodes ?? []) {
    const name = v?.field?.name;
    if (!name) continue;
    const value = v.name ?? v.date ?? v.text ?? v.number ?? v.title;
    if (name === 'Status') status = value;
    else if (!SKIP_FIELDS.has(name) && value !== undefined && value !== null && value !== '') fields[name] = value;
  }
  const kind = c.__typename === 'PullRequest' ? 'pr' : c.__typename === 'DraftIssue' ? 'draft' : 'issue';
  return {
    kind,
    status,
    title: c.title ?? '(untitled)',
    number: c.number ?? null,
    url: c.url ?? null,
    state: c.isDraft ? 'DRAFT' : (c.state ?? null),
    repo: c.repository?.name ?? null,
    assignees: (c.assignees?.nodes ?? []).map((a) => a.login),
    labels: (c.labels?.nodes ?? []).map((l) => ({name: l.name, color: l.color})),
    milestone: c.milestone?.title ?? null,
    parent: c.parent ? {number: c.parent.number, title: c.parent.title, url: c.parent.url} : null,
    subIssues: c.subIssuesSummary?.total ? {total: c.subIssuesSummary.total, completed: c.subIssuesSummary.completed} : null,
    fields,
    updatedAt: c.updatedAt ?? null,
    closedAt: c.closedAt ?? null,
  };
}

export async function fetchProject({org, number}, token) {
  const items = [];
  let project;
  for (let after = null; ; ) {
    const data = await graphql(PROJECT_QUERY, {org, number, after}, token);
    project = data.organization?.projectV2;
    if (!project) throw new Error(`project ${org}/${number} not found (or no access)`);
    items.push(...project.items.nodes.filter((n) => !n.isArchived).map(normalizeItem));
    if (!project.items.pageInfo.hasNextPage) break;
    after = project.items.pageInfo.endCursor;
  }
  return {
    org,
    number,
    title: project.title,
    url: project.url,
    public: project.public,
    description: project.shortDescription || null,
    statuses: (project.field?.options ?? []).map((o) => ({name: o.name, color: o.color})),
    items,
    fetchedAt: new Date().toISOString(),
  };
}

async function rest(url, token) {
  const res = await fetch(url, {headers: headers(token)});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// includeForks: true, false, or a list of fork names to include
export async function listRepos(org, token, {includeArchived = false, includePrivate = false, includeForks = false, skipRepos = []} = {}) {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await rest(`https://api.github.com/orgs/${org}/repos?per_page=100&type=all&page=${page}`, token);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const skip = new Set(skipRepos);
  return repos
    .filter((r) => !r.fork || includeForks === true || (Array.isArray(includeForks) && includeForks.includes(r.name)))
    .filter((r) => !skip.has(r.name) && (includeArchived || !r.archived) && (includePrivate || !r.private))
    .map((r) => ({name: r.name, url: r.html_url, description: r.description, fork: r.fork}))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Open issues (not pull requests) for every repo in the org.
export async function fetchIssues({org, ...options}, token) {
  const repos = await listRepos(org, token, options);
  for (const repo of repos) {
    const issues = [];
    for (let page = 1; ; page++) {
      const batch = await rest(
        `https://api.github.com/repos/${org}/${repo.name}/issues?state=open&per_page=100&page=${page}&sort=updated`,
        token,
      );
      issues.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
    repo.issues = issues.map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      author: i.user?.login ?? null,
      assignees: (i.assignees ?? []).map((a) => a.login),
      labels: (i.labels ?? []).map((l) => ({name: l.name, color: l.color})),
      milestone: i.milestone?.title ?? null,
      comments: i.comments,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));
  }
  return {org, repos, fetchedAt: new Date().toISOString()};
}

// The highlights of a release: the first few list items of its notes ("What's Changed").
function highlights(body, max = 3) {
  return body
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1])
    .filter(Boolean)
    .slice(0, max);
}

// Latest GitHub releases of every repo in the org (perRepo each), newest first.
export async function fetchReleases({org, perRepo = 20, ...options}, token) {
  const repos = await listRepos(org, token, options);
  const releases = [];
  for (const repo of repos) {
    const batch = await rest(`https://api.github.com/repos/${org}/${repo.name}/releases?per_page=${perRepo}`, token);
    for (const r of batch.filter((x) => !x.draft)) {
      const body = (r.body ?? '').replace(/\r/g, '').trim();
      releases.push({
        repo: repo.name,
        tag: r.tag_name,
        name: r.name || r.tag_name,
        url: r.html_url,
        author: r.author?.login ?? null,
        prerelease: r.prerelease,
        publishedAt: r.published_at,
        highlights: highlights(body),
        body: body.length > 6000 ? `${body.slice(0, 6000)}\n\n…` : body,
      });
    }
  }
  releases.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return {org, repos: repos.map((r) => r.name), releases, fetchedAt: new Date().toISOString()};
}

// One issue or pull request with its description and latest comments.
export async function fetchIssue({org, repo, number, maxComments = 20}, token) {
  const issue = await rest(`https://api.github.com/repos/${org}/${repo}/issues/${number}`, token);
  const comments = issue.comments
    ? await rest(`https://api.github.com/repos/${org}/${repo}/issues/${number}/comments?per_page=100`, token)
    : [];
  return {
    repo,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    kind: issue.pull_request ? 'pull request' : 'issue',
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    author: issue.user?.login ?? null,
    assignees: (issue.assignees ?? []).map((a) => a.login),
    labels: (issue.labels ?? []).map((l) => l.name),
    milestone: issue.milestone?.title ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    body: (issue.body ?? '').replace(/\r/g, '').trim(),
    comments: comments.slice(-maxComments).map((c) => ({author: c.user?.login ?? null, createdAt: c.created_at, body: (c.body ?? '').replace(/\r/g, '').trim()})),
    totalComments: issue.comments,
  };
}

// GitHub issue/PR search, limited to one org (open and closed).
export async function searchIssues({org, query, state, limit = 20}, token) {
  // GitHub ORs repo: and org: qualifiers, so a query that names a repo isn't also scoped to the org
  const scope = /\brepo:\S+/.test(query) ? '' : `org:${org}`;
  const q = [scope, query, state && state !== 'all' ? `state:${state}` : ''].filter(Boolean).join(' ');
  const data = await rest(`https://api.github.com/search/issues?per_page=${Math.min(limit, 50)}&q=${encodeURIComponent(q)}`, token);
  return {
    total: data.total_count,
    items: data.items.map((i) => ({
      repo: i.repository_url.split('/').pop(),
      number: i.number,
      title: i.title,
      url: i.html_url,
      kind: i.pull_request ? 'pull request' : 'issue',
      state: i.state,
      assignees: (i.assignees ?? []).map((a) => a.login),
      labels: (i.labels ?? []).map((l) => l.name),
      updatedAt: i.updated_at,
    })),
  };
}

// --- Source code ----------------------------------------------------------------------------------

// Raw text of one file (default branch unless ref is given).
export async function fetchFile({org, repo, path: filePath, ref}, token) {
  const url = `https://api.github.com/repos/${org}/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const res = await fetch(url, {headers: headers(token, 'application/vnd.github.raw+json')});
  if (res.status === 404) throw new Error(`${repo}/${filePath} not found${ref ? ` at ${ref}` : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${repo}/${filePath}`);
  const body = await res.text();
  // A folder comes back as a JSON list of entries; a file comes back as its raw text
  if (body.trimStart().startsWith('[')) {
    try {
      const listing = JSON.parse(body);
      if (Array.isArray(listing) && listing.every((e) => e && e.type && e.name)) {
        return {folder: listing.map((e) => `${e.name}${e.type === 'dir' ? '/' : ''}`)};
      }
    } catch {
      // a file that happens to start with "[": fall through
    }
  }
  return {text: body};
}

// All file paths in a repo (optionally under a folder), from the git tree.
export async function fetchTree({org, repo, ref}, token) {
  const branch = ref ?? (await rest(`https://api.github.com/repos/${org}/${repo}`, token)).default_branch;
  const data = await rest(`https://api.github.com/repos/${org}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  return {ref: branch, truncated: data.truncated, files: data.tree.filter((t) => t.type === 'blob').map((t) => ({path: t.path, size: t.size}))};
}

// GitHub code search inside the org (default branches only). Returns paths with matching lines.
export async function searchCode({org, query, repo, limit = 20}, token) {
  const q = [query, repo ? `repo:${org}/${repo}` : `org:${org}`].join(' ');
  const res = await fetch(`https://api.github.com/search/code?per_page=${Math.min(limit, 50)}&q=${encodeURIComponent(q)}`, {
    headers: headers(token, 'application/vnd.github.text-match+json'),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from code search${res.status === 403 ? ' (rate limit: code search allows ~10 searches a minute)' : ''}`);
  const data = await res.json();
  return {
    total: data.total_count,
    items: data.items.map((i) => ({
      repo: i.repository.name,
      path: i.path,
      url: i.html_url,
      matches: (i.text_matches ?? []).map((m) => m.fragment.trim()).slice(0, 3),
    })),
  };
}

// --- Pull requests ------------------------------------------------------------------------------

// Pull requests merged since a date (YYYY-MM-DD), newest first.
export async function fetchMergedPRs({org, since, repo, limit = 100}, token) {
  const q = [`is:pr`, `is:merged`, `merged:>=${since}`, repo ? `repo:${org}/${repo}` : `org:${org}`].join(' ');
  const items = [];
  for (let page = 1; items.length < limit; page++) {
    const data = await rest(`https://api.github.com/search/issues?per_page=100&page=${page}&sort=updated&q=${encodeURIComponent(q)}`, token);
    items.push(...data.items);
    if (data.items.length < 100) break;
  }
  return items
    .slice(0, limit)
    .map((i) => ({
      repo: i.repository_url.split('/').pop(),
      number: i.number,
      title: i.title,
      url: i.html_url,
      author: i.user?.login ?? null,
      labels: (i.labels ?? []).map((l) => l.name),
      mergedAt: i.pull_request?.merged_at ?? i.closed_at,
    }))
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''));
}

// --- GitHub Actions -----------------------------------------------------------------------------

const runSummary = (r) => ({
  id: r.id,
  number: r.run_number,
  workflow: r.name,
  title: r.display_title,
  event: r.event,
  branch: r.head_branch,
  sha: r.head_sha?.slice(0, 7),
  status: r.status,
  conclusion: r.conclusion,
  attempt: r.run_attempt,
  actor: r.triggering_actor?.login ?? r.actor?.login ?? null,
  createdAt: r.created_at,
  startedAt: r.run_started_at,
  updatedAt: r.updated_at,
  durationSec: r.status === 'completed' && r.run_started_at ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) : null,
  url: r.html_url,
});

// Latest run of each workflow on a branch (default branch if omitted).
export async function fetchCiStatus({org, repo, branch}, token) {
  const info = await rest(`https://api.github.com/repos/${org}/${repo}`, token);
  const br = branch ?? info.default_branch;
  const data = await rest(`https://api.github.com/repos/${org}/${repo}/actions/runs?branch=${encodeURIComponent(br)}&per_page=50`, token);
  const latest = new Map();
  for (const r of data.workflow_runs) if (!latest.has(r.workflow_id)) latest.set(r.workflow_id, r);
  return {repo, branch: br, runs: [...latest.values()].map(runSummary)};
}

// The failed steps of a run, per job.
export async function fetchFailedSteps({org, repo, runId}, token) {
  const data = await rest(`https://api.github.com/repos/${org}/${repo}/actions/runs/${runId}/jobs?per_page=50`, token);
  return data.jobs
    .filter((j) => j.conclusion === 'failure')
    .map((j) => ({job: j.name, jobId: j.id, steps: j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name)}));
}

// Plain text of a job's log (GitHub redirects to a short-lived download link).
export async function fetchJobLog({org, repo, jobId}, token) {
  const res = await fetch(`https://api.github.com/repos/${org}/${repo}/actions/jobs/${jobId}/logs`, {headers: headers(token)});
  if (!res.ok) throw new Error(`HTTP ${res.status} for job log ${jobId}`);
  return (await res.text()).replace(/\x1b\[[0-9;]*m/g, ''); // strip terminal colors
}

// pytest results from a log: totals, duration and failing tests.
export function parsePytest(log) {
  const lines = log.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''));
  const summary = [...lines].reverse().find((l) => /^=+ .*\b(passed|failed|error|errors|skipped|deselected|no tests ran)\b.* in [\d.]+s/.test(l));
  if (!summary) return null;
  const count = (word) => Number(summary.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? 0);
  const failures = lines
    .filter((l) => /^(FAILED|ERROR) \S+::/.test(l))
    .map((l) => {
      // Test ids can contain spaces ("test_x[root => 200]"); the message follows the first " - "
      const m = l.match(/^(FAILED|ERROR) (.+?)(?: - (.*))?$/);
      return m && {kind: m[1].toLowerCase(), test: m[2].trim(), message: (m[3] ?? '').slice(0, 300)};
    })
    .filter(Boolean);
  return {
    passed: count('passed'),
    failed: count('failed'),
    errors: count('errors?'),
    skipped: count('skipped'),
    durationSec: Number(summary.match(/ in ([\d.]+)s/)?.[1] ?? 0),
    failures,
  };
}

// Recent runs of one workflow, with pytest results parsed from the logs of every failed run and of
// the latest `parseLogs` other completed runs. `logCache` (a Map: run id → parsed result) avoids
// downloading the same log twice.
export async function fetchWorkflowRuns({org, repo, workflow, runs = 100, parseLogs = 40}, token, logCache = new Map()) {
  const wf = await rest(`https://api.github.com/repos/${org}/${repo}/actions/workflows/${encodeURIComponent(workflow)}`, token);
  const data = await rest(`https://api.github.com/repos/${org}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=${Math.min(runs, 100)}`, token);
  const list = data.workflow_runs.map(runSummary);
  let withResults = 0; // passing runs with test results so far (newest first): budget parseLogs
  for (const run of list) {
    if (run.status !== 'completed' || run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    if (run.conclusion !== 'failure') {
      if (withResults >= parseLogs) continue; // older passing runs: no need to read their logs
      withResults++;
    }
    if (!logCache.has(run.id)) {
      const result = {failedSteps: [], tests: null};
      try {
        const jobs = await rest(`https://api.github.com/repos/${org}/${repo}/actions/runs/${run.id}/jobs?per_page=50`, token);
        result.failedSteps = jobs.jobs.flatMap((j) => j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name));
        // Test results live in the job that ran pytest; read the first job's log (one-job workflow)
        const job = jobs.jobs.find((j) => j.conclusion === 'failure') ?? jobs.jobs[0];
        if (job) result.tests = parsePytest(await fetchJobLog({org, repo, jobId: job.id}, token));
      } catch (err) {
        result.error = err.message; // e.g. log expired (GitHub keeps logs 90 days by default)
      }
      logCache.set(run.id, result);
    }
    Object.assign(run, logCache.get(run.id));
  }
  return {org, repo, workflow, name: wf.name, url: wf.html_url, totalRuns: data.total_count, runs: list, fetchedAt: new Date().toISOString()};
}

// How a fork differs from the repo it was forked from: commits and files on the fork's branch
// that upstream doesn't have (GitHub compare: upstream...fork).
export async function fetchForkChanges({org, repo, branch}, token) {
  const info = await rest(`https://api.github.com/repos/${org}/${repo}`, token);
  if (!info.fork || !info.parent) throw new Error(`${repo} isn't a fork`);
  const [upOwner] = info.parent.full_name.split('/');
  const base = `${upOwner}:${info.parent.default_branch}`;
  const head = `${org}:${branch ?? info.default_branch}`;
  const cmp = await rest(`https://api.github.com/repos/${org}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=250`, token);
  return {
    repo,
    upstream: info.parent.full_name,
    upstreamBranch: info.parent.default_branch,
    branch: branch ?? info.default_branch,
    status: cmp.status,
    aheadBy: cmp.ahead_by,
    behindBy: cmp.behind_by,
    url: cmp.html_url,
    commits: cmp.commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author: c.author?.login ?? c.commit.author?.name ?? null,
      date: c.commit.author?.date ?? null,
    })),
    files: (cmp.files ?? []).map((f) => ({path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null})),
  };
}
