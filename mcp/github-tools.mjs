// Read-only GitHub tools for the MCP server: the project board, open issues, one issue in full,
// issue/PR search and releases, for the org and boards configured in docs-sources.json
// (projectStatus). Data is live (cached ~2 min, shared with the Project Status pages); when
// GitHub can't be reached they fall back to the snapshot from the last sync and say so.
import {z} from 'zod';
import {ciMetrics, failureStage, formatDuration, triggerName} from './ci-metrics.mjs';
import {fetchCiStatus, fetchFailedSteps, fetchFile, fetchForkChanges, fetchIssue, fetchMergedPRs, fetchTree, searchCode, searchIssues} from './github.mjs';
import {allTestSuites, allowedRepos, driftData, githubConfig, integrationTestData, issuesData, projectData, pullsData, releasesData} from './live-api.mjs';

const text = (t) => ({content: [{type: 'text', text: t}]});
const fail = (t) => ({...text(t), isError: true});
const day = (iso) => (iso ? iso.slice(0, 10) : '');
const lower = (s) => String(s ?? '').toLowerCase();
const REPO = /^[A-Za-z0-9_.-]+$/;

function freshness({data, live, error}) {
  return live
    ? `live (fetched ${data.fetchedAt.slice(0, 16).replace('T', ' ')} UTC)`
    : `snapshot from the last sync, ${data.fetchedAt.slice(0, 16).replace('T', ' ')} UTC (live data unavailable: ${error})`;
}

function itemLine(i) {
  const ref = i.repo && i.number ? `${i.repo}#${i.number}` : 'draft';
  const bits = [
    i.kind === 'pr' ? 'pull request' : null,
    i.assignees?.length ? i.assignees.map((a) => `@${a}`).join(', ') : 'unassigned',
    i.labels?.length ? `labels: ${i.labels.map((l) => l.name ?? l).join(', ')}` : null,
    i.milestone ? `milestone: ${i.milestone}` : null,
    i.subIssues ? `sub-issues ${i.subIssues.completed}/${i.subIssues.total}` : null,
    i.parent ? `part of #${i.parent.number}` : null,
    ...Object.entries(i.fields ?? {}).map(([k, v]) => `${k}: ${v}`),
    i.updatedAt ? `updated ${day(i.updatedAt)}` : null,
  ].filter(Boolean);
  return `- ${ref}: ${i.title} — ${bits.join(' · ')}${i.url ? `\n  ${i.url}` : ''}`;
}

const countBy = (items, key) =>
  Object.entries(items.reduce((acc, i) => ((acc[key(i)] = (acc[key(i)] ?? 0) + 1), acc), {}))
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');

