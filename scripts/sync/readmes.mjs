// Pulls Markdown from GitHub repos or local checkouts into docs/.
//
// "githubOrgs": every repo in an organization → docs/<dir>/<repo>/ (a top-level section with a
//   card per repo), plus every repo wiki → docs/<wikiSection.dir>/ (its own top-level section).
//
// "readmes": individual repos → docs/repos/, in one of two modes:
//   - Single file:  { "repo": "org/repo", "path": "README.md", "slug": "repo" }  → <slug>.md
//   - Many files:   { "repo": "org/repo", "files": ["README.md", "docs/**/*.md"], "slug": "repo" }
//       → <slug>/<same folder structure>; add "wiki": true to also import its wiki into <slug>/wiki/
//
// Links between imported files stay on the docs site; other relative links and images
// are rewritten to absolute GitHub URLs so they keep working. GitHub alerts (> [!NOTE])
// become Docusaurus admonitions.
//
// GITHUB_TOKEN is optional (raises rate limits; required for private repos).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DOCS_DIR, ROOT, convertGithubAlerts, enabled, extractTitle, loadSources, log, summarize, writeDoc} from './lib.mjs';
import {syncWiki} from './wiki.mjs';

const OUT_DIR = path.join(DOCS_DIR, 'repos'); // "readmes" entries
const outputName = (entry) => (entry.files ? entry.slug : `${entry.slug}.md`);

function githubHeaders(accept) {
  const headers = {Accept: accept, 'User-Agent': 'docs-sync'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function rateLimitHint(res) {
  if (res.headers.get('x-ratelimit-remaining') !== '0') return '';
  const minutes = Math.max(1, Math.ceil((Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now()) / 60000));
  const reset = `in ${minutes} min`;
  return process.env.GITHUB_TOKEN
    ? ` — GitHub rate limit hit, resets ${reset}`
    : ` — GitHub's 60 requests/hour limit without a token is used up (resets ${reset}). Add GITHUB_TOKEN to .env`;
}

async function fetchFromGitHub(repo, filePath, ref) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${ref}`, {
    headers: githubHeaders('application/vnd.github.raw+json'),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${repo}/${filePath}${rateLimitHint(res)}`);
  return res.text();
}

// When a file last changed: its latest commit on GitHub (or the file date for local checkouts).
async function lastUpdate(entry, filePath, ref, localRoot) {
  try {
    if (localRoot) return {date: (await fs.stat(path.join(localRoot, filePath))).mtime};
    const res = await fetch(
      `https://api.github.com/repos/${entry.repo}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(ref)}&per_page=1`,
      {headers: githubHeaders('application/vnd.github+json')},
    );
    if (!res.ok) return undefined;
    const [commit] = await res.json();
    if (!commit) return undefined;
    return {date: commit.commit.committer?.date ?? commit.commit.author?.date, author: commit.author?.login ?? commit.commit.author?.name};
  } catch {
    return undefined; // the date is nice to have; never fail the import over it
  }
}

