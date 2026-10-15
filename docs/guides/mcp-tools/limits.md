---
title: Limits and safety
sidebar_position: 6
description: What the MCP tools can and can't do, and how the server is kept safe.
---

What the MCP server's tools can change, what they can see, and how the server is protected.

- **Read-only, except notes.** The GitHub, code and API tools only read. The eight note tools are the only writes, agents use them only when you ask, and none of them deletes: only you can, on the Notes page.
- **Only Blue Core.** GitHub tools only see the `blue-core-lod` org and the boards in `docs-sources.json`. Code and CI tools skip private and archived repos, even though the token could read them.
- **Cached and fault-tolerant.** GitHub answers are cached for two minutes and shared with the Project Status pages. When GitHub can't be reached, tools answer from the last sync's snapshot and say so. `search_code` is limited to about ten searches a minute.
- **This machine only.** The server binds to `127.0.0.1` and has no login, because the docs include internal Drive and Box pages. Put it behind authentication before you share it on a network.
- **Know who wrote what.** Notes an AI writes record the agent and exact model, and the Notes page shows them.

## Related

- [Notes](/guides/notes): the vault, Obsidian, and AI authorship in detail
- [Live GitHub data](/guides/live-github-data): where the GitHub tools' data comes from and how fresh it is
- [How content gets onto the site](/guides/content-lifecycle): what the docs tools can search
