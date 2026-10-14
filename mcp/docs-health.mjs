// docs_health: a cleanup list for the docs: stale pages, broken links between pages, near-empty
// pages, and repos whose docs are missing. Works from the docs index (docs/) plus the repo list.
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {DOCS_DIR, SITE_URL_PREFIX, getIndex, pageAnchors} from './docs-index.mjs';
import {allowedRepos} from './live-api.mjs';

const text = (t) => ({content: [{type: 'text', text: t}]});
const DAY = 86400000;
const section = (p) => p.path.split('/')[0];

// Overview pages that Docusaurus generates from _category_.json ("link": {"type": "generated-index", "slug": …})
function generatedIndexSlugs(dir = DOCS_DIR, out = new Set()) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) generatedIndexSlugs(full, out);
    else if (entry.name === '_category_.json') {
      try {
        const slug = JSON.parse(fs.readFileSync(full, 'utf8')).link?.slug;
        if (slug) out.add(slug.replace(/\/$/, ''));
      } catch {
        // ignore unreadable category files
      }
    }
  }
  return out;
}

// Links in a page that point at other pages on this site: relative .md/.mdx files or /paths
function internalLinks(page) {
  const links = [];
  const body = page.body.replace(/```[\s\S]*?```/g, ''); // not inside code blocks
  for (const m of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|tel:|#$)/i.test(target)) continue;
    if (target.startsWith('#') || target.startsWith('/') || /\.mdx?(#|$)/.test(target) || target.startsWith('./') || target.startsWith('../')) links.push(target);
  }
  return links;
}

function checkLink(page, target, pages, byPath, byUrl, indexSlugs) {
  const [raw, hash] = target.split('#');
  let dest;
  if (!raw) dest = page;
  else if (raw.startsWith('/') && indexSlugs.has(raw.replace(/\/$/, ''))) return null;
  else if (raw.startsWith('/')) dest = byUrl.get(raw.replace(/\/$/, '') || '/');
  else {
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(page.path), decodeURIComponent(raw)));
    dest = byPath.get(rel) ?? byPath.get(`${rel}.md`) ?? byPath.get(`${rel}.mdx`) ?? byPath.get(`${rel.replace(/\/$/, '')}/README.md`) ?? byPath.get(`${rel.replace(/\/$/, '')}/index.md`);
    if (!dest && !/\.mdx?$/.test(raw)) return null; // a relative link to a non-doc file (image, script): not our concern
  }
  if (!dest) return 'page not found';
  if (hash && !pageAnchors(dest).has(decodeURIComponent(hash))) return `no heading #${hash} on ${dest.path}`;
  return null;
}

export function registerDocsHealthTool(server) {
  server.registerTool(
    'docs_health',
    {
      title: 'Docs health',
      description:
        'A cleanup list for this docs site: stale pages (not updated for a long time), broken links between pages (missing pages or headings), ' +
        'near-empty pages, and Blue Core repos with no README or docs. Filter by section (e.g. "blue-core-wiki", "google-drive").',
      inputSchema: {
        section: z.string().optional().describe('Top-level docs folder, e.g. "blue-core-repos", "blue-core-wiki", "google-drive", "box"'),
        stale_after_days: z.number().int().min(30).optional().describe('Default 365'),
        limit: z.number().int().min(5).max(200).optional().describe('Max items per list (default 25)'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({section: only, stale_after_days, limit}) => {
      const {pages} = await getIndex();
      const max = limit ?? 25;
      const staleDays = stale_after_days ?? 365;
      const byPath = new Map(pages.map((p) => [p.path, p]));
      const byUrl = new Map(pages.map((p) => [p.url.replace(SITE_URL_PREFIX, '').replace(/\/$/, '') || '/', p]));
      const indexSlugs = generatedIndexSlugs();
      const scope = pages.filter((p) => (!only || section(p) === only) && !p.path.startsWith('project-status/'));

      const stale = scope
        .filter((p) => p.updated && Date.now() - new Date(p.updated).getTime() > staleDays * DAY)
        .sort((a, b) => a.updated.localeCompare(b.updated));
      const broken = [];
      for (const p of scope) for (const l of internalLinks(p)) {
        const problem = checkLink(p, l, pages, byPath, byUrl, indexSlugs);
        if (problem) broken.push({page: p, link: l, problem});
      }
      const thin = scope.filter((p) => p.body.replace(/<!--[\s\S]*?-->|[#*_`>\-|]/g, '').replace(/\s+/g, ' ').trim().length < 150);

      let missing = [];
      let repoNote = '';
      if (!only || only === 'blue-core-repos') {
        try {
          const repos = await allowedRepos();
          const withDocs = new Set(pages.filter((p) => p.path.startsWith('blue-core-repos/')).map((p) => p.path.split('/')[1]));
          const docsCount = (name) => pages.filter((p) => p.path.startsWith(`blue-core-repos/${name}/`)).length;
          missing = repos.filter((r) => !withDocs.has(r.name)).map((r) => `- ${r.name}: no README or docs imported${r.description ? ` (${r.description})` : ''}`);
          const readmeOnly = repos.filter((r) => docsCount(r.name) === 1).map((r) => r.name);
          if (readmeOnly.length) repoNote = `README only (no docs/ folder): ${readmeOnly.join(', ')}`;
        } catch (err) {
          repoNote = `(repo check skipped: ${err.message})`;
        }
      }

      const bySection = (list) => Object.entries(list.reduce((a, p) => ((a[section(p.page ?? p)] = (a[section(p.page ?? p)] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ');
      const out = [
        `# Docs health${only ? ` — ${only}` : ''} (${scope.length} pages checked)`,
        `Stale (older than ${staleDays} days): ${stale.length}${stale.length ? ` — ${bySection(stale)}` : ''}`,
        `Broken links: ${broken.length}${broken.length ? ` — ${bySection(broken)}` : ''}`,
        `Near-empty pages: ${thin.length}`,
        missing.length || repoNote ? `Repos: ${missing.length} without docs${repoNote ? `; ${repoNote}` : ''}` : null,
        broken.length ? `\n## Broken links\n${broken.slice(0, max).map((b) => `- ${b.page.path}: [${b.link}] → ${b.problem}${b.page.source ? `\n  fix in: ${b.page.source}` : ''}`).join('\n')}${broken.length > max ? `\n… ${broken.length - max} more` : ''}` : null,
        stale.length ? `\n## Oldest pages\n${stale.slice(0, max).map((p) => `- ${p.updated} — ${p.title} (${p.path})${p.source ? `\n  source: ${p.source}` : ''}`).join('\n')}${stale.length > max ? `\n… ${stale.length - max} more` : ''}` : null,
        thin.length ? `\n## Near-empty pages\n${thin.slice(0, max).map((p) => `- ${p.title} (${p.path})`).join('\n')}` : null,
        missing.length ? `\n## Repos without docs\n${missing.join('\n')}` : null,
      ];
      return text(out.filter(Boolean).join('\n'));
    },
  );
}