async function listGitHubFiles(repo, ref) {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`, {
    headers: githubHeaders('application/vnd.github+json'),
  });
  if (res.status === 409) return []; // empty repository
  if (!res.ok) throw new Error(`HTTP ${res.status} listing ${repo}@${ref}${rateLimitHint(res)}`);
  const {tree} = await res.json();
  return tree.filter((item) => item.type === 'blob').map((item) => item.path);
}

async function listLocalFiles(root, dir = '') {
  const entries = await fs.readdir(path.join(root, dir), {withFileTypes: true});
  const nested = await Promise.all(
    entries
      .filter((e) => !['.git', 'node_modules', 'vendor', 'tmp'].includes(e.name))
      .map((e) => {
        const rel = path.posix.join(dir, e.name);
        return e.isDirectory() ? listLocalFiles(root, rel) : [rel];
      }),
  );
  return nested.flat();
}

// Minimal glob: `**` matches across folders (`**/` also matches no folder), `*` matches within one segment.
function globToRegExp(glob) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => ({'**/': '(?:.*/)?', '**': '.*', '*': '[^/]*'})[part] ?? escape(part))
    .join('');
  return new RegExp(`^${source}$`);
}

function rewriteRelativeLinks(markdown, {filePath, imported, githubUrl, ref}) {
  const fileDir = path.posix.dirname(filePath) === '.' ? '' : `${path.posix.dirname(filePath)}/`;
  const isRelative = (url) => !/^([a-z]+:|#|\/\/|\/)/i.test(url);
  const repoPath = githubUrl?.replace('https://github.com/', '');
  const blobBase = githubUrl && `${githubUrl}/blob/${ref}/${fileDir}`;
  const rawBase = githubUrl && `https://raw.githubusercontent.com/${repoPath}/${ref}/${fileDir}`;

  const rewriteLink = (match, pre, url) => {
    if (!isRelative(url)) return match;
    const [urlPath, hash] = url.split('#');
    const target = path.posix.normalize(path.posix.join(fileDir, urlPath)).replace(/\/$/, '');
    if (imported.has(target)) return match; // also on the docs site — keep the relative link
    if (imported.has(`${target}/README.md`)) {
      // folder link → that folder's imported README
      return `${pre}${urlPath.replace(/\/$/, '')}/README.md${hash ? `#${hash}` : ''}`;
    }
    return blobBase ? pre + new URL(url, blobBase) : match;
  };
  const rewriteImage = (match, pre, url) => (isRelative(url) && rawBase ? pre + new URL(url, rawBase) : match);

  return markdown
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, rewriteImage)
    .replace(/(<img[^>]*\ssrc=["'])([^"']+)/gi, rewriteImage)
    .replace(/((?<!!)\[[^\]]*\]\()([^)\s]+)/g, rewriteLink);
}

async function syncEntry(entry, outDir) {
  const ref = entry.ref ?? 'HEAD';
  const localRoot = entry.local && path.resolve(ROOT, entry.local);
  const githubUrl = entry.repo ? `https://github.com/${entry.repo}` : entry.githubUrl;
  const readFile = (filePath) =>
    localRoot ? fs.readFile(path.join(localRoot, filePath), 'utf8') : fetchFromGitHub(entry.repo, filePath, ref);

  // Single-file mode
  if (!entry.files) {
    const filePath = entry.path ?? 'README.md';
    const markdown = await readFile(filePath);
    const rewritten = convertGithubAlerts(rewriteRelativeLinks(markdown, {filePath, imported: new Set(), githubUrl, ref}));
    const {title, body} = extractTitle(rewritten, entry.title ?? entry.slug);
    const file = await writeDoc(outDir, {
      slug: entry.slug,
      title: entry.title ?? title,
      lastUpdate: await lastUpdate(entry, filePath, ref, localRoot),
      source: githubUrl ? `${githubUrl}/blob/${ref}/${filePath}` : null,
      body,
    });
    log('readmes', `✓ ${path.relative(ROOT, path.join(entry.logDir ?? OUT_DIR, path.basename(file)))}`);
    return true;
  }

  // Many-files mode
  const patterns = entry.files.map(globToRegExp);
  const excludes = (entry.exclude ?? []).map(globToRegExp);
  const allFiles = localRoot ? await listLocalFiles(localRoot) : await listGitHubFiles(entry.repo, ref);
  const matched = allFiles
    .filter((f) => patterns.some((re) => re.test(f)) && !excludes.some((re) => re.test(f)))
    .sort();

  const imported = new Set(matched);
  const projectDir = path.join(outDir, entry.slug);
  await fs.mkdir(projectDir, {recursive: true});
  await fs.writeFile(
    path.join(projectDir, '_category_.json'),
    JSON.stringify({label: entry.title ?? entry.slug, ...(entry.description && {description: entry.description})}, null, 2) + '\n',
  );

  for (const filePath of matched) {
    const markdown = await readFile(filePath);
    const rewritten = convertGithubAlerts(rewriteRelativeLinks(markdown, {filePath, imported, githubUrl, ref}));
    const name = path.posix.basename(filePath).replace(/\.(md|mdx|markdown)$/i, '');
    const {title, body} = extractTitle(rewritten, name);
    await fs.mkdir(path.join(projectDir, path.posix.dirname(filePath)), {recursive: true});
    // The repo's README is its card on the overview page: describe it with the GitHub description
    const isRepoReadme = /^readme\.(md|mdx|markdown)$/i.test(filePath);
    await writeDoc(path.join(projectDir, path.posix.dirname(filePath)), {
      slug: name,
      title,
      description: isRepoReadme ? (entry.description ?? summarize(body)) : undefined,
      lastUpdate: await lastUpdate(entry, filePath, ref, localRoot),
      source: githubUrl ? `${githubUrl}/blob/${ref}/${filePath}` : null,
      body,
    });
  }

  const wikiPages =
    entry.wiki && entry.repo
      ? await syncWiki(entry.repo, path.join(projectDir, 'wiki'), {token: entry.private && process.env.GITHUB_TOKEN, label: 'Wiki', position: 99})
      : 0;
  if (matched.length + wikiPages === 0) {
    if (entry.optional) return false; // e.g. an org repo with no docs
    throw new Error(`no files matched ${JSON.stringify(entry.files)}${entry.wiki ? ' and no wiki pages' : ''}`);
  }
  const wikiNote = wikiPages ? ` + ${wikiPages} wiki pages` : '';
  log('readmes', `✓ ${path.relative(ROOT, path.join(entry.logDir ?? OUT_DIR, entry.slug))}/ (${matched.length} files${wikiNote})`);
  return true;
}

// Lists every repo in a GitHub organization (or user account).
async function listOrgRepos(org) {
  const repos = [];
  for (const kind of ['orgs', 'users']) {
    for (let page = 1; ; page++) {
      const res = await fetch(`https://api.github.com/${kind}/${org}/repos?per_page=100&type=all&page=${page}`, {
        headers: githubHeaders('application/vnd.github+json'),
      });
      if (res.status === 404 && kind === 'orgs') break; // not an org — try as a user
      if (!res.ok) throw new Error(`HTTP ${res.status} listing repos of ${org}${rateLimitHint(res)}`);
      const batch = await res.json();
      repos.push(...batch);
      if (batch.length < 100) return repos;
    }
  }
  return repos;
}

function orgRepoEntries(org, repos) {
  const skip = new Set(org.skipRepos ?? []);
  return repos
    .filter((r) => !skip.has(r.name))
    .filter((r) => r.default_branch)
    .filter((r) => org.includeArchived || !r.archived)
    .filter((r) => !r.fork || org.includeForks === true || (Array.isArray(org.includeForks) && org.includeForks.includes(r.name)))
    .filter((r) => org.includePrivate || !r.private)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({
      repo: r.full_name,
      ref: r.default_branch,
      files: org.files ?? ['README.md', 'docs/**/*.md', 'doc/**/*.md'],
      exclude: org.exclude ?? ['**/node_modules/**', '**/vendor/**', '.github/**'],
      slug: r.name,
      title: r.name,
      description: r.description ?? undefined,
      hasWiki: r.has_wiki, // imported separately into the wiki section (syncOrgWikis)
      private: r.private,
      optional: true,
    }));
}

