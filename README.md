# Docs Site

A free, self-hosted developer docs site built with [Docusaurus](https://docusaurus.io). Markdown is pulled automatically from **Google Docs**, **GitHub READMEs** and **code**, and your AI agent writes the rest as pull requests.

```
Google Docs ─┐
READMEs ─────┼─ npm run sync ─▶ docs/*.md ─▶ npm run build ─▶ GitHub Pages
Code ────────┘                     ▲
                    AI agent PRs ──┘ (guides, cleanup, gap-filling)
```

## Quick start (Docker, recommended)

The only requirement is Docker. For a full step-by-step setup (tokens, Drive and Box files, chat CLIs), see **[SETUP.md](SETUP.md)**.

```bash
cp .env.example .env   # optional: add GITHUB_TOKEN / GOOGLE_ACCESS_TOKEN
make up                # pull all sources, then live preview at http://localhost:3000 (edits hot-reload)
make up SYNC=0         # quick restart without syncing (also works for make prod)
make sync              # pull all sources again while the site runs
make prod              # pull all sources, then production build served by nginx at http://localhost:8080
make mcp               # only the dev MCP server for AI agents (make up and make prod start one too)
make chat              # only the "Ask the docs" chat helper (make up / make prod start it automatically)
make lab               # print JupyterLab's address with its token (make up / make prod start JupyterLab on :8888)
make down              # stop everything
```

No `make`? Use the commands directly:

| Task | Command |
|---|---|
| Live preview | `docker compose up --build` |
| Sync sources | `docker compose run --rm sync` |
| Production (nginx) | `docker compose --profile prod up --build web` |
| Shell in container | `docker compose run --rm docs bash` |

How it's put together:
- **`Dockerfile`** has these stages:
  - `deps`: `npm ci`, cached on `package-lock.json`
  - `dev`: preview server
  - `build`: static site
  - `prod`: about 77 MB nginx image with only the HTML
- **`docker-compose.yml`** mounts this folder into the container, so edits on your machine show up immediately. It also mounts `SOURCES_DIR` (default `../..`, the folder holding your repos) read-only at `/sources`. In `docs-sources.json`, reference local checkouts as `"local": "/sources/<repo-name>"`.
- **The `prod` image** is self-contained, so you can deploy it to any server: `docker build --target prod -t bluecore-dev-dashboard . && docker run -p 80:80 bluecore-dev-dashboard`. Pass `--build-arg SITE_URL=https://docs.example.org` for your real domain.
- **Code doc generators** (`codeDocs`) run inside the container. `npx`-based tools (TypeDoc, widdershins) work as is. For Python or Ruby generators, add them to the `dev` stage of the `Dockerfile`.

## Quick start (without Docker)

```bash
npm install
npm run sync     # pull content from the sources in docs-sources.json
npm start        # preview at http://localhost:3000/<REPO_NAME>/ (set BASE_URL=/ to serve at the root)
```

## Where Markdown comes from

| Source | How | Output folder | Edit where? |
|---|---|---|---|
| GitHub org repos | `npm run sync:readmes` fetches each repo's README and docs, then rewrites relative links | `docs/blue-core-repos/<repo>/` | In the source repo |
| GitHub wikis | Same step; clones each repo's wiki | `docs/blue-core-wiki/` | In the GitHub wiki |
| Single repos (`readmes`) | Same step | `docs/repos/` | In the source repo |
| Google Docs | `npm run sync:google-docs` exports each doc as Markdown (needs link-sharing or a token) | `docs/google-drive/` | In Google Docs |
| Google Drive downloads | `npm run sync:drive-downloads` converts downloaded `.zip`/`.docx` files with pandoc | `docs/google-drive/<slug>/` | In Google Docs, then re-download |
| Box | `npm run sync:box` converts the Box Drive folder | `docs/box/<slug>/` | In Box |
| Code (API reference) | `npm run sync:code` runs a generator (TypeDoc, pydoc-markdown, …) | `docs/reference/` | In code comments |
| Guides / tutorials | Your AI agent drafts them (see `AGENT_PROMPTS.md`) and a human reviews | `docs/guides/`, `docs/getting-started/` | Here |
| `llms.txt` | Built automatically before every build | `static/` | n/a |

Configure sources in **`docs-sources.json`**. Set `"enabled": false` to skip an entry.

**Nothing in the table except Guides is committed.**
- **GitHub content** is pulled on every `make up`, `make prod` and GitHub Pages deploy.
- **Google Drive, Box, Figma design notes** (`docs/design/`) and the **private project board** are internal and **local only**. They appear only on machines that have the source files, and the section disappears from the site (sidebar, navbar and footer) when they're missing.
- Unchanged Drive and Box files aren't converted again. Set `SYNC_FORCE=1` to convert them anyway.

See `docs/guides/content-lifecycle.md` for the details.

To pull **a whole repo's docs** instead of one file, use `files` with glob patterns. Folder structure is preserved, and links between imported files stay on the site:

```json
{
  "repo": "blue-core-lod/bluecore-stack",
  "ref": "main",
  "files": ["README.md", "docs/**/*.md", "training/**/*.md"],
  "slug": "bluecore-stack",
  "title": "Bluecore Stack"
}
```

To pull docs from **every repo in a GitHub organization** (or user account), add an entry to `githubOrgs`. Repos are discovered on each sync, so new repos show up automatically, and repos with no matching files are skipped. The org becomes a top-level section at `/<dir>` with a card for each repo:

```json
"githubOrgs": [
  {
    "org": "blue-core-lod",
    "dir": "blue-core-repos",
    "title": "Blue Core Repos",
    "position": 20,
    "files": ["README.md", "docs/**/*.md", "doc/**/*.md"],
    "exclude": ["**/node_modules/**", "**/vendor/**", ".github/**"],
    "includeWikis": true,
    "includeArchived": false,
    "includeForks": false,
    "includePrivate": false,
    "skipRepos": [],
    "pinFirst": ["bluecore-stack"],
    "wikiSection": {"dir": "blue-core-wiki", "title": "Blue Core Wiki", "mainRepo": "bluecore_info", "position": 30}
  }
]
```

**GitHub wikis:** `includeWikis: true` puts every repo wiki in the org into its own top-level section (`wikiSection`, here `/blue-core-wiki`). The `mainRepo` wiki fills the section and its Home page becomes the front page; other repos' wikis are sub-sections. For a single `readmes` entry with `files`, `"wiki": true` imports its wiki into a **Wiki** folder under that repo. The Home page becomes the front page, and wiki links (`[[Text|Page]]`, `./Page`, full wiki URLs) point at the imported pages. Repos without a wiki are skipped.

`includeForks` is `false` (skip forks), `true`, or a list of fork names to include, e.g. `["marva_editor", "graph-toolbox"]` for Blue Core's own forks of upstream projects. The `projectStatus.issues` setting takes the same values.

`pinFirst` lists repos to put at the top of the section's sidebar, in that order. The rest stay alphabetical after them.

Keep `includePrivate: false` if the site is public. Your `GITHUB_TOKEN` can read private repos, and turning this on would publish their docs.

### Project Status (GitHub Projects and issues)
`projectStatus` in `docs-sources.json` adds a **Project Status** section (`/project-status`):
- one page per GitHub project board (`projects`), with a column per Status, filters (repo, assignee, label, search) and Done hidden by default;
- a **Repo Issues** page with the open issues of every repo in `issues.org`.

The sync (`npm run sync:status`, part of `make sync`) saves a snapshot, and the pages then **update live**: they ask the MCP container (`/api/github/...` on port 3001) for fresh data every 5 minutes. The container holds `GITHUB_TOKEN`, so browsers never see it, and only serves the boards listed in `docs-sources.json` to pages on this machine. A badge on each page says **Live** or **Snapshot from the last sync**; on GitHub Pages (no server) it's always the snapshot.

The token needs the `read:project` scope: `gh auth refresh -s read:project`, then put the new `gh auth token` in `.env`. The output (`docs/project-status/`) is git-ignored. The public deploy builds it with `PUBLIC_BUILD=1`, which leaves out the private board, so the public site gets Repo Issues, Integration Tests and What's New. The pages link to each other with an icon bar (with tooltips) instead of a sidebar dropdown.

**Integration Tests** (`projectStatus.integrationTests`): health of a GitHub Actions workflow, here `bluecore-stack`'s Bluecore Integration Test. Headline numbers (latest run, pass rate, streak, median and p90 run time, tests passing, time to fix), a chart of the last 100 runs, failures by stage (image build / tests / setup), pass rate by trigger (which repo's change started the run), the most-failing tests with their last error and whether they still fail, and recent runs. Test results come from the pytest summary in each run's log (failed runs and the latest 30 others).

