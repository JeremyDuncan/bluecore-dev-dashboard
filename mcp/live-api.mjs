// Live GitHub data for the "Project Status" pages, served next to the MCP endpoint:
//
//   GET /api/github/project/<org>/<number>   project board (only boards listed in docs-sources.json)
//   GET /api/github/issues/<org>             open issues per repo (only the configured org)
//   GET /api/github/releases/<org>           latest releases per repo (only the configured org)
//   GET /api/github/pulls/<org>              open pull requests per repo (only the configured org)
//   GET /api/github/drift/<org>              version drift between releases and the stack's images
//   GET /api/github/ci/<org>/<repo>/<file>   integration test runs + parsed test results
//   GET /api/github/tests/<org>              one summary row per test suite (the Tests overview)
//
// Caching, so a page never waits on GitHub or shows days-old data:
//   - data younger than LIVE_CACHE_SECONDS (2 min) is served as is;
//   - data younger than LIVE_STALE_SECONDS (15 min) is served at once while it refreshes in the background;
//   - anything older waits for GitHub;
//   - keepWarm() refetches every page's data each LIVE_WARM_MINUTES (10), so even after days without
//     visitors the cache is fresh enough to answer at once.
// `?refresh=1` skips the cache. The pages' Refresh button calls GET /api/github/refresh/<org>, which
// refetches every page's data, then asks for its own with `?since=<startedAt>`; other pages and tabs
// pass the same `since`, which waits for data fetched after that moment (sharing the running fetch).
//
// The GitHub token stays in this container; browsers only get the (cached) results.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchIssues, fetchProject, fetchReleases, fetchWorkflowRuns, listRepos, logCacheFromSnapshot, testSuites} from './github.mjs';
import {fetchVersionDrift} from './drift.mjs';
import {suiteSummary} from './ci-metrics.mjs';
import {fetchPullRequests} from './pulls.mjs';

const SOURCES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs-sources.json');
const CACHE_MS = Number(process.env.LIVE_CACHE_SECONDS ?? 120) * 1000;
const STALE_MS = Math.max(CACHE_MS, Number(process.env.LIVE_STALE_SECONDS ?? 900) * 1000);
const WARM_MS = Number(process.env.LIVE_WARM_MINUTES ?? 10) * 60000;
const cache = new Map(); // key → {value, valueAt, pending}

function config() {
  try {
    return JSON.parse(fs.readFileSync(SOURCES, 'utf8')).projectStatus ?? null;
  } catch {
    return null;
  }
}

// Pages on this machine (any localhost port) and the configured site may read the data.
export function allowedOrigin(origin) {
  if (!origin) return null;
  try {
    const {hostname} = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return origin;
  } catch {
    return null;
  }
  const extra = [process.env.DOCS_SITE_URL, ...(process.env.LIVE_ALLOWED_ORIGINS ?? '').split(',')]
    .filter(Boolean)
    .map((u) => new URL(u).origin);
  return extra.includes(origin) ? origin : null;
}

const MIN_REFRESH_MS = 10 * 1000; // a forced refresh reuses anything fetched in the last 10s

// opts.fresh: ignore the cache (the Refresh button), unless the data is only seconds old.
// opts.since: only data fetched at or after this time (ms) will do (after a "refresh everything").
// Concurrent requests share one fetch, and a failed fetch keeps the last good data.
function cached(key, load, opts = {}) {
  const {fresh = false, since = 0} = opts === true ? {fresh: true} : opts || {};
  let entry = cache.get(key);
  if (!entry) cache.set(key, (entry = {value: undefined, valueAt: 0, pending: null}));
  const age = entry.valueAt ? Date.now() - entry.valueAt : Infinity;
  const refresh = () => {
    if (!entry.pending) {
      entry.pending = load()
        .then((value) => {
          entry.value = value;
          entry.valueAt = Date.now();
          return value;
        })
        .finally(() => {
          entry.pending = null;
        });
      entry.pending.catch(() => {}); // a background refresh's failure is reported to no one
    }
    return entry.pending;
  };
  if (since && !fresh) return entry.valueAt >= since ? Promise.resolve(entry.value) : refresh();
  if (age < (fresh ? MIN_REFRESH_MS : CACHE_MS)) return Promise.resolve(entry.value);
  if (!fresh && age < STALE_MS) {
    refresh(); // answer now with the recent data; the next request gets the refreshed data
    return Promise.resolve(entry.value);
  }
  return refresh();
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(origin && {'access-control-allow-origin': origin, vary: 'Origin'}),
  });
  res.end(JSON.stringify(body));
}