// Build into a temp folder and swap it in only on success, so a failed fetch
// (rate limit, network) keeps the pages from the last good sync.
async function syncInto(parentDir, entry) {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'readmes-'));
  try {
    const found = await syncEntry({...entry, logDir: parentDir}, staging);
    const name = outputName(entry);
    await fs.rm(path.join(parentDir, name), {recursive: true, force: true});
    if (found) await fs.cp(path.join(staging, name), path.join(parentDir, name), {recursive: true});
    return found;
  } catch (err) {
    log('readmes', `✗ ${entry.slug}: ${err.message} (kept existing pages)`);
    process.exitCode = 1;
    return true; // keep its existing folder
  } finally {
    await fs.rm(staging, {recursive: true, force: true});
  }
}

// Remove folders/files in `dir` that no longer correspond to a configured source.
async function removeStale(dir, keep) {
  for (const name of await fs.readdir(dir)) {
    if (name !== '_category_.json' && !keep.has(name)) await fs.rm(path.join(dir, name), {recursive: true, force: true});
  }
}

const writeCategory = (dir, category) =>
  fs.writeFile(path.join(dir, '_category_.json'), JSON.stringify(category, null, 2) + '\n');

// All of an org's wikis in one section: the main repo's wiki (e.g. bluecore_info) at the top,
// with its Home page as the section's front page, and other repos' wikis as sub-sections.
async function syncOrgWikis(org, repos) {
  const section = org.wikiSection ?? {};
  const dirName = section.dir ?? `${org.dir ?? org.slug ?? org.org}-wiki`;
  const title = section.title ?? `${org.title ?? org.org} Wiki`;
  const token = org.includePrivate ? process.env.GITHUB_TOKEN : undefined;
  const withWiki = repos.filter((r) => r.hasWiki).sort((a, b) => (a.slug === section.mainRepo ? -1 : b.slug === section.mainRepo ? 1 : 0));

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'wikis-'));
  await fs.chmod(staging, 0o755);
  try {
    const hasMain = withWiki.some((r) => r.slug === section.mainRepo);
    await writeCategory(staging, {
      label: title,
      ...(section.position !== undefined && {position: section.position}),
      // Without a main wiki, the section gets an overview page listing each repo's wiki
      ...(!hasMain && {link: {type: 'generated-index', slug: `/${dirName}`, title, description: section.description}}),
    });
    let total = 0;
    for (const [i, entry] of withWiki.entries()) {
      const isMain = entry.slug === section.mainRepo;
      const dir = isMain ? staging : path.join(staging, entry.slug);
      const pages = await syncWiki(entry.repo, dir, {
        token,
        label: isMain ? undefined : entry.slug,
        position: isMain ? undefined : 1000 + i, // other repos' wikis after the main wiki's pages
        homeTitle: isMain ? title : `${entry.slug} wiki`,
      });
      if (pages) log('readmes', `✓ ${dirName}/${isMain ? '' : `${entry.slug}/`} (${entry.slug} wiki: ${pages} pages)`);
      else if (!isMain) await fs.rm(dir, {recursive: true, force: true});
      total += pages;
    }
    if (total === 0) {
      log('readmes', `- ${dirName}: no wiki pages fetched, leaving existing pages as they are`);
      return;
    }
    const target = path.join(DOCS_DIR, dirName);
    await fs.rm(target, {recursive: true, force: true});
    await fs.cp(staging, target, {recursive: true});
  } finally {
    await fs.rm(staging, {recursive: true, force: true});
  }
}

