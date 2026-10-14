// Imports a GitHub repo's wiki (a separate git repo: <repo>.wiki.git) into a docs folder.
//
// Wiki pages are flat files named after the page ("📋-Developer-Onboarding.md"). They get clean
// URL slugs, Home becomes the section's index page, and wiki-style links ([[Text|Page]],
// ./Page, https://github.com/<repo>/wiki/Page) are re-pointed at the imported pages.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {convertGithubAlerts, extractTitle, writeDoc} from './lib.mjs';
import {slugify} from './google-docs.mjs';

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

// GitHub turns the page title "Foo - Bar" into "Foo---Bar" and a literal hyphen into "‐" (U+2010).
function pageTitle(name, homeTitle = 'Wiki Home') {
  if (name === 'Home') return homeTitle;
  return name.replace(/---/g, ' ‐ ').replace(/-/g, ' ').replace(/‐/g, '-').replace(/\s+/g, ' ').trim();
}

const pageKey = (name) => decodeURIComponent(name).normalize('NFC').replace(/ /g, '-').toLowerCase();

function clone(repo, dir, token) {
  const auth = token ? `x-access-token:${token}@` : '';
  try {
    // Full history (wikis are small), so each page's last edit date and author are known
    execFileSync('git', ['clone', '--quiet', `https://${auth}github.com/${repo}.wiki.git`, dir], {
      stdio: 'pipe',
      env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
    });
    return true;
  } catch {
    return false; // wiki disabled or has no pages yet
  }
}

// Last commit that touched a page: its date and author
function lastEdit(dir, file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI%x09%an', '--', file], {cwd: dir, encoding: 'utf8'}).trim();
    const [date, author] = out.split('\t');
    return date ? {date, author} : undefined;
  } catch {
    return undefined;
  }
}

function rewriteWikiLinks(markdown, {repo, pages}) {
  const wikiUrl = `https://github.com/${repo}/wiki`;
  const rawBase = `https://raw.githubusercontent.com/wiki/${repo}/`;
  const outputs = new Set([...pages.values()].map((slug) => `${slug}.md`));
  const local = (target) => {
    const [name, hash] = target.split('#');
    const file = pages.get(pageKey(name || 'Home'));
    return file && `./${file}.md${hash ? `#${hash}` : ''}`;
  };
  const toTarget = (url) => {
    const wikiPrefix = new RegExp(`^https://github\\.com/${repo.replace('/', '\\/')}/wiki/?`, 'i');
    if (wikiPrefix.test(url)) return local(url.replace(wikiPrefix, '')) ?? url;
    if (/^([a-z]+:|#|\/\/|\/)/i.test(url)) return url;
    const rel = url.replace(/^\.\//, '');
    if (outputs.has(rel.split('#')[0])) return url; // already converted from [[...]] above
    if (IMAGE.test(rel.split('#')[0])) return rawBase + rel;
    return local(rel) ?? `${wikiUrl}/${rel}`;
  };

  return markdown
    // [[Text|Page]], [[Page]], [[image.png]]
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => {
      const [text, target] = b ? [a, b] : [a, a];
      if (IMAGE.test(target)) return `![${text}](${rawBase}${target.trim()})`;
      const href = local(target.trim().replace(/ /g, '-')) ?? `${wikiUrl}/${encodeURI(target.trim().replace(/ /g, '-'))}`;
      return `[${text.trim()}](${href})`;
    })
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, pre, url) => pre + toTarget(url))
    .replace(/((?<!!)\[[^\]]*\]\()([^)\s]+)/g, (m, pre, url) => pre + toTarget(url));
}

// Writes the pages into wikiDir (Home becomes its index page) and returns how many were
// imported (0 when the repo has no wiki). Pass label to give the folder its own sidebar category.
export async function syncWiki(repo, wikiDir, {token, label, position, homeTitle} = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-'));
  try {
    if (!clone(repo, tmp, token)) return 0;
    const files = (await fs.readdir(tmp)).filter((f) => /\.(md|markdown)$/i.test(f) && !f.startsWith('_')).sort();
    if (files.length === 0) return 0;

    // page name → output file name, avoiding collisions after slugifying
    const pages = new Map();
    const used = new Set();
    for (const f of files) {
      const name = f.replace(/\.(md|markdown)$/i, '');
      let slug = name === 'Home' ? 'index' : slugify(name);
      for (let i = 2; used.has(slug); i++) slug = `${slugify(name)}-${i}`;
      used.add(slug);
      pages.set(pageKey(name), slug);
    }

    await fs.mkdir(wikiDir, {recursive: true});
    if (label) {
      const category = {label, ...(position !== undefined && {position})};
      await fs.writeFile(path.join(wikiDir, '_category_.json'), JSON.stringify(category, null, 2) + '\n');
    }
    // Number the pages alphabetically by title (ignoring leading emoji), so the sidebar reads
    // naturally and any sub-folders with a higher position sort after them
    const sortKey = (f) => pageTitle(f.replace(/\.(md|markdown)$/i, '')).replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase();
    const ordered = [...files].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    for (const [i, f] of ordered.entries()) {
      const name = f.replace(/\.(md|markdown)$/i, '');
      const markdown = convertGithubAlerts(rewriteWikiLinks(await fs.readFile(path.join(tmp, f), 'utf8'), {repo, pages}));
      const {title, body} = extractTitle(markdown, pageTitle(name, homeTitle));
      await writeDoc(wikiDir, {
        slug: pages.get(pageKey(name)),
        title,
        position: name === 'Home' ? 0 : i + 1,
        lastUpdate: lastEdit(tmp, f),
        source: `https://github.com/${repo}/wiki/${encodeURIComponent(name)}`,
        body,
      });
    }
    return files.length;
  } finally {
    await fs.rm(tmp, {recursive: true, force: true});
  }
}
