# Local setup

Get the docs site running on your computer.

## 1. Install

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**: required. It runs everything.
- **[GitHub CLI](https://cli.github.com)** (`gh`): recommended. The easiest way to get a GitHub token.
- **[Node.js](https://nodejs.org) 20+**: only for the "Ask the docs" chat.
- **[Box Drive](https://www.box.com/drive)**: only if you want the Box docs.

## 2. Clone

Clone into the folder that holds your other repos:

```bash
cd ~/Code
git clone https://github.com/JeremyDuncan/bluecore-dev-dashboard.git
cd bluecore-dev-dashboard
```

## 3. Add your settings

```bash
cp .env.example .env
gh auth login                                   # skip if already logged in
gh auth refresh -s read:project                 # lets the token read the project board
echo "GITHUB_TOKEN=$(gh auth token)" >> .env    # adds your token to .env
```

- **Why a token?** Without one, GitHub blocks the sync after 60 requests.
- **Box docs:** add this line to `.env` (the usual Mac location):
  ```bash
  BOX_DIR=${HOME}/Library/CloudStorage/Box-Box
  ```
  In Box Drive, make the **Blue Core MVP planning** folder available offline.
- **Never commit `.env`.** It holds your token (git already ignores it).

## 4. Add internal docs (optional)

These are private, so they're never committed. Each developer adds their own copy. If they're missing, the site just leaves those sections out.

- **Google Drive**
  1. Open the [Shared Drive folder](https://drive.google.com/drive/folders/0AAhAJgoVw1ArUk9PVA).
  2. Right-click → **Download**. You may get several `.zip` files. Keep them all.
  3. Move the `.zip` files into `imports/shared-drive/`. Don't unzip them.
  4. To update later, delete the old zips first, then download again.
- **Box:** set `BOX_DIR` (step 3).
- **Figma design notes:** copy the pages (and their `img/` folder) into `docs/design/`.

## 5. Start it

```bash
make up
```

- First, it pulls in all the docs. The first run can take a few minutes; later runs take about 30 seconds.
- Then open **http://localhost:3000**.
- Stop with **Ctrl+C**, or run `make down`.

What's running:

- **http://localhost:3000**: the docs site (updates when you edit files)
- **http://localhost:3001/mcp**: the MCP server for AI agents
- **http://localhost:3002**: the "Ask the docs" chat helper

## Everyday commands

| Command | What it does |
|---|---|
| `make up` | Pull in all docs, then start |
| `make up SYNC=0` | Quick restart, without pulling |
| `make sync` | Pull in all docs (works while the site is running) |
| `make prod` | Production version at http://localhost:8080 |
| `make down` | Stop everything |
| `make rebuild` | Rebuild after dependencies change |

## Chat setup (optional)

The **Ask the docs** button uses an AI tool on your computer, with your own account. Install one and log in once:

- **Claude Code**
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  claude          # log in, then type /exit
  ```
- **Codex** (Mac only)
  ```bash
  npm install -g @openai/codex
  codex login
  ```

The chat panel shows whether each tool is ready, with setup steps if not. It can only read the docs. It can't run commands or open your files.

## Connect your AI agent (optional)

While `make up` is running:

- **Claude Code in this folder:** run `claude` and approve the `docs` server.
- **Claude Code anywhere else:**
  ```bash
  claude mcp add --transport http docs http://localhost:3001/mcp
  ```
- **Other agents:** add the MCP server `http://localhost:3001/mcp`.

## Something wrong?

| Problem | Fix |
|---|---|
| "60 requests an hour" error | Add `GITHUB_TOKEN` to `.env` (step 3). |
| Project Status is empty | Run `gh auth refresh -s read:project`, update the token in `.env`, then `make up`. |
| Box docs missing | Check `BOX_DIR` in `.env`, and that the folder is available offline in Box Drive. |
| Drive docs missing | Check the `.zip` files are in `imports/shared-drive/`, then `make sync`. |
| Drive or Box pages look wrong | `SYNC_FORCE=1 make sync` re-converts everything. |
| A new section's link is missing | Restart `make up`. |
| Errors after pulling new code | `make rebuild`, then `make up`. |
| "Port already in use" | `make down`, then try again. |

## Learn more

- `docs/guides/content-lifecycle.md`: where each part of the site comes from
- `docs/guides/live-github-data.md`: how the Project Status pages work
- `README.md`: how everything fits together
