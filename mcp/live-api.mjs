// Live GitHub data for the "Project Status" pages, served next to the MCP endpoint:
//
//   GET /api/github/project/<org>/<number>   project board (only boards listed in docs-sources.json)
//   GET /api/github/issues/<org>             open issues per repo (only the configured org)
//   GET /api/github/releases/<org>           latest releases per repo (only the configured org)
//   GET /api/github/pulls/<org>              open pull requests per repo (only the configured org)
//   GET /api/github/drift/<org>              version drift between releases and the stack's images
//   GET /api/github/ci/<org>/<repo>/<file>   integration test runs + parsed test results
//
// Results are cached for LIVE_CACHE_SECONDS; `?refresh=1` (the pages' Refresh button) skips the cache.
//
// The GitHub token stays in this container; browsers only get the (cached) results.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchIssues, fetchProject, fetchReleases, fetchWorkflowRuns, listRepos, logCacheFromSnapshot, testSuites} from './github.mjs';
import {fetchVersionDrift} from './drift.mjs';
import {fetchPullRequests} from './pulls.mjs';

const SOURCES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs-sources.json');
const CACHE_MS = Number(process.env.LIVE_CACHE_SECONDS ?? 120) * 1000;
const cache = new Map(); // key → {at, promise}

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

// `fresh`: ignore the cache (the Refresh button), unless the data is only seconds old
function cached(key, load, fresh = false) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (fresh ? MIN_REFRESH_MS : CACHE_MS)) return hit.promise;
  const promise = load();
  cache.set(key, {at: Date.now(), promise});
  promise.catch(() => cache.delete(key)); // don't cache failures
  return promise;
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
  const fresh = new URL(req.url, 'http://x').searchParams.has('refresh');
  try {
    if (kind === 'project') {
      const project = (cfg.projects ?? []).find((p) => p.org === org && String(p.number) === number);
      if (!project) return send(res, 404, {error: 'unknown project'}, origin), true;
      send(res, 200, await cached(`project:${org}/${number}`, () => fetchProject(project, token), fresh), origin);
    } else if (kind === 'issues' && cfg.issues?.org === org) {
      send(res, 200, await cached(`issues:${org}`, () => fetchIssues(cfg.issues, token), fresh), origin);
    } else if (kind === 'ci') {
      // /api/github/ci/<org>/<repo>/<workflow file>
      const [, , , , , repo, workflow] = pathname.split('/');
      const suite = testSuites(cfg).find((s) => s.repo === repo && s.workflow === workflow && s.org === org);
      if (!suite) return send(res, 404, {error: 'unknown workflow'}, origin), true;
      send(res, 200, (await integrationTestData(suite, {fresh})).data, origin);
    } else if (kind === 'releases' && cfg.releases?.org === org) {
      send(res, 200, await cached(`releases:${org}`, () => fetchReleases(cfg.releases, token), fresh), origin);
    } else if (kind === 'pulls' && cfg.pullRequests && cfg.issues?.org === org) {
      send(res, 200, (await pullsData({fresh})).data, origin);
    } else if (kind === 'drift' && cfg.versionDrift && cfg.issues?.org === org) {
      send(res, 200, (await driftData({fresh})).data, origin);
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
async function liveOrSnapshot(key, load, snapshotFile, fresh = false) {
  try {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
    return {data: await cached(key, load, fresh), live: true};
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
export function pullsData({fresh} = {}) {
  const cfg = config();
  const org = cfg.issues.org;
  return liveOrSnapshot(`pulls:${org}`, () => fetchPullRequests({...cfg.issues, ...cfg.pullRequests, org}, process.env.GITHUB_TOKEN), `pulls-${org}.json`, fresh);
}

export function driftData({fresh} = {}) {
  const cfg = config();
  const org = cfg.issues.org;
  return liveOrSnapshot(`drift:${org}`, () => fetchVersionDrift({org, ...cfg.versionDrift}, process.env.GITHUB_TOKEN), `drift-${org}.json`, fresh);
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
export function integrationTestData(suite, {fresh} = {}) {
  seedLogCache(suite.dataFile);
  return liveOrSnapshot(`ci:${suite.repo}/${suite.workflow}`, () => fetchWorkflowRuns(suite, process.env.GITHUB_TOKEN, logCache), suite.dataFile, fresh);
}

export const allTestSuites = () => testSuites(config());

// Warm the integration test data when the server starts, so the first page view is fast. Repo test
// pages load on demand, to keep the startup light on GitHub API calls.
export function prewarm() {
  for (const suite of allTestSuites().filter((s) => s.kind === 'integration')) integrationTestData(suite).catch(() => {});
}