**Repo tests** (`projectStatus.repoTests`): the same health page for each repository's own test workflow (pytest, Jest, Vitest or Playwright), plus a **Tests** page comparing every suite. On the Tests pages a second row of links, each with a pass/fail dot and a tooltip, switches between suites.

**Pull Requests** (`projectStatus.pullRequests`): every open PR in the org's repos, oldest first, with review status, CI result, merge conflicts and size. PRs with no update for `staleDays` (14) are highlighted.

**Version Drift** (`projectStatus.versionDrift`): what's deployed on dev.bcld.info and stage.bcld.info (read from each service's health endpoint) compared with the latest releases, and for each service the stack runs, its latest release compared with the `:latest` image the stack's compose files use (when it was built, unreleased commits, failed publishes), and whether services lock the latest `bluecore-models`.

**What's New** (`projectStatus.releases`): the latest release of each repo as "Updates" cards (the Figma product-page box), then a release timeline with the full notes. Live like the other status pages.

### "Last updated" dates
Every imported page shows when its **source** last changed (bottom of the page), and pages older than a year get a "Possibly out of date" notice at the top:
- repo docs: the file's last commit on GitHub (date and author)
- wiki pages: the page's last edit (the wiki is cloned with full history)
- Google Drive and Box: the file's modified date

