# AI Agent Prompts

Copy-paste prompts for your own AI agent. Each one assumes the agent can read the target code repo and this docs repo, and can open a PR.

All prompts start with: **"Read `STYLE_GUIDE.md` in the docs repo first and follow it."**

---

## 1. Getting Started page (from a code repo)
> Read the repo at `<path or URL>`: README, Gemfile/package.json, config files, bin/ scripts, Dockerfile, CI config.
> Write `docs/getting-started/installation.md`: prerequisites with versions, clone, install, configure (list every required env var and what it's for), run locally, run tests. Only include commands you found evidence for in the repo. Open a PR.

## 2. Explain a feature / module (Guides)
> Read `<dir, e.g. app/services/search/>` and its tests.
> Write `docs/guides/<feature>.md` for a new developer: what it does, how data flows through it (add a Mermaid diagram), the key classes and their responsibilities (with GitHub permalinks), how to configure it, two realistic examples taken from the tests, and common pitfalls. Open a PR.

## 3. Reference docs for code without a Markdown generator (e.g. Ruby/Rails)
> For each public class in `<dir>`, write `docs/guides/reference/<class-name>.md` with: purpose, public methods (signature, params, return value, one example), and related classes. Base everything on the code and YARD/RDoc comments. Don't invent behavior. Open a PR.

## 4. Clean up an imported Google Doc → hand-written guide
> Only for docs that may be public: `docs/guides/` is committed and published, while `docs/google-drive/` is local only.
> `docs/google-drive/<slug>.md` was exported from Google Docs and is messy.
> Create a cleaned-up version at `docs/guides/<slug>.md`: fix heading levels, convert pseudo-code to fenced code blocks with language tags, turn "Note:" paragraphs into admonitions, remove empty sections and doc-review cruft. Keep all technical content. Open a PR. (After merging, set that Google Doc's entry to `"enabled": false` in `docs-sources.json` if the guide is now the source of truth.)

## 5. "Does this PR need a docs change?" (use in PR review)
> Here is a code diff: `<diff>`. Here is the full docs set: `<contents of llms-full.txt>`.
> List every docs page that is now inaccurate or missing information because of this change, quoting the outdated sentence. If a new page is needed, say so and draft it. If nothing needs changing, reply "No docs changes needed."

## 6. Answer a question from the docs
> Using only `<site URL>/llms-full.txt`, answer: `<question>`. Cite the page titles you used. If the docs don't answer it, say so and suggest which page should be added.

## 7. Find gaps
> Compare the code in `<repo>` with `llms-full.txt`. List the 10 most important things a new developer would need to know that the docs don't cover, ranked by impact.