// Returns true when the request was for /api/github/...
export async function handleLiveApi(req, res, pathname) {
  if (!pathname.startsWith('/api/github/')) return false;
  const origin = allowedOrigin(req.headers.origin);
  if (req.method !== 'GET') {
    send(res, 405, {error: 'GET only'}, origin);
    return true;
  }
  const token = process.env.GITHUB_TOKEN;
  const cfg = config();
  if (!token || !cfg) {
    send(res, 503, {error: !token ? 'GITHUB_TOKEN is not set in this container' : 'projectStatus is not configured'}, origin);
    return true;
  }

  const [, , , kind, org, number] = pathname.split('/'); // '', 'api', 'github', kind, org, number
  const params = new URL(req.url, 'http://x').searchParams;
  const opts = {fresh: params.has('refresh'), since: Number(params.get('since')) || 0};
  try {
    if (kind === 'refresh' && cfg.issues?.org === org) {
      send(res, 200, {startedAt: refreshAll()}, origin);
    } else if (kind === 'project') {
      const project = (cfg.projects ?? []).find((p) => p.org === org && String(p.number) === number);
      if (!project) return send(res, 404, {error: 'unknown project'}, origin), true;
      send(res, 200, await cached(`project:${org}/${number}`, () => fetchProject(project, token), opts), origin);
    } else if (kind === 'issues' && cfg.issues?.org === org) {
      send(res, 200, await cached(`issues:${org}`, () => fetchIssues(cfg.issues, token), opts), origin);
    } else if (kind === 'ci') {
      // /api/github/ci/<org>/<repo>/<workflow file>
      const [, , , , , repo, workflow] = pathname.split('/');
      const suite = testSuites(cfg).find((s) => s.repo === repo && s.workflow === workflow && s.org === org);
      if (!suite) return send(res, 404, {error: 'unknown workflow'}, origin), true;
      send(res, 200, (await integrationTestData(suite, opts)).data, origin);
    } else if (kind === 'tests' && cfg.issues?.org === org) {
      send(res, 200, await testsOverviewData(opts), origin);
    } else if (kind === 'releases' && cfg.releases?.org === org) {
      send(res, 200, await cached(`releases:${org}`, () => fetchReleases(cfg.releases, token), opts), origin);
    } else if (kind === 'pulls' && cfg.pullRequests && cfg.issues?.org === org) {
      send(res, 200, (await pullsData(opts)).data, origin);
    } else if (kind === 'drift' && cfg.versionDrift && cfg.issues?.org === org) {
      send(res, 200, (await driftData(opts)).data, origin);
    } else {
      send(res, 404, {error: 'unknown endpoint'}, origin);
    }
  } catch (err) {
    console.error('[live-api]', err.message);
    send(res, 502, {error: err.message}, origin);
  }
  return true;
}

// --- Shared with the MCP GitHub tools (github-tools.mjs) ----------------------------------------

const SNAPSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/project-status/_data');

export const githubConfig = config;

// Live data (cached like the pages' API), or the snapshot from the last sync if GitHub can't be
// reached. Returns {data, live, error?}.
async function liveOrSnapshot(key, load, snapshotFile, opts = {}) {
  try {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
    return {data: await cached(key, load, opts), live: true};
  } catch (err) {
    try {
      return {data: JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, snapshotFile), 'utf8')), live: false, error: err.message};
    } catch {
      throw new Error(`${err.message}, and there's no snapshot yet (run make sync)`);
    }
  }
}

export function projectData(project) {
  return liveOrSnapshot(
    `project:${project.org}/${project.number}`,
    () => fetchProject(project, process.env.GITHUB_TOKEN),
    `project-${project.org}-${project.number}.json`,
  );
}

export function issuesData() {
  const cfg = config();
  return liveOrSnapshot(`issues:${cfg.issues.org}`, () => fetchIssues(cfg.issues, process.env.GITHUB_TOKEN), `issues-${cfg.issues.org}.json`);
}

export function releasesData() {
  const cfg = config();
  return liveOrSnapshot(`releases:${cfg.releases.org}`, () => fetchReleases(cfg.releases, process.env.GITHUB_TOKEN), `releases-${cfg.releases.org}.json`);
}

// Open PRs in the same repos as the issues page (private repos stay out)
export function pullsData(opts = {}) {
  const cfg = config();
  const org = cfg.issues.org;
  return liveOrSnapshot(`pulls:${org}`, () => fetchPullRequests({...cfg.issues, ...cfg.pullRequests, org}, process.env.GITHUB_TOKEN), `pulls-${org}.json`, opts);
}