export async function syncReadmes() {
  const sources = await loadSources();
  const readmes = enabled(sources.readmes);
  const orgs = enabled(sources.githubOrgs);

  if (readmes.length) {
    await fs.mkdir(OUT_DIR, {recursive: true});
    await writeCategory(OUT_DIR, {label: 'Other Repos', position: 80});
    await removeStale(OUT_DIR, new Set(readmes.map(outputName)));
    for (const entry of readmes) await syncInto(OUT_DIR, entry);
  } else {
    await fs.rm(OUT_DIR, {recursive: true, force: true});
  }

  for (const org of orgs) {
    const dirName = org.dir ?? org.slug ?? org.org;
    const orgDir = path.join(DOCS_DIR, dirName);
    let repos;
    try {
      repos = orgRepoEntries(org, await listOrgRepos(org.org));
    } catch (err) {
      log('readmes', `✗ ${org.org}: ${err.message} (kept existing pages)`);
      process.exitCode = 1;
      continue;
    }
    await fs.mkdir(orgDir, {recursive: true});
    const title = org.title ?? org.org;
    // Overview page at /<dir> with a card per repo
    await writeCategory(orgDir, {
      label: title,
      ...(org.position !== undefined && {position: org.position}),
      link: {type: 'generated-index', slug: `/${dirName}`, title, description: org.description},
    });
    const withDocs = new Set();
    for (const entry of repos) {
      if (await syncInto(orgDir, entry)) withDocs.add(entry.slug);
    }
    await removeStale(orgDir, withDocs);
    log('readmes', `✓ ${org.org}: ${withDocs.size} of ${repos.length} repos have docs`);
    if (org.includeWikis) await syncOrgWikis(org, repos);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await syncReadmes();
