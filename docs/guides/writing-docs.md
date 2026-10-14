---
title: How these docs work
---

## Adding or changing docs

- **Hand-written pages** live in `docs/guides/`. Edit them directly and open a PR.
- **Generated pages** live in `docs/blue-core-repos/`, `docs/blue-core-wiki/`, `docs/google-drive/`, `docs/box/` and `docs/reference/`. They aren't committed: GitHub content is pulled on every build, and Drive and Box exist only on machines that have the files. Don't edit them here. Change the source (the repo, wiki page, Google Doc or Box file) and they update on the next sync.

## Adding a new source

Add an entry to `docs-sources.json`:

```json
{ "repo": "my-org/my-repo", "path": "README.md", "slug": "my-repo", "title": "My Repo" }
```

Then run `make sync` locally. The public site picks it up on its next deploy (every push to `main`, and hourly).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Local preview at http://localhost:3000 |
| `npm run sync` | Pull every source (GitHub docs, Drive downloads, Box, Project Status); rebuild `llms.txt` |
| `npm run build` | Production build into `build/` |