export function driftData(opts = {}) {
  const cfg = config();
  const org = cfg.issues.org;
  return liveOrSnapshot(`drift:${org}`, () => fetchVersionDrift({org, ...cfg.versionDrift}, process.env.GITHUB_TOKEN), `drift-${org}.json`, opts);
}

// Repos the tools may read: the same filter as the issues page (public, not archived, listed forks),
// so private repos stay out even though the token could read them.
export async function allowedRepos() {
  const cfg = config();
  return cached(`repos:${cfg.issues.org}`, () => listRepos(cfg.issues.org, process.env.GITHUB_TOKEN, cfg.issues));
}

// Test runs (integration suite or a repo's own tests, see testSuites) with parsed test results.
// Parsed logs are kept per run id for the life of the server, so each refresh only downloads logs
// of new runs. The cache starts from the snapshot (the sync already read those logs), so only runs
// newer than the last sync need their logs downloaded.
const logCache = new Map();
const seeded = new Set();
function seedLogCache(file) {
  if (seeded.has(file)) return;
  seeded.add(file);
  try {
    logCacheFromSnapshot(JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8')), logCache);
  } catch {
    // no snapshot yet
  }
}
// `suite` is an entry from testSuites(config())
export function integrationTestData(suite, opts = {}) {
  seedLogCache(suite.dataFile);
  return liveOrSnapshot(`ci:${suite.repo}/${suite.workflow}`, () => fetchWorkflowRuns(suite, process.env.GITHUB_TOKEN, logCache), suite.dataFile, opts);
}

export const allTestSuites = () => testSuites(config());

// The Tests overview: one summary row per suite, from each suite's (cached) runs
export async function testsOverviewData(opts = {}) {
  const cfg = config();
  const suites = allTestSuites();
  const results = await Promise.all(suites.map((suite) => integrationTestData(suite, opts).then((r) => r.data).catch(() => null)));
  const rows = suites.map((suite, i) => results[i] && suiteSummary(results[i], suite, `/${cfg.dir ?? 'project-status'}/${suite.slug}`)).filter(Boolean);
  if (!rows.length) throw new Error('No test suite data could be loaded');
  return rows;
}

// Every page's data loader, for keepWarm
function warmLoaders() {
  const cfg = config();
  if (!cfg) return [];
  return [
    ...allTestSuites().map((suite) => () => integrationTestData(suite, {fresh: true})),
    ...(cfg.projects ?? []).map((project) => () => cached(`project:${project.org}/${project.number}`, () => fetchProject(project, process.env.GITHUB_TOKEN), true)),
    ...(cfg.issues ? [() => cached(`issues:${cfg.issues.org}`, () => fetchIssues(cfg.issues, process.env.GITHUB_TOKEN), true)] : []),
    ...(cfg.releases ? [() => cached(`releases:${cfg.releases.org}`, () => fetchReleases(cfg.releases, process.env.GITHUB_TOKEN), true)] : []),
    ...(cfg.pullRequests && cfg.issues ? [() => pullsData({fresh: true})] : []),
    ...(cfg.versionDrift && cfg.issues ? [() => driftData({fresh: true})] : []),
  ];
}

// Fetch every page's data when the server starts and then every LIVE_WARM_MINUTES (0 = only on
// demand), one after another to spread the GitHub API calls. Without it, the first visit after a
// quiet spell waited seconds for GitHub while the page showed the snapshot from the last sync.
let warming = false;
async function warmAll() {
  if (warming || !process.env.GITHUB_TOKEN) return;
  warming = true;
  try {
    for (const load of warmLoaders()) await load().catch((err) => console.error('[live-api] warm:', err.message));
  } finally {
    warming = false;
  }
}
// "Refresh everything" (the pages' Refresh button): refetch every page's data now, a few at a time,
// and return when it started, for the pages' `since`. A second click within seconds reuses the first.
let lastRefreshAll = 0;
export function refreshAll() {
  if (Date.now() - lastRefreshAll < MIN_REFRESH_MS) return lastRefreshAll;
  lastRefreshAll = Date.now();
  const queue = warmLoaders();
  const worker = async () => {
    while (queue.length) await queue.shift()().catch((err) => console.error('[live-api] refresh:', err.message));
  };
  Promise.all(Array.from({length: 4}, worker));
  return lastRefreshAll;
}

export function keepWarm() {
  warmAll();
  if (WARM_MS > 0) setInterval(warmAll, WARM_MS).unref();
}
