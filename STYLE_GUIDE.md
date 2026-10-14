# Docs Style Guide

Your AI agent should read this file before writing or editing any page.

## Voice
- Write for a developer who is new to the project and smart, but missing context.
- Use second person ("you"), present tense and active voice.
- Keep it short. Use one idea per paragraph and lists over long prose.

## Structure of every page
1. Front matter with `title` (and `sidebar_position` if order matters)
2. One or two sentences: **what this is and why you'd care**
3. The steps or explanation
4. A runnable example
5. "Related" links at the bottom

## Formatting
- Use `##` for sections, since the page title is the H1. Don't skip heading levels.
- Every code block needs a language tag (` ```ruby `, ` ```bash `).
- Use admonitions for asides: `:::tip`, `:::note`, `:::warning`, `:::danger`.
- Link to code on GitHub with permalinks, not bare file paths.
- Write hand-written pages as `.md`. Use `.mdx` only when you need React components (e.g. Tabs).

## Never
- Invent APIs, flags or config keys. If unsure, leave a `<!-- TODO: verify -->` comment.
- Edit files under `docs/blue-core-repos/`, `docs/blue-core-wiki/`, `docs/google-drive/`, `docs/box/` or `docs/reference/`, because they are generated and get overwritten.
- Paste secrets, internal hostnames or credentials.