The sync writes these as `last_update` front matter. Hand-written pages use git history once this folder is a git repo, and the file date until then (see `experimental_vcs` in `docusaurus.config.js`). The MCP server includes the date in search results, so agents (and the chat) can warn about old pages.

### Ask the docs (chat)
An **Ask the docs** button sits at the bottom-right of every page. Answers come from an AI CLI on **your machine**, using your own login and plan. Pick one in the chat panel:

| CLI | Models | Install | Log in |
|---|---|---|---|
| **Claude Code** | Sonnet (default), Opus, Haiku | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude` |
| **Codex** | the models your account offers (read from Codex) | `npm install -g @openai/codex` | `codex login` |

The panel shows each CLI with its icon and a ready/not-ready dot, a model menu, and step-by-step setup (with copy buttons) for a CLI that isn't installed or logged in yet. Each answer is labeled with the CLI and model that wrote it. Switching CLI starts a new conversation; switching model doesn't. The choice is remembered per browser.

**History:** past conversations are saved in your browser (`localStorage`, the latest 50) and listed under **History** in the chat panel, grouped by day and searchable. Open one to keep asking follow-ups (the CLI resumes its session), or delete one or all. History is never sent to a server, so people using your site through a tunnel only see their own. It only shows when the chat itself is available.

`make up` and `make prod` start the chat helper (`chat/server.mjs`, http://localhost:3002) in the background and stop it when you press Ctrl+C or run `make down`. Its log is in `.chat.log`. If Node.js isn't installed, they skip it and the site runs without the chat. `make chat` runs only the helper.

**What the CLIs can do:** only use the docs MCP server's tools: search and read the docs, the live GitHub data and your notes, and save notes when you ask (`create_note`, `update_note`; see [Notes](#notes)). Nothing else.
- **Claude Code** runs with its built-in tools off (no shell, no file access), without your settings, hooks or CLAUDE.md files.
- **Codex** always has a shell, so it's fenced in (macOS only): it runs inside a macOS sandbox that blocks your home folder except `~/.codex` (its login) and an empty working folder; Codex's own shell can't start inside it. Its read-only sandbox is on, approvals are off, and ChatGPT apps/connectors (e.g. GitHub actions), plugins, image generation, sub-agents, web search and browser/computer use are turned off. Your `~/.codex/config.toml` isn't loaded.

The question is passed on stdin, never as a command-line argument, and the helper only accepts requests from pages on this machine. Links like `/any-page?ask=How+do+I+…&cli=codex` open the chat and ask that question.

Settings (environment): `CHAT_PROVIDER` (`claude`), `CHAT_CLAUDE_MODEL` (`sonnet`), `CHAT_CODEX_MODEL` (your Codex default), `CLAUDE_BIN`, `CODEX_BIN`, `CHAT_PORT` (3002), `MCP_URL` (`http://localhost:3001/mcp`). Adding another CLI means adding a file in `chat/providers/`. The icons are in `static/img/providers/` (the Codex one is a placeholder; see the README there). The chat box is hidden on the public GitHub Pages build (`CHAT_API_URL: ''`).