export function registerGitHubTools(server) {
  const cfg = githubConfig();
  if (!cfg) return; // projectStatus not configured
  const projects = cfg.projects ?? [];
  const org = cfg.issues?.org ?? projects[0]?.org;
  const readOnly = {readOnlyHint: true, openWorldHint: true};

  if (projects.length) {
    const names = projects.map((p) => `${p.slug ?? p.number}`).join(', ');
    server.registerTool(
      'project_board',
      {
        title: 'GitHub project board',
        description:
          `Items on the ${org} GitHub project board (${names}) with their Status column, assignees, labels, ` +
          'milestone, sub-issue progress and links. Filter by status, repo, assignee, label or text. ' +
          'Done items are left out unless include_done is true or status is "Done". Use summary_only for counts per status and assignee.',
        inputSchema: {
          board: z.string().optional().describe(`Board slug or number (default: the first one: ${names})`),
          status: z.string().optional().describe('Status column, e.g. "In Progress", "In Review", "Ready", "Backlog", "Done"'),
          repo: z.string().optional().describe('Repository name, e.g. "bluecore_api"'),
          assignee: z.string().optional().describe('GitHub login (without @), or "none" for unassigned items'),
          label: z.string().optional(),
          query: z.string().optional().describe('Text to find in the title'),
          include_done: z.boolean().optional(),
          summary_only: z.boolean().optional(),
          limit: z.number().int().min(1).max(300).optional().describe('Max items to list (default 60)'),
        },
        annotations: readOnly,
      },
      async (a) => {
        const project = projects.find((p) => String(p.number) === a.board || p.slug === a.board) ?? projects[0];
        let result;
        try {
          result = await projectData(project);
        } catch (err) {
          return fail(`Couldn't load the board: ${err.message}`);
        }
        const board = result.data;
        const statusOrder = [...board.statuses.map((s) => s.name), null];
        const wantDone = a.include_done || lower(a.status) === 'done';
        const items = board.items.filter(
          (i) =>
            (!a.status || lower(i.status) === lower(a.status)) &&
            (wantDone || i.status !== 'Done') &&
            (!a.repo || lower(i.repo) === lower(a.repo)) &&
            (!a.assignee || (lower(a.assignee) === 'none' ? i.assignees.length === 0 : i.assignees.some((x) => lower(x) === lower(a.assignee.replace(/^@/, ''))))) &&
            (!a.label || i.labels.some((l) => lower(l.name) === lower(a.label))) &&
            (!a.query || lower(`${i.title} ${i.repo} #${i.number}`).includes(lower(a.query))),
        );
        const header = [
          `${board.title} — ${board.url}`,
          `Data: ${freshness(result)}`,
          `All items by status: ${statusOrder.map((s) => `${s ?? 'No status'} ${board.items.filter((i) => i.status === s).length}`).join(', ')}`,
          `Matching items: ${items.length}${wantDone ? '' : ' (Done excluded)'}`,
          items.length ? `Matching by assignee: ${countBy(items.filter((i) => true), (i) => (i.assignees.length ? i.assignees.map((x) => `@${x}`).join('+') : 'unassigned'))}` : null,
          items.length ? `Matching by repo: ${countBy(items, (i) => i.repo ?? 'draft')}` : null,
        ].filter(Boolean);
        if (a.summary_only || items.length === 0) return text(header.join('\n'));

        const limit = a.limit ?? 60;
        const sections = [];
        let shown = 0;
        for (const status of statusOrder) {
          let group = items.filter((i) => i.status === status);
          if (!group.length || shown >= limit) continue;
          if (status === 'Done') group = group.sort((x, y) => (y.closedAt ?? y.updatedAt ?? '').localeCompare(x.closedAt ?? x.updatedAt ?? ''));
          const take = group.slice(0, limit - shown);
          shown += take.length;
          sections.push(`## ${status ?? 'No status'} (${group.length})\n${take.map(itemLine).join('\n')}${take.length < group.length ? `\n… ${group.length - take.length} more (raise limit or filter)` : ''}`);
        }
        return text(`${header.join('\n')}\n\n${sections.join('\n\n')}`);
      },
    );
  }

  if (cfg.issues) {
    server.registerTool(
      'list_issues',
      {
        title: 'Open repo issues',
        description: `Open issues (not pull requests) in the ${org} repositories. Filter by repo, label, assignee or text; sorted by last update.`,
        inputSchema: {
          repo: z.string().optional().describe('Repository name, e.g. "sinopia_editor"'),
          label: z.string().optional(),
          assignee: z.string().optional().describe('GitHub login (without @), or "none" for unassigned'),
          query: z.string().optional().describe('Text to find in the title'),
          limit: z.number().int().min(1).max(300).optional().describe('Max issues (default 50)'),
        },
        annotations: readOnly,
      },
      async (a) => {
        let result;
        try {
          result = await issuesData();
        } catch (err) {
          return fail(`Couldn't load issues: ${err.message}`);
        }
        const all = result.data.repos.flatMap((r) => r.issues.map((i) => ({...i, repo: r.name})));
        const matches = all
          .filter(
            (i) =>
              (!a.repo || lower(i.repo) === lower(a.repo)) &&
              (!a.label || i.labels.some((l) => lower(l.name) === lower(a.label))) &&
              (!a.assignee || (lower(a.assignee) === 'none' ? i.assignees.length === 0 : i.assignees.some((x) => lower(x) === lower(a.assignee.replace(/^@/, ''))))) &&
              (!a.query || lower(i.title).includes(lower(a.query))),
          )
          .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
        const limit = a.limit ?? 50;
        const header = [
          `Open issues in ${result.data.org} — data: ${freshness(result)}`,
          `Matching: ${matches.length} of ${all.length}${matches.length ? ` · by repo: ${countBy(matches, (i) => i.repo)}` : ''}`,
        ];
        const lines = matches.slice(0, limit).map((i) => itemLine({...i, kind: 'issue'}).replace(/ — /, ` — opened by @${i.author ?? '?'} · `));
        return text(`${header.join('\n')}\n\n${lines.join('\n')}${matches.length > limit ? `\n… ${matches.length - limit} more (raise limit or filter)` : ''}`);
      },
    );

    server.registerTool(
      'get_issue',
      {
        title: 'Read an issue or pull request',
        description: `Full details of one ${org} issue or pull request: description, labels, assignees, state, latest comments, and its Status on the project board if it's there.`,
        inputSchema: {
          repo: z.string().describe('Repository name, e.g. "bluecore_api"'),
          number: z.number().int().min(1),
          max_comments: z.number().int().min(0).max(100).optional().describe('Latest comments to include (default 20)'),
        },
        annotations: readOnly,
      },
      async ({repo, number, max_comments}) => {
        if (!REPO.test(repo)) return fail('Invalid repository name');
        if (!process.env.GITHUB_TOKEN) return fail('GITHUB_TOKEN is not set in the MCP server');
        let issue;
        try {
          issue = await fetchIssue({org, repo, number, maxComments: max_comments ?? 20}, process.env.GITHUB_TOKEN);
        } catch (err) {
          return fail(`Couldn't load ${repo}#${number}: ${err.message}`);
        }
        let boardLine = '';
        for (const p of projects) {
          const board = await projectData(p).catch(() => null);
          const item = board?.data.items.find((i) => i.url === issue.url);
          if (item) boardLine += `\nBoard: ${board.data.title} → ${item.status ?? 'No status'}${Object.keys(item.fields).length ? ` (${Object.entries(item.fields).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`;
        }
        const comments = issue.comments.length
          ? `\n\n## Comments (${issue.comments.length} of ${issue.totalComments})\n` +
            issue.comments.map((c) => `### @${c.author} — ${day(c.createdAt)}\n${c.body.slice(0, 3000)}`).join('\n\n')
          : '';
        return text(
          `# ${issue.title}\n${issue.kind} ${repo}#${issue.number} · ${issue.state}${issue.stateReason ? ` (${issue.stateReason})` : ''} · opened by @${issue.author} ${day(issue.createdAt)} · updated ${day(issue.updatedAt)}${issue.closedAt ? ` · closed ${day(issue.closedAt)}` : ''}\n` +
            `Assignees: ${issue.assignees.map((a) => `@${a}`).join(', ') || 'none'} · Labels: ${issue.labels.join(', ') || 'none'}${issue.milestone ? ` · Milestone: ${issue.milestone}` : ''}\n${issue.url}${boardLine}\n\n` +
            `## Description\n${issue.body.slice(0, 12000) || '(no description)'}${comments}`,
        );
      },
    );

    server.registerTool(
      'search_issues',
      {
        title: 'Search issues and pull requests',
        description:
          `GitHub search over all ${org} issues and pull requests, open AND closed (list_issues only has open issues). ` +
          'Supports GitHub search syntax, e.g. "keycloak in:title", "is:pr is:merged", "label:bug", "author:edsu", "repo:blue-core-lod/bluecore_api".',
        inputSchema: {
          query: z.string().min(1),
          state: z.enum(['open', 'closed', 'all']).optional().describe('Default: all'),
          limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
        },
        annotations: readOnly,
      },
      async ({query, state, limit}) => {
        if (!process.env.GITHUB_TOKEN) return fail('GITHUB_TOKEN is not set in the MCP server');
        // Keep the search inside the configured org: drop org:/user: and repo: outside it
        const scoped = query
          .replace(/\b(org|user):\S+/g, '')
          .replace(/\brepo:(\S+)/g, (m, r) => (r.toLowerCase().startsWith(`${org.toLowerCase()}/`) ? m : ''))
          .trim();
        try {
          const r = await searchIssues({org, query: scoped, state, limit: limit ?? 20}, process.env.GITHUB_TOKEN);
          if (!r.items.length) return text(`No issues or pull requests in ${org} match "${scoped}".`);
          return text(
            `${r.total} results in ${org} for "${scoped}"${state && state !== 'all' ? ` (${state})` : ''}, showing ${r.items.length}:\n\n` +
              r.items.map((i) => `- ${i.repo}#${i.number} [${i.kind}, ${i.state}]: ${i.title} — ${i.assignees.map((a) => `@${a}`).join(', ') || 'unassigned'}${i.labels.length ? ` · ${i.labels.join(', ')}` : ''} · updated ${day(i.updatedAt)}\n  ${i.url}`).join('\n'),
          );
        } catch (err) {
          return fail(`Search failed: ${err.message}`);
        }
      },
    );
  }

  if (cfg.releases) {
    server.registerTool(
      'list_releases',
      {
        title: 'Releases',
        description: `GitHub releases of the ${cfg.releases.org} repositories, newest first: version, date, author and highlights (or full notes).`,
        inputSchema: {
          repo: z.string().optional().describe('Repository name; omit for all repos'),
          limit: z.number().int().min(1).max(100).optional().describe('Default 10'),
          include_notes: z.boolean().optional().describe('Include the full release notes'),
        },
        annotations: readOnly,
      },
      async ({repo, limit, include_notes}) => {
        let result;
        try {
          result = await releasesData();
        } catch (err) {
          return fail(`Couldn't load releases: ${err.message}`);
        }
        const list = result.data.releases.filter((r) => !repo || lower(r.repo) === lower(repo)).slice(0, limit ?? 10);
        if (!list.length) return text(`No releases${repo ? ` for ${repo}` : ''}.`);
        return text(
          `Releases — data: ${freshness(result)}\n\n` +
            list
              .map(
                (r) =>
                  `## ${r.repo} ${r.name} — ${day(r.publishedAt)}${r.prerelease ? ' (pre-release)' : ''}${r.author ? ` by @${r.author}` : ''}\n${r.url}\n` +
                  (include_notes ? r.body : r.highlights.map((h) => `- ${h}`).join('\n')),
              )
              .join('\n\n'),
        );
      },
    );
  }

  // --- Source code -------------------------------------------------------------------------------
  const token = () => process.env.GITHUB_TOKEN;
  // Only repos from the allowed list (public, not archived, listed forks)
  async function checkRepo(repo) {
    if (!REPO.test(repo ?? '')) return 'Invalid repository name';
    const repos = await allowedRepos().catch(() => null);
    if (!repos) return 'Couldn\'t load the repository list from GitHub';
    if (!repos.some((r) => r.name === repo)) return `"${repo}" isn't one of the readable repos: ${repos.map((r) => r.name).join(', ')}`;
    return null;
  }

  if (cfg.issues) {
    server.registerTool(
      'list_files',
      {
        title: 'List files in a repo',
        description: `Files in one ${org} repository (default branch unless ref is given), optionally under a folder or matching text. Use it to find the right path for get_file.`,
        inputSchema: {
          repo: z.string(),
          folder: z.string().optional().describe('Only files under this folder, e.g. "src/api"'),
          match: z.string().optional().describe('Only paths containing this text, e.g. "keycloak" or ".py"'),
          ref: z.string().optional().describe('Branch, tag or commit'),
          limit: z.number().int().min(1).max(1000).optional().describe('Default 300'),
        },
        annotations: readOnly,
      },
      async ({repo, folder, match, ref, limit}) => {
        const bad = await checkRepo(repo);
        if (bad) return fail(bad);
        try {
          const tree = await fetchTree({org, repo, ref}, token());
          const prefix = folder ? `${folder.replace(/^\/|\/$/g, '')}/` : '';
          const files = tree.files.filter((f) => f.path.startsWith(prefix) && (!match || f.path.toLowerCase().includes(match.toLowerCase())));
          const max = limit ?? 300;
          return text(
            `${repo}@${tree.ref}: ${files.length} files${prefix ? ` under ${prefix}` : ''}${match ? ` matching "${match}"` : ''}${tree.truncated ? ' (GitHub truncated the tree; narrow with folder)' : ''}\n\n` +
              files.slice(0, max).map((f) => `${f.path}  (${f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`})`).join('\n') +
              (files.length > max ? `\n… ${files.length - max} more` : ''),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    server.registerTool(
      'get_file',
      {
        title: 'Read a source file',
        description: `The contents of one file (or a folder listing) from a ${org} repository, on the default branch unless ref is given. Use line_start/line_end for a part of a long file.`,
        inputSchema: {
          repo: z.string(),
          path: z.string().describe('File path in the repo, e.g. "scripts/export-keycloak-realm.sh"'),
          ref: z.string().optional().describe('Branch, tag or commit'),
          line_start: z.number().int().min(1).optional(),
          line_end: z.number().int().min(1).optional(),
        },
        annotations: readOnly,
      },
      async ({repo, path: filePath, ref, line_start, line_end}) => {
        const bad = await checkRepo(repo);
        if (bad) return fail(bad);
        if (filePath.includes('..')) return fail('Invalid path');
        try {
          const file = await fetchFile({org, repo, path: filePath.replace(/^\//, ''), ref}, token());
          if (file.folder) return text(`${repo}/${filePath} is a folder:\n${file.folder.join('\n')}`);
          const lines = file.text.split('\n');
          const from = Math.max(1, line_start ?? 1);
          const to = Math.min(lines.length, line_end ?? (line_start ? from + 299 : lines.length));
          const MAX = 60000;
          let body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n');
          let note = '';
          if (body.length > MAX) {
            body = body.slice(0, MAX);
            note = `\n… truncated; read the rest with line_start/line_end`;
          }
          return text(`${repo}/${filePath}${ref ? `@${ref}` : ''} — lines ${from}-${to} of ${lines.length}\nhttps://github.com/${org}/${repo}/blob/${ref ?? 'HEAD'}/${filePath}#L${from}-L${to}\n\n${body}${note}`);
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    server.registerTool(
      'search_code',
      {
        title: 'Search source code',
        description: `Search the code of the ${org} repositories (default branches). Returns files with matching lines; read one with get_file. Supports GitHub code search qualifiers like "language:python", "path:tests", "extension:sh". Limited to ~10 searches a minute.`,
        inputSchema: {
          query: z.string().min(1).describe('e.g. "export_realm", "KEYCLOAK_REALM_DIR", "def create_work language:python"'),
          repo: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional().describe('Default 15'),
        },
        annotations: readOnly,
      },
      async ({query, repo, limit}) => {
        if (repo) {
          const bad = await checkRepo(repo);
          if (bad) return fail(bad);
        }
        try {
          const allowed = new Set((await allowedRepos()).map((r) => r.name));
          const scoped = query.replace(/\b(org|user|repo):\S+/g, '').trim();
          const r = await searchCode({org, query: scoped, repo, limit: limit ?? 15}, token());
          const items = r.items.filter((i) => allowed.has(i.repo)); // never show private repos
          const forks = (await allowedRepos()).filter((x) => x.fork).map((x) => x.name);
          const forkNote = forks.length
            ? `\nNote: GitHub code search doesn't index forks (${forks.join(', ')}). For those, use list_files with match, get_file, or fork_changes (what the fork changed vs upstream).`
            : '';
          if (!items.length) {
            if (repo && forks.includes(repo)) {
              // Fall back to matching file paths in the fork
              const tree = await fetchTree({org, repo}, token());
              const words = scoped.toLowerCase().split(/\s+/).filter((w) => !w.includes(':'));
              const paths = tree.files.filter((f) => words.some((w) => f.path.toLowerCase().includes(w))).slice(0, 40);
              return text(
                `${repo} is a fork, and GitHub code search doesn't index forks, so its contents can't be searched.` +
                  (paths.length ? ` Files whose path matches "${scoped}" (read them with get_file):\n${paths.map((f) => `- ${f.path}`).join('\n')}` : ` No file paths match "${scoped}" either.`) +
                  `\nTo see what the fork changed compared with upstream, use fork_changes.`,
              );
            }
            return text(`No code in ${repo ?? org} matches "${scoped}".${forkNote}`);
          }
          return text(
            `${r.total} files match "${scoped}" in ${repo ?? org}, showing ${items.length}:\n\n` +
              items.map((i) => `- ${i.repo}/${i.path}\n  ${i.url}${i.matches.length ? `\n${i.matches.map((m) => `    | ${m.replace(/\n/g, '\n    | ')}`).join('\n    ---\n')}` : ''}`).join('\n') +
              (repo ? '' : forkNote),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    server.registerTool(
      'fork_changes',
      {
        title: 'What a fork changed',
        description:
          `For ${org} repos that are forks of another project (e.g. marva_editor, graph-toolbox): what the fork changed compared with upstream — ` +
          'commits ahead/behind, the files added/modified/removed with line counts, and commit messages. Pass a file path to see that file\'s diff.',
        inputSchema: {
          repo: z.string().describe('A forked repo, e.g. "marva_editor"'),
          path: z.string().optional().describe('Only files under this path; with an exact file path, its diff is shown'),
          commits: z.number().int().min(0).max(250).optional().describe('How many commit messages to list (default 30, newest first)'),
        },
        annotations: readOnly,
      },
      async ({repo, path: only, commits}) => {
        const bad = await checkRepo(repo);
        if (bad) return fail(bad);
        let c;
        try {
          c = await fetchForkChanges({org, repo}, token());
        } catch (err) {
          return fail(err.message);
        }
        const files = c.files.filter((f) => !only || f.path === only || f.path.startsWith(`${only.replace(/\/$/, '')}/`));
        const byStatus = files.reduce((a, f) => ((a[f.status] = (a[f.status] ?? 0) + 1), a), {});
        const folders = new Map();
        for (const f of files) {
          const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '(root)';
          folders.set(dir, [...(folders.get(dir) ?? []), f]);
        }
        const exact = only && files.length === 1 && files[0].path === only ? files[0] : null;
        const n = commits ?? 30;
        return text(
          [
            `# ${repo} vs upstream ${c.upstream} (${c.branch} vs ${c.upstreamBranch})`,
            `${c.aheadBy} commits ahead, ${c.behindBy} behind upstream (${c.status}) — ${c.url}`,
            `${files.length} files changed${only ? ` under ${only}` : ''}: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`,
            `\n## Files by folder\n${[...folders].map(([dir, fs]) => `${dir}/\n${fs.map((f) => `  - ${f.status} ${f.path.split('/').pop()} (+${f.additions} −${f.deletions})`).join('\n')}`).join('\n')}`,
            exact?.patch ? `\n## Diff of ${exact.path}\n\`\`\`diff\n${exact.patch.slice(0, 20000)}\n\`\`\`` : null,
            n ? `\n## Commits (newest first, ${Math.min(n, c.commits.length)} of ${c.commits.length})\n${[...c.commits].reverse().slice(0, n).map((x) => `- ${x.sha} ${x.message} — ${x.author ?? '?'}, ${x.date?.slice(0, 10) ?? ''}`).join('\n')}` : null,
            `\nRead any changed file with get_file (repo "${repo}"); upstream files are in ${c.upstream} on GitHub.`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      },
    );

    // --- CI and changes ------------------------------------------------------------------------------
    server.registerTool(
      'ci_status',
      {
        title: 'CI status (GitHub Actions)',
        description: `Latest GitHub Actions run of each workflow for ${org} repositories on their default branch (or a given branch): passing/failing, when, how long, and which steps failed. Omit repo for every repo.`,
        inputSchema: {repo: z.string().optional(), branch: z.string().optional()},
        annotations: readOnly,
      },
      async ({repo, branch}) => {
        if (repo) {
          const bad = await checkRepo(repo);
          if (bad) return fail(bad);
        }
        try {
          const repos = repo ? [repo] : (await allowedRepos()).map((r) => r.name);
          const results = await Promise.all(repos.map((name) => fetchCiStatus({org, repo: name, branch}, token()).catch((err) => ({repo: name, error: err.message, runs: []}))));
          const icon = (r) => (r.status !== 'completed' ? '⏳' : r.conclusion === 'success' ? '✅' : r.conclusion === 'failure' ? '❌' : '⚪');
          const failing = [];
          const sections = [];
          for (const res of results) {
            if (res.error) {
              sections.push(`## ${res.repo}\n(couldn't load: ${res.error})`);
              continue;
            }
            if (!res.runs.length) continue;
            const lines = [];
            for (const r of res.runs) {
              let detail = '';
              if (r.conclusion === 'failure') {
                failing.push(`${res.repo}: ${r.workflow}`);
                const steps = await fetchFailedSteps({org, repo: res.repo, runId: r.id}, token()).catch(() => []);
                detail = steps.length ? ` — failed: ${steps.map((j) => `${j.job} › ${j.steps.join(', ') || '?'}`).join('; ')}` : '';
              }
              lines.push(`${icon(r)} ${r.workflow} — ${r.status === 'completed' ? r.conclusion : r.status} · ${r.updatedAt.slice(0, 16).replace('T', ' ')} UTC · ${formatDuration(r.durationSec)} · ${r.event}${detail}\n   ${r.url}`);
            }
            sections.push(`## ${res.repo} (${res.branch})\n${lines.join('\n')}`);
          }
          const header = failing.length ? `❌ Failing: ${failing.join('; ')}` : '✅ No failing workflows';
          return text(`${header}\n\n${sections.join('\n\n') || 'No workflow runs found.'}`);
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    server.registerTool(
      'recent_changes',
      {
        title: 'Recently merged pull requests',
        description: `Pull requests merged in the ${org} repositories since a date (default: 7 days ago), grouped by repo. For "what changed this week" and weekly updates.`,
        inputSchema: {
          since: z.string().optional().describe('YYYY-MM-DD (default: 7 days ago)'),
          repo: z.string().optional(),
          include_bots: z.boolean().optional().describe('Include dependency-update PRs from bots (default false)'),
        },
        annotations: readOnly,
      },
      async ({since, repo, include_bots}) => {
        if (repo) {
          const bad = await checkRepo(repo);
          if (bad) return fail(bad);
        }
        const from = /^\d{4}-\d{2}-\d{2}$/.test(since ?? '') ? since : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        try {
          const allowed = new Set((await allowedRepos()).map((r) => r.name));
          let prs = (await fetchMergedPRs({org, since: from, repo}, token())).filter((p) => allowed.has(p.repo));
          const bots = prs.filter((p) => /\[bot\]$|^dependabot|^renovate/i.test(p.author ?? ''));
          if (!include_bots) prs = prs.filter((p) => !bots.includes(p));
          if (!prs.length) return text(`No pull requests merged in ${repo ?? org} since ${from}${bots.length && !include_bots ? ` (except ${bots.length} from bots)` : ''}.`);
          const byRepo = new Map();
          for (const p of prs) byRepo.set(p.repo, [...(byRepo.get(p.repo) ?? []), p]);
          return text(
            `${prs.length} pull requests merged since ${from}${repo ? ` in ${repo}` : ` across ${byRepo.size} repos`}${bots.length && !include_bots ? ` (+${bots.length} bot updates not shown)` : ''}:\n\n` +
              [...byRepo]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([name, list]) => `## ${name} (${list.length})\n${list.map((p) => `- #${p.number} ${p.title} — @${p.author} · merged ${p.mergedAt?.slice(0, 10)}${p.labels.length ? ` · ${p.labels.join(', ')}` : ''}\n  ${p.url}`).join('\n')}`)
                .join('\n\n'),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );
  }

  // --- Open pull requests --------------------------------------------------------------------------
  if (cfg.pullRequests) {
    server.registerTool(
      'list_pull_requests',
      {
        title: 'Open pull requests',
        description:
          `Open pull requests across the ${org} repos, oldest first: age, days since the last update (stale after ${cfg.pullRequests.staleDays ?? 14}), review status (needs review / changes requested / approved / draft), ` +
          'requested reviewers, CI result of the latest commit, merge conflicts and size. Answers "what is waiting for review?", "what is stuck?", "what is ready to merge?".',
        inputSchema: {
          repo: z.string().optional().describe('Only this repo'),
          author: z.string().optional().describe('Only PRs by this GitHub user'),
          reviewer: z.string().optional().describe('Only PRs waiting for this reviewer'),
          review: z.enum(['needs review', 'changes requested', 'approved', 'draft']).optional(),
          stale_only: z.boolean().optional().describe('Only PRs with no update for the stale period'),
          include_drafts: z.boolean().optional().describe('Include draft PRs (default false)'),
        },
        annotations: readOnly,
      },
      async ({repo, author, reviewer, review, stale_only, include_drafts}) => {
        let result;
        try {
          result = await pullsData();
        } catch (err) {
          return fail(`Couldn't load pull requests: ${err.message}`);
        }
        const list = result.data.pulls.filter(
          (p) =>
            (!repo || p.repo === repo) &&
            (!author || lower(p.author) === lower(author)) &&
            (!reviewer || p.reviewers.some((r) => lower(r) === lower(reviewer))) &&
            (!review || p.review === review) &&
            (!stale_only || p.stale) &&
            (include_drafts || review === 'draft' || !p.draft),
        );
        const ready = list.filter((p) => p.review === 'approved' && p.ci === 'passing' && !p.conflicts);
        const lines = list.map(
          (p) =>
            `- ${p.repo}#${p.number}: ${p.title} — @${p.author} · ${p.review}${p.reviewers.length ? ` (waiting on ${p.reviewers.map((r) => `@${r}`).join(', ')})` : ''} · CI ${p.ci ?? 'none'}` +
            `${p.conflicts ? ' · merge conflicts' : ''} · opened ${p.ageDays}d ago, updated ${p.idleDays}d ago${p.stale ? ' · STALE' : ''} · +${p.size.additions} −${p.size.deletions}\n  ${p.url}`,
        );
        return text(
          `${list.length} open pull requests (${freshness(result)}). By review status: ${countBy(list, (p) => p.review) || 'none'}. ` +
            `Ready to merge (approved, CI passing, no conflicts): ${ready.length}. Stale: ${list.filter((p) => p.stale).length}.\n\n${lines.join('\n') || 'None.'}`,
        );
      },
    );
  }

  // --- Version drift --------------------------------------------------------------------------------
  if (cfg.versionDrift) {
    server.registerTool(
      'version_drift',
      {
        title: 'Version drift between releases and the stack',
        description:
          "For each service the stack runs (API, workflows, Sinopia, Marva): its latest release, the image the stack's compose files use and when it was built, unreleased commits on the main branch, and whether the last image publish failed. " +
          'For shared libraries (bluecore-models): the latest release versus what each service locks. Use it when something works in a repo but fails in the stack or the integration tests.',
        inputSchema: {},
        annotations: readOnly,
      },
      async () => {
        let result;
        try {
          result = await driftData();
        } catch (err) {
          return fail(`Couldn't check version drift: ${err.message}`);
        }
        const d = result.data;
        const services = d.services.map(
          (s) =>
            `- **${s.name}** (${s.repo}) — ${s.status.toUpperCase()}: ${s.summary}\n  image ${s.image ?? '?'} built ${day(s.imageBuiltAt) || '?'} · latest release ${s.release?.tag ?? 'none'} (${day(s.release?.publishedAt)})` +
            (s.unreleased?.count ? ` · ${s.unreleased.count} unreleased commits on ${s.branch}: ${s.unreleased.commits.map((c) => c.message).slice(0, 3).join('; ')}` : '') +
            (s.publish ? ` · last publish ${s.publish.conclusion ?? s.publish.status}` : ''),
        );
        const libs = d.libraries.map(
          (l) =>
            `- **${l.name}** — ${l.status.toUpperCase()}: ${l.summary} Latest ${l.release?.tag ?? '?'}; ` +
            l.users.map((u) => `${u.repo}: ${u.inRelease ?? '?'} in its release ${u.releaseTag ?? ''}, ${u.onMain ?? '?'} on main`).join('; '),
        );
        return text(`Version drift (${freshness(result)}), stack: ${d.stackRepo}\n\nServices:\n${services.join('\n')}\n\nLibraries:\n${libs.join('\n') || 'none'}`);
      },
    );
  }

  // --- Integration tests and each repo's own tests ------------------------------------------------
  const suites = allTestSuites();
  if (suites.length) {
    server.registerTool(
      'integration_tests',
      {
        title: 'Test metrics (integration and per repo)',
        description:
          `Health of a test workflow: the integration suite or a repo's own tests (${suites.map((s) => s.title ?? `${s.repo}/${s.workflow}`).join(', ')}): latest result, pass rate, durations, ` +
          'which stage fails (image build / lint / type check / tests / setup), the most-failing tests (and whether they still fail), what triggers runs, and recent runs.',
        inputSchema: {
          suite: z.string().optional().describe('Suite title, repo or workflow name, e.g. "bluecore_api" or "marva_editor (unit)" (default: the integration suite)'),
          recent_runs: z.number().int().min(0).max(50).optional().describe('How many recent runs to list (default 10)'),
        },
        annotations: readOnly,
      },
      async ({suite, recent_runs}) => {
        const match = (test) => suite && suites.find(test);
        const s = match((x) => x.title === suite || x.slug === suite) || match((x) => x.repo === suite) || match((x) => x.workflow.startsWith(suite)) || suites[0];
        let result;
        try {
          result = await integrationTestData(s);
        } catch (err) {
          return fail(`Couldn't load integration test runs: ${err.message}`);
        }
        const data = result.data;
        const m = ciMetrics(data);
        const pct = (v) => (v === null ? '–' : `${v}%`);
        const latest = m.latest;
        const lines = [
          `# ${data.name} (${s.repo}) — ${data.url}`,
          `Data: ${freshness(result)} · last ${m.window.runs} of ${m.window.totalRuns} runs, since ${m.window.since?.slice(0, 10)}`,
          latest ? `Latest: run #${latest.number} ${latest.status === 'completed' ? latest.conclusion : latest.status} · ${latest.createdAt.slice(0, 16).replace('T', ' ')} UTC · ${formatDuration(latest.durationSec)} · trigger ${triggerName(latest)}${latest.tests ? ` · tests ${latest.tests.passed} passed, ${latest.tests.failed} failed, ${latest.tests.skipped} skipped` : ''}\n  ${latest.url}` : null,
          `Pass rate: ${pct(m.passRate.window)} overall · ${pct(m.passRate.last7Days)} last 7 days · ${pct(m.passRate.last20Runs)} last 20 runs (${m.counts.success} passed, ${m.counts.failure} failed, ${m.counts.cancelled} cancelled)`,
          `Current streak: ${m.streak.runs} ${m.streak.kind === 'success' ? 'passing' : 'failing'} runs in a row`,
          `Duration (passing runs): median ${formatDuration(m.duration.medianSec)}, p90 ${formatDuration(m.duration.p90Sec)}; last 10 median ${formatDuration(m.duration.recentMedianSec)} vs previous 10 ${formatDuration(m.duration.earlierMedianSec)}`,
          `Time to fix a failure (failure → next pass): median ${m.recoveryMinutes.median ?? '–'} min over ${m.recoveryMinutes.count} failures`,
          `Runs per day: ${m.runsPerDay}`,
          `Failures by stage: ${Object.entries(m.failureStages).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
          `Triggers: ${Object.entries(m.triggers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`,
          m.latestTests ? `Tests in the latest run with results: ${m.latestTests.passed + m.latestTests.failed + m.latestTests.skipped + m.latestTests.errors} (${m.latestTests.passed} passed, ${m.latestTests.failed} failed, ${m.latestTests.skipped} skipped) in ${formatDuration(m.latestTests.durationSec)}` : null,
          `\n## Most-failing tests (from the logs of ${m.testsReadFrom} runs; ${m.failingNow} failing now)`,
          ...(m.topFailingTests.length
            ? m.topFailingTests.slice(0, 10).map((t) => `- ${t.test} — failed ${t.failures}× (runs ${t.runs.slice(0, 6).map((n) => `#${n}`).join(', ')}${t.runs.length > 6 ? '…' : ''}), ${t.failingNow ? 'STILL FAILING' : `passing since ${t.passedSince?.slice(0, 10) ?? '?'}`}\n  last error: ${t.lastMessage || '–'}`)
            : ['none']),
        ];
        const n = recent_runs ?? 10;
        if (n) {
          lines.push(`\n## Recent runs`);
          for (const r of data.runs.slice(0, n)) {
            lines.push(
              `- #${r.number} ${r.status === 'completed' ? r.conclusion : r.status} · ${r.createdAt.slice(0, 16).replace('T', ' ')} · ${formatDuration(r.durationSec)} · ${triggerName(r)} · ${r.branch}@${r.sha}` +
                (r.tests ? ` · tests ${r.tests.passed}✓ ${r.tests.failed}✗` : '') +
                (r.conclusion === 'failure' ? ` · failed in ${failureStage(r)}${r.failedSteps?.length ? ` (${r.failedSteps.join(', ')})` : ''}` : '') +
                `\n  ${r.url}`,
            );
          }
        }
        return text(lines.filter(Boolean).join('\n'));
      },
    );
  }
}
