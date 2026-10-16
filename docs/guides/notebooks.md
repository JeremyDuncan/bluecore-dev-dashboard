---
title: Notebooks
sidebar_position: 5
sidebar_class_name: sidebar-icon sidebar-icon--notebook
description: "Jupyter notebooks for debugging and troubleshooting Bluecore. They run Python in a local JupyterLab container, against your running stack (its API, Postgres, Airflow and Keycloak) or a deployed environment (dev, stage), and AI agents can write and run them for you."
hero_actions:
  - {label: Open Notebooks, to: /notebooks, primary: true, needs: notebooks}
---

This page explains how to use them, the starter notebooks, environments, and how agents work with them.

## Getting started

Notebooks are off by default. Turn them on in this repo's `.env`, then run `make up`:

```bash
JUPYTER_NOTEBOOK=true
```

`make up` then builds and starts JupyterLab next to the site (the first build takes a few minutes), and the navbar gets **Notebooks**. Without it, JupyterLab is neither built nor started, and the site, MCP server and Ask the docs leave notebooks out; your notebooks stay in `notebooks/`. Then:

1. Open **Notebooks** in the navbar (only on the local site).
2. Pick a starter, or click **Add all to a Starters folder** to copy them into `Starters/` (when new starters arrive, the same link adds just those).
3. Pick where it runs: **local**, **dev** or **stage** (see [Environments](#environments)).
4. Click **Run all**. Outputs (tables, charts, errors) appear under each cell and are saved in the notebook.

## Editing on the page

You edit notebooks right on the Notebooks page, no JupyterLab needed:

- **Code cells** are editors: click into one and type. <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> indent, and <kbd>Enter</kbd> keeps the indentation (one level more after a `:`).
- **Run:** <kbd>Shift</kbd>+<kbd>Enter</kbd> runs the cell and moves to the next one (adding a cell at the end), <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs it in place, or use ▶. **Run all**, **Restart & run all** and **Stop** are at the top.
- **Markdown cells:** double-click (or ✎) to edit, <kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Esc</kbd> to finish.
- **Cells:** point between two cells for **+ Code** / **+ Markdown**; each cell's toolbar moves it up or down, changes its type, or deletes it (with **Undo** for a few seconds).
- **More:** clear all outputs, restart the kernel, open the notebook in JupyterLab, or delete it. Click the title to rename it.

Edits save on their own a moment after you stop typing, and before every run (<kbd>Ctrl</kbd>+<kbd>S</kbd> saves now). If the notebook changed elsewhere meanwhile (JupyterLab or an agent), the page says so instead of overwriting it. An edited cell keeps its old output until you run it again, as in Jupyter.

### Organizing, copying and exporting

The list on the left works like the Notes list:

- **Search** (Enter) looks through titles, tags, code, Markdown and outputs.
- **By date / By tag / By folder.** Tags are added under a notebook's title; the folder view shows folders as a tree. Folders can sit inside folders. Drag a notebook onto a folder to move it, or use **More → Move to**; drag a folder onto another one to move it with everything in it (notebooks and sub-folders). The **+** next to *Folders* adds a notebook or a folder at the top; a folder's own **+** adds one inside it. Folders can be renamed, exported, and deleted when empty.
- **Pin** (📌 next to *More*) keeps a notebook at the top.
- **Select** picks several notebooks to export (one `.ipynb`, or a `.zip` keeping folders) or delete. Folders can be ticked too, empty ones included: deleting moves the notebooks to the trash and removes the selected folders once they're empty.
- **More → Make a copy** duplicates a notebook (outputs included); **More → Export (.ipynb)** downloads it.
- **Copy** on an output copies it: tables paste into a spreadsheet as a table, a chart alone as an image, anything else as text.
- **Trash** (bottom of the list) shows deleted notebooks, including ones deleted in JupyterLab, and **Restore** puts one back where it was.

JupyterLab is still there for anything else (`http://localhost:8888`, **More → Open in JupyterLab**, or `make lab` for its address with the token).

:::note[Your stack must be running]
To check your local stack, start it from the `bluecore-stack` repo first, as described in [Local Development](/blue-core-repos/bluecore-stack/docs/local-development). Set `BLUECORE_STACK_DIR` so the notebooks use its settings (see [Your stack checkout](#your-stack-checkout)).
:::

## Starter notebooks

One notebook for each everyday job, grouped by purpose as on the Notebooks page. Each runs as it is: pick an environment and click **Run all**. The ones marked *local only* create records and delete them again at the end, so they stop on dev and stage.

**Check the stack**

| Starter | What it does |
|---|---|
| **Stack health check** | Whether each service answers its health endpoint, which version it runs, and how that compares with the latest releases (from the Version Drift data). |
| **Compare environments** | Local, dev and stage side by side: service versions, how many hubs, works, instances and profiles each holds, and the same search on each. |

**Blue Core API**

| Starter | What it does |
|---|---|
| **Blue Core API: every endpoint** | One call to each of the API's endpoints, grouped by purpose (find, read, history, write, convert, workflows), then a check against the live OpenAPI spec that flags any endpoint it doesn't cover yet. Locally it creates and deletes its own example records; on dev or stage it reads existing ones and skips the calls that need a login. |
| **Find and read records** | Search (types, title scope, phrases, paging), open a work, follow it to its instances, and get it in every format (JSON-LD, Turtle, RDF/XML, CBD, …). |
| **Create, edit and delete records** | A hub, a work and an instance of it, created from the API's own examples, edited, compared across versions and deleted. *Local only.* |
| **Record history and change feeds** | The works and instances change feeds (what changed, when), and the difference between a record's last two versions. |
| **Profiles (Sinopia templates)** | Find a profile, list the properties it defines, and (locally) create, rename and delete a copy. |

**Load and export**

| Starter | What it does |
|---|---|
| **Convert MARC to BIBFRAME** | MARC (the API's example, or your file) to MARCXML and to BIBFRAME in each format, what the conversion produced, and optionally loading it. *Local only.* |
| **Load records with a batch** | Uploads JSON-LD as a batch, follows the Airflow run to the end (with the failed task's log if it fails), lists the records it made and deletes them. *Local only.* |
| **Export to a catalog (LSP)** | Recent export runs, and exporting one instance to an institution's catalog, which stays off until you set `SEND = True`. *Local only.* |

**Debug**

| Starter | What it does |
|---|---|
| **Keycloak login and permissions** | Signs in, decodes the token (user, groups, roles), and shows which API endpoints those roles allow: the first stop for a `401` or `403`. |
| **Airflow DAG runs** | The workflows (DAGs), their recent runs, and the log of the latest failed task. |
| **Postgres inspection** | The `bluecore` database: tables and their sizes, records by kind, recent rows, and queries running right now. Read-only. Local only, unless you can reach a deployed database. |
| **Integration test triage** | The Bluecore Integration Test's recent runs from GitHub: pass rate, durations and the tests that failed most. |

The notebooks share helpers from `bluecore.py`: `show(response)` prints a response briefly, `bc.example("/works/")` returns the API's own example body for an endpoint, `bc.sample("works")` picks an existing record, `bc.wait_for_run(dag, run)` follows an Airflow run, and `marc21(...)` builds a binary MARC record for testing.

## Environments

Each notebook runs against one environment, which it remembers (in its metadata). Switch it with **Runs against** above the notebook. Switching clears the outputs, so results from two environments never mix.

| Environment | Where | What the notebooks can do |
|---|---|---|
| **local** | Your stack, through `host.docker.internal` (port 80 for Nginx, 5432 for Postgres) | Everything: the API, Postgres, Airflow, Keycloak. |
| **dev** | `https://dev.bcld.info` | Read: health, versions, the API. Airflow and Keycloak need a login (below). |
| **stage** | `https://stage.bcld.info` | The same as dev. |

The deployed environments are the ones in `docs-sources.json` (`projectStatus.versionDrift.environments`), the same list the Version Drift page checks. Add one there and it shows up on the Notebooks page.

:::warning[Dev and stage are shared]
Notebooks only **read** deployed environments. The helper refuses any request other than GET, HEAD and OPTIONS, and opens database sessions read-only. A notebook that really has to write must say so with `target("dev", allow_writes=True)`. Read it before you run it.
:::

### The `bluecore` helper

Notebooks connect through a small Python module in the JupyterLab image (`docker/jupyter/bluecore.py`), which knows each environment's address and logins:

```python
from bluecore import target

bc = target()                      # the notebook's environment (or target("stage"))
bc                                 # shows where it runs, e.g. "Target: dev · https://dev.bcld.info · deployed, read-only"
bc.get("/api/health").json()       # HTTP, relative to the environment's address
conn = bc.db()                     # Postgres, read-only
airflow, api = bc.airflow()        # a signed-in session for the Airflow REST API
headers = bc.auth_headers()        # a Keycloak token, for API endpoints that need auth
```

When a login is missing, the helper says exactly which setting to add.

### Environment variables

Notebooks that read settings straight from environment variables work too, like ones an agent wrote with `os.environ`. When a kernel starts, it sets them to match the notebook's environment:

| Environment | What the kernel's environment variables hold |
|---|---|
| **local** | Every setting of your stack: its `.env` and the repo `.env` templates it installs (`scripts/dev/env-templates`), so `API_KEYCLOAK_USER`, `AIRFLOW_WWW_USER_USERNAME`, `KEYCLOAK_REALM` and the rest are there. Addresses with `localhost` point at `host.docker.internal`, which the container can reach. |
| **dev**, **stage** | Only that environment's address and the logins from `.env.notebooks`. None of your local stack's settings, so a notebook can't mix the two. |

Either way you get `BLUECORE_TARGET`, `BLUECORE_URL`, `API_URL`, `KEYCLOAK_EXTERNAL_URL`, `AIRFLOW_EXTERNAL_URL`, `API_KEYCLOAK_USER` / `API_KEYCLOAK_PASSWORD` (also as `KEYCLOAK_USERNAME` / `KEYCLOAK_PASSWORD`), `AIRFLOW_USER` / `AIRFLOW_PASSWORD` and, where there is one, `BLUECORE_DB_URL`. Switching a notebook's environment restarts its kernel so the variables follow.

The image includes [`bluecore-client`](https://pypi.org/project/bluecore-client/), the Blue Core API's Python client, so notebooks don't need `%pip install`.

### Logins for dev and stage

Copy `.env.notebooks.example` to `.env.notebooks` (git-ignored) and fill in what you have, for example:

```bash
BLUECORE_DEV_AIRFLOW_USER=…
BLUECORE_DEV_AIRFLOW_PASSWORD=…        # or BLUECORE_DEV_AIRFLOW_TOKEN
BLUECORE_DEV_KEYCLOAK_USERNAME=…
BLUECORE_DEV_KEYCLOAK_PASSWORD=…
# BLUECORE_DEV_DB_URL=postgresql://…    # only if you can reach the database, e.g. through an SSH tunnel
```

Then restart JupyterLab: `docker compose --profile notebooks up -d jupyter`. Only the JupyterLab container gets these (it never gets `GITHUB_TOKEN`), and the MCP server hides their values in anything it sends to AI agents. Never type passwords into a notebook. <!-- TODO: verify how deployed Airflow signs in (password or Keycloak) -->

## Your stack checkout

Set `BLUECORE_STACK_DIR` in this repo's `.env` to your bluecore-stack checkout, then restart with `make up`:

```bash
BLUECORE_STACK_DIR=/Users/you/Code/bluecore-stack
```

It's mounted read-only (at `/bluecore-stack`) into JupyterLab and the MCP server, so:

- Notebooks use **your stack's settings** for the local environment: the database, Airflow and Keycloak logins come from its `.env` and the repo `.env` templates it installs (see [Environment variables](#environment-variables)). Without it, they fall back to the stack's documented local-development logins. Changes to a service repo's own `.env` (for example `bluecore_api/.env`) aren't read; override those in this repo's `.env`.
- The `local` badge shows the checkout's branch and uncommitted changes, so you know which code you're debugging.
- AI agents can read the checkout with the [`local_stack`](/guides/mcp-tools/tools/code#local_stack) tool, including changes you haven't pushed. Settings files that may hold secrets (`.env`, `.secrets`, Keycloak exports) aren't readable.

To override one local setting, set it in this repo's `.env`, for example `BLUECORE_URL`, `BLUECORE_DB_URL`, `AIRFLOW_USER`/`AIRFLOW_PASSWORD`, or `KEYCLOAK_USERNAME`/`KEYCLOAK_PASSWORD` (for API endpoints that need auth). `DASHBOARD_API_URL` (`http://mcp:3001/api`) gives notebooks this site's live GitHub data.

If Postgres's port isn't published on your machine, connect JupyterLab to the stack's Docker network and use the host `postgres` instead. The Postgres starter notebook shows the commands.

## Notebooks and AI

**Ask the docs** and any agent connected to the [MCP server](/guides/mcp-tools) can work with notebooks:

| Tool | What it does |
|---|---|
| `list_notebooks` | Your notebooks, how many cells ran or failed, the starters and the environments. |
| `read_notebook` | A notebook's cells and saved outputs, including tracebacks; `include_images` returns charts. |
| `create_notebook` | Writes a new notebook, from cells and/or a starter, for an environment (`target`). |
| `update_notebook` | Adds, changes or deletes cells, clears outputs, or switches the environment. |
| `run_notebook` | Runs the code cells in JupyterLab's kernel and saves the outputs; `target` switches the environment first. |

Agents write and run notebooks only when you ask, for example *"Create a notebook that checks why exporting to the catalog fails, and run it"* or *"Run the stack health notebook against stage"*. They use dev or stage only when you name them. Outputs are checked for known secrets (your stack's passwords and keys, the logins in `.env.notebooks`) before they reach the agent. A notebook records which agent and model wrote it and who ran it last, and the Notebooks page shows both. Agents can't delete notebooks; only you can, on the Notebooks page (deleted notebooks go to the folder's `.trash`).

The kernel is shared: a notebook open in JupyterLab and the same notebook run from the page or by an agent use one kernel, so variables carry over between runs. Use **Restart & run all** for a clean run.

:::warning[Running a notebook runs code on your machine]
`run_notebook` lets an agent run Python against your local stack or a deployed environment. The helper keeps deployed environments read-only and the chat's instructions tell agents to prefer read-only checks, but read what an agent wrote before asking it to run anything that writes.
:::

## Where notebooks live

Notebooks are `.ipynb` files in `notebooks/` in this repo (git-ignored, like your notes), or the folder `NOTEBOOKS_DIR` names in `.env`. The starters are committed in `mcp/starter-notebooks/`, written by `scripts/make-starter-notebooks.py`: edit the cells there and run it (`python3 scripts/make-starter-notebooks.py`) to change a starter or add one for everyone.

## Troubleshooting

| Problem | Fix |
|---|---|
| No **Notebooks** in the navbar | Set `JUPYTER_NOTEBOOK=true` in `.env` and run `make up`. |
| "JupyterLab isn't running" | Run `make up`, or `docker compose --profile notebooks up -d jupyter`. |
| "JupyterLab refused the token" | Restart both: `docker compose restart jupyter mcp`. |
| A cell can't connect to the stack | Check the stack is running (`docker compose ps` in `bluecore-stack`) and that the notebook runs against the environment you meant. |
| `NotConfigured: … needs BLUECORE_DEV_…` | Add that login to `.env.notebooks`, then `docker compose --profile notebooks up -d jupyter`. |
| `ReadOnlyError` | The cell tried to change a deployed environment. Check it really should, then use `target("dev", allow_writes=True)`. |
| "Set BLUECORE_STACK_DIR" in the sidebar | Point `BLUECORE_STACK_DIR` in `.env` at your checkout and run `make up`. |
| A cell timed out | Cells are stopped after 2 minutes. Agents can pass a longer `timeout_seconds` (up to 10 minutes). |

## Related

- [MCP tools: Notebooks](/guides/mcp-tools/tools/notebooks): the notebook tools in detail
- [Notes](/guides/notes): your Markdown notes, for what you learned
- [Live GitHub data](/guides/live-github-data): where the test and drift data comes from