### Notes
**Notes** (navbar: **Workspace → Notes**) is your own notebook: Markdown notes you read, write, tag and search on the site, that AI agents can read and add to, and that are also an [Obsidian](https://obsidian.md) vault. Nothing to set up: `make up` creates a git-ignored `notes/` folder with a Welcome note.

- **Browse** by date, tag or folder, search, and follow `[[links]]` and backlinks. Obsidian syntax (`[[Note]]`, `![[image.png]]`, `#tags`, `> [!note]` callouts) is rendered.
- **Write** on the site (**New note** / **Edit**, with tags and a preview). Saving refuses to overwrite a note that changed elsewhere in the meantime.
- **Copy** a note's Markdown to the clipboard, or **export** a note (`.md`), a folder or a selection of notes (`.zip` with their folders and embedded images).
- **Organize** in a folder tree: **+** adds notes and folders, folders can be renamed (or deleted when empty), and notes move by drag and drop or the editor's Folder field.
- **Write** with a split live preview, templates (`Templates/`; save any note as one), duplicating notes, pasted or dropped images, and drafts kept in the browser until you save. Renaming a note updates the `[[links]]` to it.
- **Find and keep track**: ⌘P quick switcher, pinned notes, an outline beside long notes, and tasks you tick right in the note.
- **Docs pages** list your notes that link to them, with a *Note about this page* link (local only).
- **Delete** a note or a selection, after a confirmation dialog. Deleted notes move to the vault's `.trash` folder (as in Obsidian); the **Trash** page restores them or deletes them for good.
- **AI:** Ask the docs can search and read notes, save notes when asked, and has **Save as note** under each answer. MCP agents get `list_notes`, `search_notes`, `read_note`, `list_note_tags`, `create_note` and `update_note`.
- **Obsidian:** open `notes/` as a vault, or set `NOTES_DIR` in `.env` to a vault you already have. Changes on either side show up on the other.

Notes are local only: the public build has no Notes link (`LIVE_API_URL: ''`), and in `make prod` nginx only serves them to `localhost`. The vault is handled by the MCP server (`mcp/notes.mjs`, `notes-api.mjs`, `notes-tools.mjs`); the page is `src/pages/notes.js`. See the [Notes guide](docs/guides/notes.md).

### Notebooks
**Jupyter Notebooks** (navbar: **Workspace → Jupyter Notebooks**, local only) are Jupyter notebooks for debugging and troubleshooting the Bluecore stack. Off by default: with `JUPYTER_NOTEBOOK=true` in `.env`, `make up` builds and starts JupyterLab (`http://localhost:8888`, service `jupyter`, compose profile `notebooks`) next to the site; its Python kernel reaches your running stack through `host.docker.internal`: the API, Postgres, Airflow and Keycloak.

- **Starters** (`mcp/starter-notebooks/`): stack health check, Blue Core API explorer, Postgres inspection, Airflow DAG runs, integration test triage.
- **Organizing:** the list works like Notes: search (code and outputs too), by date / tag / folder, folders with drag-and-drop, tags, pins, select to export (`.ipynb` / `.zip`) or delete, copies, a Trash with restore (JupyterLab's deletions included), and Copy on outputs (tables paste as tables).
- **On the site:** a full notebook editor: edit, add, move, retype and delete cells, run one or all (Shift+Enter, Stop, restart), rename, clear outputs; edits save on their own. Tables, charts and tracebacks show as in Jupyter. JupyterLab is one click away under **More**.
- **Environments:** each notebook runs against **local** (your stack), **dev** or **stage** (the deployed sites in `docs-sources.json` → `versionDrift.environments`), picked on the page. Notebooks connect through `from bluecore import target` (`docker/jupyter/bluecore.py`), which knows each environment's address and logins and keeps deployed ones read-only. Logins for dev and stage go in `.env.notebooks` (see `.env.notebooks.example`); only JupyterLab gets them.
- **AI:** agents get `list_notebooks`, `read_notebook`, `create_notebook`, `update_notebook` and `run_notebook`. They write and run notebooks only when you ask, and each notebook records which agent and model wrote it and who ran it last.
- **Environment variables:** kernels start with variables matching the notebook's environment (locally, every setting of your stack, e.g. `API_KEYCLOAK_USER`), for notebooks that read `os.environ`. The image includes `bluecore-client`.
- **Your stack checkout:** set `BLUECORE_STACK_DIR` in `.env` to your bluecore-stack checkout. It's mounted read-only into JupyterLab (local notebooks use its `.env` logins) and the MCP server (the `local_stack` tool). To override one local setting, set `BLUECORE_URL`, `BLUECORE_DB_URL`, `AIRFLOW_USER` / `AIRFLOW_PASSWORD` or `KEYCLOAK_USERNAME` / `KEYCLOAK_PASSWORD` in `.env`.

Notebooks are git-ignored files in `notebooks/` (or `NOTEBOOKS_DIR`). JupyterLab writes a new random token on every start to a volume the MCP server reads; it's only reachable from this machine, and in `make prod` nginx serves the notebooks API to `localhost` only, because running a notebook runs code. Code: `mcp/notebooks.mjs`, `jupyter.mjs`, `notebooks-api.mjs`, `notebooks-tools.mjs`; the page is `src/pages/notebooks.js`. See the [Notebooks guide](docs/guides/notebooks.md).

### Google Docs setup
- **If your organization blocks Google API access (no token possible):** in Google Drive, right-click the folder → **Download**. Google zips the Docs as `.docx`. Put the `.zip` in `imports/<name>/` (matching a `driveDownloads` entry in `docs-sources.json`) and run `make sync`. Pandoc converts every doc to Markdown, including images, and keeps the folder structure. Re-download to update. Everything in `imports/` is git-ignored, and the section is left out of the site when the folder is empty.
- **Easiest:** share the doc as *Anyone with the link → Viewer*, then paste its ID (the long string in the URL between `/d/` and `/edit`) into `docs-sources.json`.
- **A whole folder or shared drive:** use `{ "folder": "<id from the folder URL>", "slug": "team-docs", "title": "Team Docs" }`. Every Google Doc (and uploaded `.md` file) inside is pulled, subfolders included. Sheets, Slides and PDFs are skipped. Folders always need `GOOGLE_ACCESS_TOKEN`.
- **Private docs (local):** get a 1-hour access token from the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground): pick scope `https://www.googleapis.com/auth/drive.readonly`, click *Authorize APIs*, then *Exchange authorization code for tokens*. Put the access token in `.env` as `GOOGLE_ACCESS_TOKEN=...` and run `make sync`.
- **Fallback:** in Google Docs, use *File → Download → Markdown (.md)* and drop the file into `imports/<name>/`. Don't put internal docs in `docs/guides/`: that folder is committed and published.

## Sharing your local production site (ngrok)
`make prod` serves everything on **one address, port 8080**: nginx forwards `/api/live/` to the MCP container (live Status data) and `/api/chat/` to the chat helper on your machine. So a tunnel to port 8080 gives visitors the whole site, including the live Status pages and **Ask the docs**. Their questions run on **your** Claude Code / Codex login and usage.

```bash
make prod                                                   # terminal 1
ngrok http 8080 --basic-auth="bluecore:a-long-password"     # terminal 2 (password: 8–128 characters)
```

- **Always put a login in front of it.** The site includes the internal Drive and Box docs and the private project board, and the chat uses your AI account. Use `--basic-auth="user:password"`, or ngrok's Google sign-in limited to your email domain (`--oauth=google --oauth-allow-domain=example.org`).
- **Only tunnel port 8080.** Ports 3001 (MCP) and 3002 (chat helper) only answer requests addressed to `localhost`, so they don't work through a tunnel anyway.
- The chat only accepts questions from pages of the site itself: nginx refuses requests sent by other websites.
- At most 2 chat questions run at once (`CHAT_MAX_CONCURRENT`); extra ones get "busy, try again".
- `make up` (dev, port 3000) keeps calling ports 3001/3002 directly, so it's for local use only.

## Deploying (free)

1. Edit `GITHUB_ORG` / `REPO_NAME` at the top of `docusaurus.config.js`.
2. Push this folder to a GitHub repo.
3. Go to **Settings → Pages → Source: GitHub Actions**.
4. Every push to `main` deploys (`.github/workflows/deploy.yml`), and so does an hourly run. Each deploy pulls the GitHub docs fresh (`npm run sync:readmes`) before building, so they're never stored in the repo.
5. The public site has only public content: GitHub docs and the public Project Status pages (refreshed hourly). It has no Drive, Box, Figma or project board (those are local only), no live data and no chat. If the Integration Tests page has no test details, add a `STATUS_GITHUB_TOKEN` repo secret (any token with public read access).

## Using your AI agent
- `STYLE_GUIDE.md` sets the rules every agent-written page must follow.
- `AGENT_PROMPTS.md` holds ready-made prompts (Getting Started, feature guides, Ruby reference, Google Doc cleanup, PR docs-check, Q&A).
- `https://<your-site>/llms-full.txt` contains the entire doc set in one file. Give it to your agent to "chat with the docs."

### MCP server (agents search the docs themselves)
`make up` also starts an [MCP](https://modelcontextprotocol.io) server at **`http://localhost:3001/mcp`**. Any MCP-capable agent (Claude Code, Claude Desktop, Cursor, VS Code Copilot, …) can then look things up in the docs while it works. Its tools are read-only, except the note tools (which add to and change your notes) and the notebook tools (which write and run notebooks), and agents use those only when you ask:

| Tool | What it does |
|---|---|
| `search_docs` | Keyword search across every page, section by section. Returns the title, heading, snippet, website link (with `#anchor`) and the original source (GitHub/Drive). Optional `path_prefix` limits it to one repo or folder. |
| `read_doc` | Returns a page as Markdown, by path or website URL. Pass `section` to get one heading's part of a long page. |
| `list_docs` | Lists all pages, optionally under a path such as `blue-core-wiki`. |
| `project_board` | **Live** items on the GitHub project board (Blue Core MVP): Status column, assignees, labels, sub-issue progress. Filter by status, repo, assignee (`none` = unassigned), label or text; `summary_only` gives counts per status, person and repo. Done is left out unless asked for. |
| `list_issues` | **Live** open issues across the org's repos, filterable by repo, label, assignee or text. |
| `get_issue` | One issue or pull request in full: description, latest comments, labels, and its Status on the board. |
| `search_issues` | GitHub search over **open and closed** issues and PRs in the org (supports `is:pr is:merged`, `label:bug`, `author:…`). |
| `list_releases` | Latest releases per repo with highlights, or full notes. |
| `list_files` / `get_file` | List a repo's files (filter by folder or text) and read any file, or part of one, on any branch. |
| `search_code` | GitHub code search across the org's repos, with the matching lines (GitHub allows ~10 code searches a minute). GitHub doesn't index forks, so for marva_editor and graph-toolbox it lists matching file names instead. |
| `local_stack` | Your own bluecore-stack checkout (`BLUECORE_STACK_DIR`): branch, last commit, uncommitted changes, compose files and services, `.env` setting names; pass `path` to read a file as it is on your machine. Secret files aren't readable. |
| `fork_changes` | For forks (marva_editor, graph-toolbox): what the fork changed vs its upstream project: commits ahead/behind, files added/modified by folder, commit messages, and a file's diff. |
| `ci_status` | Latest GitHub Actions run of every workflow per repo (default branch), with the failed steps. |
| `recent_changes` | Pull requests merged since a date (default 7 days), grouped by repo; bot dependency updates hidden by default. |
| `integration_tests` | Test health of the integration suite or any repo's own tests: latest result, pass rate, durations, failures by stage, most-failing tests (still failing or fixed), triggers, recent runs. |
| `diagnose_test_failure` | Evidence for why a test run failed: the failing tests' error output, what changed since the last passing run, whether a test is flaky, and hints from common error patterns. The calling agent turns it into a diagnosis (or use the `diagnose_failure` prompt). |
| `list_pull_requests` | Open PRs across the org: age, review status, requested reviewers, CI, conflicts, stale ones. Filter by repo, author, reviewer or status. |
| `version_drift` | Whether the stack runs each service's latest release (image build date, unreleased commits, failed publishes), and whether services lock the latest bluecore-models. |
| `api_endpoints` / `api_endpoint` / `api_schema` | The Blue Core API from its live OpenAPI spec (`apiReference` in `docs-sources.json`): endpoint list, one endpoint in detail (parameters, body, responses, auth, example `curl`), and data models. |
| `docs_health` | Cleanup list: stale pages, broken links between pages (missing pages or headings), near-empty pages, repos without docs. |
| `list_notes` / `search_notes` / `read_note` / `list_note_tags` | Your [notes](#notes): list them by tag, folder or date, search them, read one (or one `section` of it, with its backlinks, and with `include_images` the images it embeds), list the tags. |
| `related_notes` / `list_tasks` / `list_templates` / `list_attachments` / `get_note_image` / `notes_for_doc` / `notes_health` | A note's links, backlinks and notes sharing its tags; open checklist items across notes; templates; images and which notes use them; one image to look at; notes about a docs page; and a tidy-up list. |
| `create_note` / `update_note` / `duplicate_note` / `complete_task` / `rename_note` / `pin_note` / `attach_image` / `save_template` | Add a note (optionally from a template), append to one, replace its text, change its tags or folder, copy it, tick a task, rename (updating links), pin, add an image, or save a template. Agents can't delete notes; only you can, on the Notes page. |
| `list_notebooks` / `read_notebook` | Your [notebooks](#notebooks) and the starters; one notebook's cells and saved outputs (tracebacks included, charts with `include_images`). |
| `create_notebook` / `update_notebook` / `run_notebook` | Write a notebook (optionally from a starter), add, change or delete cells, and run them in JupyterLab against your local stack, dev or stage (`target`), saving the outputs (secret values hidden). With the note tools, the only tools that change anything; `run_notebook` runs code on your machine. |

**Prompts** (one-click reports; in Claude Code they're slash commands like `/mcp__docs__standup_summary`): `standup_summary`, `weekly_update`, `onboarding_plan`, `summarize_epic`, `docs_cleanup`, `notes_review`.

Code, CI and change tools only read the repos the issues page shows (public, not archived, plus listed forks), so private repos stay out even though the token could read them.

The GitHub tools are read-only and limited to the org and board in `projectStatus` (`docs-sources.json`). They share the 2-minute cache and token with the live Status pages, and fall back to the last sync's snapshot (and say so) when GitHub can't be reached. The "Ask the docs" chat can use all of them.

Both modes use the same address, so your agent's config works with either:

| | `make up` (dev) | `make prod` |
|---|---|---|
| Indexes | the live `docs/` folder, re-indexed every 30 seconds, so `make sync` results show up on their own | a snapshot of `docs/` baked into the `bluecore-dev-dashboard-mcp` image, built together with the nginx site, so search results always match what the site serves |
| Result links point to | `http://localhost:3000` | `http://localhost:8080` (or `DOCS_SITE_URL`) |
| To update | nothing to do | run `make prod` again (it syncs first) |

Only one runs at a time: `make prod` stops the dev MCP server and `make up` stops the prod one. To deploy the MCP server elsewhere: `docker build --target mcp --build-arg SITE_URL=https://docs.example.org -t bluecore-dev-dashboard-mcp .`

Connect your agent:
- **Claude Code:** this folder has a `.mcp.json`, so run `claude` here and approve the `docs` server. From any other folder: `claude mcp add --transport http docs http://localhost:3001/mcp`.
- **Other agents:** add an HTTP (Streamable HTTP) MCP server with the URL `http://localhost:3001/mcp`.
- **Without Docker (stdio):** run `npm install --prefix mcp` once, then point the agent at the command `node /path/to/bluecore-dev-dashboard/mcp/server.mjs`.

Settings (in `.env`):
- `DOCS_SITE_URL`: where result links point (default `http://localhost:3000`). Set it to your published site.
- `MCP_ALLOWED_HOSTS`: extra host names allowed to call the server, comma-separated. Only needed when the server is reached by a name other than `localhost`.

The server can read **everything in `docs/`, including internal Google Drive pages**, so the port is bound to `127.0.0.1` (this machine only). It has no login, so put it behind authentication before sharing it on a network.
