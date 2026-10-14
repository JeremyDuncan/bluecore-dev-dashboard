// Ready-made MCP prompts: one-click reports built on the docs and GitHub tools. In Claude Code they
// appear as slash commands (/mcp__docs__standup_summary …); other MCP clients list them too.
import {z} from 'zod';

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
// Last working day: Friday on a Monday, otherwise yesterday
const lastWorkingDay = () => isoDaysAgo(new Date().getDay() === 1 ? 3 : 1);
const user = (textBody) => ({messages: [{role: 'user', content: {type: 'text', text: textBody}}]});

export function registerPrompts(server) {
  server.registerPrompt(
    'standup_summary',
    {
      title: 'Standup summary',
      description: 'What the Blue Core team finished, is working on and is blocked by, plus CI health, since the last working day.',
      argsSchema: {since: z.string().optional().describe('YYYY-MM-DD (default: last working day)'), person: z.string().optional().describe('Only this GitHub user')},
    },
    ({since, person}) => {
      const from = since || lastWorkingDay();
      return user(`Write a short standup summary for the Blue Core team${person ? ` focused on @${person}` : ''}, covering ${from} until now.

Gather facts with the tools first:
1. project_board with status "In Progress" and "In Review"${person ? ` and assignee "${person}"` : ''}; and project_board with status "Done" (include_done) to spot items closed since ${from}.
2. recent_changes since ${from}${person ? ' (keep PRs by this person)' : ''}.
3. ci_status for failing workflows, and integration_tests for the latest integration test result.

Then write, in Markdown, under these headings:
- **Done** (merged PRs and closed board items since ${from})
- **In progress / in review** (who is on what)
- **Blocked or at risk** (failing CI or tests, stale In Progress items with no update for a week, unassigned Ready items)
- **CI** (one line: integration tests and any failing workflows)

Link every issue and PR. Keep it under 250 words. Don't invent anything the tools didn't show.`);
    },
  );

  server.registerPrompt(
    'weekly_update',
    {
      title: 'Weekly update',
      description: 'A weekly progress update for Blue Core: merged work per repo, releases, board movement, test health and what is next.',
      argsSchema: {since: z.string().optional().describe('YYYY-MM-DD (default: 7 days ago)')},
    },
    ({since}) => {
      const from = since || isoDaysAgo(7);
      return user(`Write the Blue Core weekly update for ${from} to today.

Use the tools first:
1. recent_changes since ${from} (merged pull requests per repo).
2. list_releases (keep releases published since ${from}).
3. project_board summary_only, then project_board for "In Review" and "Ready".
4. integration_tests (pass rate, failures this week) and ci_status.

Write it for the whole project team (not only developers), in Markdown:
- **Highlights**: the 3-5 most meaningful changes in plain language
- **Releases**: version and one line each
- **By repository**: short bullets of merged work (skip bot dependency updates)
- **Quality**: integration test pass rate this week and anything still failing
- **Coming up**: what's in review and ready next
Link issues, PRs and releases. Don't invent anything the tools didn't show.`);
    },
  );

  server.registerPrompt(
    'onboarding_plan',
    {
      title: 'Onboarding plan for a new developer',
      description: 'A first-week plan for a new Blue Core developer: setup steps, what to read, the architecture, and good first issues.',
      argsSchema: {focus: z.string().optional().describe('Area they will work on, e.g. "API", "Sinopia", "workflows"'), name: z.string().optional()},
    },
    ({focus, name}) =>
      user(`Create a first-week onboarding plan for ${name ?? 'a new Blue Core developer'}${focus ? ` who will work on ${focus}` : ''}.

Use the tools to ground every step:
1. search_docs / read_doc for the wiki's Developer Onboarding and Local Development Setup pages, and the bluecore-stack local development docs.
2. search_docs for the Blue Core technical stack and how the services fit together${focus ? `, and for ${focus}` : ''}.
3. api_endpoints for an overview of the Blue Core API.
4. list_issues (and project_board with status "Ready") to find 3-5 small, unassigned starter issues${focus ? ` related to ${focus}` : ''}.

Write the plan in Markdown, day by day (Day 1 to Day 5): accounts and access, local setup (exact commands from the docs), reading list (linked pages), a guided tour of the architecture, then a first issue to pick up. Link every page and issue. Mention any setup page that is more than a year old so they can double-check it.`),
  );

  server.registerPrompt(
    'summarize_epic',
    {
      title: 'Summarize an epic or issue',
      description: 'Status of an epic (or any issue): what it is, its sub-issues and where each stands on the board, who is on it, and risks.',
      argsSchema: {repo: z.string().describe('Repository, e.g. "bluecore-workflows"'), number: z.string().describe('Issue number, e.g. "93"')},
    },
    ({repo, number}) =>
      user(`Summarize ${repo}#${number} for the team.

1. get_issue repo "${repo}" number ${number} (description, comments, board status).
2. project_board with query "#${number}" and with repo "${repo}" to find its sub-issues (items "part of #${number}") and their status columns; include_done to count finished ones.
3. If it mentions other issues or PRs, get_issue or search_issues for the important ones.

Write: **What it is** (2-3 sentences), **Progress** (done / in progress / not started, with a list of sub-issues and status), **Who's involved**, **Open questions or risks** (from comments, stale items, unassigned work), **Next steps**. Link everything.`),
  );

  server.registerPrompt(
    'docs_cleanup',
    {
      title: 'Docs cleanup plan',
      description: 'A prioritized list of documentation fixes: broken links, outdated pages and missing docs, with where to fix each.',
      argsSchema: {section: z.string().optional().describe('e.g. "blue-core-wiki"')},
    },
    ({section}) =>
      user(`Use docs_health${section ? ` with section "${section}"` : ''} to find documentation problems. For the most important stale pages, read_doc them and check whether they still match the code or current docs (search_docs, get_file).

Produce a prioritized cleanup list in Markdown: **Fix now** (broken links, wrong instructions), **Review** (stale pages likely out of date, with why), **Write** (missing docs). For each item say exactly where to fix it (the source repo, wiki page, Google Doc or Box file).`),
  );
}
