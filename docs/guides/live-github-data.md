---
title: Live GitHub data
sidebar_position: 3
---

The **Project Status** pages (project board, Repo Issues, Integration Tests, What's New) show GitHub data that updates while you look at it. This page explains where that data comes from, how fresh it is, how to add a board or workflow, and what to check when a page says "Snapshot".

## How it works

Each page is built in two layers:

1. **A snapshot.** The sync (`npm run sync:status`, part of `make up`, `make prod` and `make sync`) fetches everything once and writes it to `docs/project-status/_data/*.json`, together with an `.mdx` page for each view.
2. **Live updates.** In the browser, the page starts with the snapshot, then asks the MCP server for fresh data and asks again **every 5 minutes**.

```mermaid
sequenceDiagram
  participant B as Browser (Project Status page)
  participant M as MCP server :3001<br/>/api/github/...
  participant G as GitHub API
  B->>B: Render the snapshot from the last sync
  B->>M: GET /api/github/project/blue-core-lod/5
  alt Cached less than 2 min ago
    M-->>B: Cached result
  else
    M->>G: GraphQL / REST with GITHUB_TOKEN
    G-->>M: Data
    M-->>B: Normalized JSON
  end
  B->>B: Badge switches to "Live · updated just now"
  Note over B: If the request fails, the snapshot stays<br/>and the badge says "Snapshot from the last sync"
```

`GITHUB_TOKEN` stays in the MCP container. Browsers only receive the processed results, so the token never reaches a web page.

### The badge

Every Project Status page has a badge at the top:

- **Live · updated N min ago:** the last request to the MCP server worked.
- **Snapshot from the last sync · date:** the live request failed. **Hover over the badge** to see the error.
- **As of date:** this site has no live API (the public GitHub Pages site). The data is from the last deploy, which runs every hour.

### Freshness

| Layer | How long | Setting |
|---|---|---|
| Browser refresh | 5 minutes | `REFRESH_MS` in `src/components/ProjectStatus/shared.js` |
| Server cache | 2 minutes (failed requests aren't cached) | `LIVE_CACHE_SECONDS` |
| Snapshot | Until the next sync (`make up` / `make prod` / `make sync`) | n/a |

So live data is at most about 7 minutes old.

## The pages

All pages live under `/project-status`. Their settings are in the `projectStatus` block of `docs-sources.json`.

### Navigating between them

The sidebar shows **Project Status** as one link, to an overview page with a card for each page. Each page also has a row of icon links at the top:

| Icon | Page |
|---|---|
| Grid | Overview |
| Columns | Project board (local only) |
| Circle with a dot | Repo Issues |
| Branches | Pull Requests |
| Flask | Tests: every test suite, with a second row of links to each one |
| Two arrows | Version Drift |
| Tag | What's New |

- **Tooltips:** hover over or tab to an icon to see what the page shows, with counts from the last sync. On phones only the icons are shown.
- **Test suites:** on the Tests pages, a second row lists each suite (Integration, bluecore_api, …). A green or red dot shows its latest result, and each has its own tooltip with its pass rate and latest test counts.
- **Where the links come from:** the sync writes them to `_data/nav.json`, so the row only lists pages this build has.
- **How the dropdown is hidden:** `customProps.hideItems` in the section's `_category_.json` and `sidebarItemsGenerator` in `docusaurus.config.js`.

### Public site vs. local

The GitHub Pages deploy runs the sync with `PUBLIC_BUILD=1`, which **leaves out project boards** because they're private. Repo Issues, Integration Tests and What's New are built from public repos and are on the public site, refreshed hourly. To publish a board that is public, add `"public": true` to its entry in `projects`.

### Project board (`projects`)

One page per GitHub Projects (v2) board, fetched with GraphQL.

- Shows a column per **Status** value, with counts per status at the top.
- Has filters for repo, assignee, label and text.
- Hides **Done** by default (use the "Show Done" checkbox).
- Cards show the repo and number, assignees, labels, milestone, sub-issue progress and parent issue.

```json
"projects": [
  { "org": "blue-core-lod", "number": 5, "slug": "blue-core-mvp-board" }
]
```

`number` is the number in the board's URL (`github.com/orgs/blue-core-lod/projects/5`). This needs the **`read:project`** token scope.

### Repo Issues (`issues`)

Open issues of every repo in the org, grouped by repo, with filters for repo, label and assignee. Repos are chosen by `includeArchived`, `includePrivate`, `includeForks` (`false`, `true` or a list of fork names) and `skipRepos`.

The same repo filter limits what the MCP GitHub tools may read, so private repos stay out even though the token can see them.

### Integration Tests (`integrationTests`)

Health of a GitHub Actions workflow. It's built for the `bluecore-stack` **Bluecore Integration Test** workflow, but works for any workflow that runs pytest.

| On the page | Where it comes from |
|---|---|
| Latest run, pass rate (all runs read, last 7 days, last 20 runs) | Run conclusions. Cancelled and skipped runs don't count. |
| Passing or failing streak | Consecutive equal results from the newest run |
| Median and p90 run time | Durations of successful runs |
| Tests (latest results) | pytest summary line from the job log |
| Time to fix | Median minutes from a failure to the next passing run |
| Last N runs chart | Duration and result of each run |
| Where failures happen | Failed step names grouped into Image build / Tests / Setup / Other |
| By trigger | Which repo's workflow dispatched the run (e.g. `api-integration`), or `push`, `schedule`, … |
| Most-failing tests | `FAILED` / `ERROR` lines from the pytest output, and whether each test still fails |
| Recent runs | Links to the runs on GitHub, and to the pull request that started each run |

```json
"integrationTests": [
  {
    "org": "blue-core-lod",
    "repo": "bluecore-stack",
    "workflow": "bluecore-integration-test.yml",
    "title": "Bluecore Integration Test",
    "runs": 100,
    "parseLogs": 30
  }
]
```

| Key | Meaning |
|---|---|
| `workflow` | The workflow **file name** in `.github/workflows/` |
| `org` | Defaults to `issues.org` |
| `runs` | How many recent runs to read (max 100) |
| `parseLogs` | How many recent **passing** runs to download logs for. Logs of every failed run are always read. |
| `callers` | Integration tests only: each run-name prefix another repo dispatches with (e.g. `api-integration`) → that repo. The page follows the caller's run to its PR. Push runs link to their branch's PR without it. |
| `slug`, `pageTitle` | Optional page URL and title |

How logs are read:

- Test results are parsed from the log of the first failed job, or the first job if none failed. With a version matrix (e.g. Python 3.12 and 3.13), the other jobs run the same tests, so one job's results stand for the run.
- The parser recognizes **pytest**, **Jest** (standard summary and sinopia_editor's compact `Tests: 796/796`), **Vitest** and **Playwright** output (`parseTestLog` in `mcp/github.mjs`).
- A run that failed before any job started (for example a workflow file error) counts as **Didn't start**.
- GitHub keeps logs for 90 days by default, so older runs show results without test details.
- The MCP server keeps parsed logs in memory, starting from the snapshot. Each refresh downloads only logs of new runs, and the data is fetched once when the server starts so the first page view is fast.

### Repo tests (`repoTests`)

Each repository's own test workflow gets the same page as the integration suite: `/project-status/tests-<repo>`. The **Tests** page (`/project-status/tests`) puts every suite in one table, with its latest result, pass rate, latest test counts, median run time and how many tests are failing now.

```json
"repoTests": [
  { "repo": "bluecore_api", "workflow": "test.yml", "title": "bluecore_api" },
  { "repo": "marva_editor", "workflow": "unit_tests.yml", "title": "marva_editor (unit)", "slug": "tests-marva_editor-unit" }
]
```

| Key | Meaning |
|---|---|
| `repo`, `workflow` | The repo and its workflow **file name** |
| `title` | The suite's name in the navigation and the table |
| `slug` | Page URL. Defaults to `tests-<repo>`, so set it when a repo has two suites |
| `runs`, `parseLogs` | Default to 50 and 10 here (less than the integration suite) to keep GitHub API use low |

On these pages, "Where failures happen" uses stages that fit unit-test workflows: **Lint** (ruff, eslint), **Type check** (mypy, ty, tsc), **Tests**, **Setup** (installing dependencies) and **Didn't start**.

The sync reuses test logs it already parsed, from the previous snapshot, and the deploy keeps them between runs with `actions/cache`. As a result, only logs of new runs are downloaded: a cold sync of all ten suites takes about 3.5 minutes, a warm one about a minute. The live server loads repo test data when a page asks for it, not at startup.

### Pull Requests (`pullRequests`)

Every open pull request in the same repos as Repo Issues, oldest first:

- **Review status:** needs review, changes requested, approved or draft. It comes from branch protection, or else each reviewer's latest review.
- **CI:** the combined result of all checks on the PR's latest commit.
- **Stale:** no update for `staleDays` (default 14). Stale PRs have a yellow edge.
- **At the top:** counts of PRs waiting for review, with changes requested, ready to merge (approved, CI passing, no conflicts) and stale. Click one to filter.

Drafts are hidden unless you tick **Show drafts**. The code is in `mcp/pulls.mjs`.

### Version Drift (`versionDrift`)

Answers "it works in my repo, why does it fail in the stack?", and "what's actually running on dev and stage?".

#### Deployed environments

For each site in `environments` (dev.bcld.info and stage.bcld.info), the page reads each service's `health` endpoint, such as `/api/health`, which returns `{"version": "0.35.2"}`. These are the same endpoints the stack's own status page uses. It then compares the version with the service's releases:

| Cell | Meaning |
|---|---|
| Green version | Runs the latest release |
| Red "N behind" | Older than the latest release. The notes below the table link to each release that isn't deployed. |
| Orange | Newer than the latest release: an unreleased build |
| Grey | The version isn't known (no version endpoint), or the site didn't answer |

- **bluecore-models** shows the version locked in each deployed service's release (the API and Workflows). If they differ on the same site, both cells say "differs" in red, and a note says which versions each service uses, since both share the same database.
- **bluecore-workflows** reports its version at `/workflows/health`, like the other services.
- **Notes:** below the table, the page lists any service that differs between dev and stage, and any that isn't on the latest release.

#### The stack's images

For each service in `services`:

| Check | How |
|---|---|
| Which image the stack uses | The `image: ${VAR:-default}` lines in the stack's compose files (`stack.files`) |
| When that image was built | The GitHub container registry, which serves public images without a token |
| Latest release, unreleased commits | GitHub releases and a compare of the release tag with the branch |
| Did the last publish fail? | The repo's `publish.yml` runs |

Each service gets a status:

- **Behind (red):** the stack pins an older tag, the last publish failed, or the image is older than the latest release.
- **Check (yellow):** commits on the main branch aren't released yet, so the stack doesn't have them.
- **Current (green):** the stack runs the latest release.

`imageTracksBranch: true` (Marva) means the image is rebuilt on every push to `branch`. It's checked against that branch instead of against releases: when it's current, the card says the stack runs the latest release, and unreleased commits aren't listed, because the image already has them.

For each library in `libraries` (bluecore-models), the page compares its latest release with the version each service locks in `uv.lock`: both in the service's latest release (what its image contains) and on its main branch.

Each service card also shows the version it uses:

- **Yellow:** older than the latest release.
- **Red:** different from the version the other services use. That's the riskiest case, because the services share data through these models. The code is in `mcp/drift.mjs`.

### What's New (`releases`)

The latest release of each repo as "Latest versions" cards, then a release timeline (25 at a time, filterable by repo).

- Highlights are the first three bullet points of each release's notes.
- Draft releases are skipped.
- `perRepo` sets how many releases to read per repo.

## Where the live API is

| Where you run it | Page asks | Reaches |
|---|---|---|
| `make up` (dev, :3000) | `http://localhost:3001/api/github/...` | `mcp` container directly |
| `make prod` (:8080) | `/api/live/github/...` (same address) | nginx forwards to `mcp-prod:3001`, so it also works through ngrok |
| GitHub Pages | Nothing (`LIVE_API_URL=''`) | Data from the last deploy (hourly). The project board is left out (`PUBLIC_BUILD=1`). |

The page reads the address from `customFields.liveApiUrl` in `docusaurus.config.js` (set with `LIVE_API_URL`).

### Endpoints

All are `GET` only and served by `mcp/live-api.mjs`:

| Endpoint | Returns |
|---|---|
| `/api/github/project/<org>/<number>` | Board items. Only boards listed in `projects`. |
| `/api/github/issues/<org>` | Open issues per repo. Only `issues.org`. |
| `/api/github/releases/<org>` | Releases. Only `releases.org`. |
| `/api/github/ci/<org>/<repo>/<workflow file>` | Runs with parsed test results. Only listed workflows. |

Anything not in `docs-sources.json` returns 404, so the server can't be used to read arbitrary GitHub data. Safety checks:

- Requests must be addressed to `localhost` (or a host in `MCP_ALLOWED_HOSTS`).
- Browsers may read the responses only from `localhost` pages, `DOCS_SITE_URL` or `LIVE_ALLOWED_ORIGINS`.

Try it from a terminal while `make up` is running:

```bash
curl -s http://localhost:3001/api/github/project/blue-core-lod/5 | head -c 400
curl -s http://localhost:3001/api/github/ci/blue-core-lod/bluecore-stack/bluecore-integration-test.yml | head -c 400
```

## The same data for AI agents

`list_pull_requests` and `version_drift` use the same cached data as their pages.

**Diagnosing a failing test:** `diagnose_test_failure` (in `mcp/diagnose.mjs`) collects the evidence for a failed run. An MCP tool can't reason on its own, so the agent that calls it writes the diagnosis. The tool returns:

- the failing tests' error output (pytest tracebacks, Jest, Vitest or Playwright errors), or the failed step's error lines for lint, type check and build failures;
- the commits and files changed since the last passing run, or a note that it passed on the same commit (flaky or external);
- each failing test's history, and whether it passed in another run of the same commit;
- hints from common error patterns: import errors, unreachable services, authentication, database, assertions, infrastructure limits.

In Claude Code, the `/mcp__docs__diagnose_failure` prompt runs it, reads the relevant files and writes the likely cause, the evidence and a fix.


The MCP tools `project_board`, `list_issues`, `list_releases` and `integration_tests` use the same cached data as the pages. `integration_tests` covers every suite: pass a `suite` such as `bluecore_api` or `marva_editor (unit)`. When GitHub can't be reached they fall back to the snapshot and say so in their answer. Other GitHub tools (`get_issue`, `search_issues`, `ci_status`, `search_code`, `fork_changes`, …) call GitHub directly. The full list is in the repo `README.md`.

## Adding a board or workflow

1. Add the entry to `projectStatus` in `docs-sources.json`.
2. Run `make sync` to create the page and its snapshot. The page doesn't exist until a sync writes it.
3. **Dev:** the MCP server reads `docs-sources.json` on every request, so live data works right away. **Prod:** run `make prod` again, because `mcp-prod` has its own copy of the file.

The sync builds the whole section in a temporary folder and replaces `docs/project-status/` only if every fetch worked. If one fetch fails, you keep the old pages.

## Code map

| File | Role |
|---|---|
| `mcp/github.mjs` | Fetches and normalizes boards (GraphQL), issues, releases and workflow runs, parses test logs (pytest, Jest, Vitest, Playwright), and lists the test suites (`testSuites`). Used by the sync **and** the live API. |
| `mcp/ci-metrics.mjs` | Pass rate, streaks, durations, failure stages, triggers and most-failing tests. Pure functions used by the page text, the sync and the MCP tool. |
| `mcp/live-api.mjs` | `/api/github/...` endpoints, caching, the snapshot fallback for MCP tools, and the integration test log cache |
| `scripts/sync/project-status.mjs` | Writes the snapshot JSON and the `.mdx` pages, including a text version of each page for search |
| `src/components/ProjectStatus/` | React pages. `shared.js` has `useLiveData` (snapshot, then live, then refresh) and the badge. |
| `docker/nginx.conf` | `/api/live/` forwarding in prod |

## Troubleshooting

Hover over the "Snapshot" badge to see the error, then:

| Error | Fix |
|---|---|
| `GITHUB_TOKEN is not set in this container` | Add it to `.env` and restart (`make up` / `make prod`). |
| `Your token has not been granted the required scopes` / board errors | Run `gh auth refresh -s read:project`, put the new `gh auth token` in `.env` and restart. |
| `unknown project` / `unknown workflow` | The URL doesn't match `docs-sources.json`. In prod, rebuild with `make prod` after editing it. |
| `Failed to fetch` | The MCP server isn't running. Start `make up`, or `make mcp`. |
| `Host "…" not allowed` | Add the host name to `MCP_ALLOWED_HOSTS`. |
| Project Status section and Status link missing | No sync has run with a token yet. Run `make sync`, check its `project-status` log lines, then restart `make up` so the navbar link appears. |
| Test details missing for old runs | Their logs have expired on GitHub (90 days). |

## Related

- [How content gets onto the site](./content-lifecycle.md)
- `SETUP.md` in the repo root: getting a token with the right scopes
- `docs-sources.json`: the `projectStatus` block
