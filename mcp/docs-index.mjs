// In-memory search index over the Markdown in docs/ (the same files the website is built from).
//
// Each page is split into sections at its headings, and sections are ranked with BM25.
// Words in page titles and headings count extra. No build step is needed: the index reads
// docs/ directly and rebuilds itself when files change, so a `make sync` shows up right away.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const SITE_URL = (process.env.DOCS_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const REFRESH_MS = 30_000;

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how i if in is it of on or that the this to was what when where which who why with you your'.split(' '),
);

export function tokenize(text) {
  return (text.toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

// Same rules Docusaurus (github-slugger) uses for heading anchors.
function anchor(heading, seen) {
  let slug = heading.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  const count = seen.get(slug) ?? 0;
  seen.set(slug, count + 1);
  return count ? `${slug}-${count}` : slug;
}

function parseFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {data: {}, body: raw};
  const data = {};
  let parent = null; // for one level of nesting, e.g. last_update: { date, author }
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\s*)(\w+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[3].trim();
    try {
      value = JSON.parse(value);
    } catch {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    if (kv[1] && parent) data[parent][kv[2]] = value;
    else if (value === '') data[(parent = kv[2])] = {};
    else (parent = null), (data[kv[2]] = value);
  }
  return {data, body: raw.slice(match[0].length)};
}

// "01-intro" → "intro", but dates like "2023-09-notes" are kept (Docusaurus' default number prefix parser).
function stripNumberPrefix(name) {
  if (/^\d+[-_.]\d+/.test(name)) return name;
  return name.replace(/^\d+\s*[-_.]+\s*(?=[^-_.\s])/, '');
}

// docs/ path → website URL, following Docusaurus routing (routeBasePath: '/').
function pageUrl(rel, slug) {
  const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  if (typeof slug === 'string' && slug) {
    const p = slug.startsWith('/') ? slug : path.posix.join('/', dir, slug);
    return SITE_URL + p;
  }
  const parts = rel.replace(/\.mdx?$/, '').split('/').map(stripNumberPrefix);
  const last = parts.at(-1);
  if (/^(index|readme)$/i.test(last) || (parts.length > 1 && last === parts.at(-2))) parts.pop();
  return `${SITE_URL}/${parts.join('/')}`;
}

async function listMarkdown(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch (err) {
    console.error(`[mcp] skipping ${path.relative(DOCS_DIR, dir) || 'docs'}: ${err.code ?? err.message}`); // don't let one folder stop the server
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listMarkdown(full)));
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function splitSections(body) {
  const sections = [];
  let current = {heading: null, depth: 1, lines: []};
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      sections.push(current);
      current = {heading: h[2].replace(/[*_`]/g, ''), depth: h[1].length, lines: []};
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.map((s) => ({...s, text: s.lines.join('\n').trim()})).filter((s) => s.heading || s.text);
}

async function build() {
  const pages = [];
  const sections = [];
  for (const file of (await listMarkdown(DOCS_DIR)).sort()) {
    const rel = path.relative(DOCS_DIR, file).split(path.sep).join('/');
    const {data, body: rawBody} = parseFrontMatter(await fs.readFile(file, 'utf8'));
    const body = rawBody.replace(/^<!-- GENERATED[\s\S]*?-->\n*/m, '');
    const h1 = body.match(/^#\s+(.+)$/m)?.[1];
    const title = String(data.title ?? h1 ?? path.basename(rel).replace(/\.mdx?$/, ''));
    const source = typeof data.custom_edit_url === 'string' ? data.custom_edit_url : null;
    const updated = data.last_update?.date ? String(data.last_update.date) : null;
    const page = {path: rel, title, url: pageUrl(rel, data.slug), source, updated, body};
    pages.push(page);

    const seen = new Map();
    for (const s of splitSections(body)) {
      const sectionAnchor = s.heading ? anchor(s.heading, seen) : null;
      const tokens = [
        ...Array(3).fill(tokenize(title)).flat(),
        ...Array(2).fill(tokenize(s.heading ?? '')).flat(),
        ...tokenize(s.text),
      ];
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      sections.push({page, heading: s.heading, anchor: sectionAnchor, text: s.text, tf, length: tokens.length});
    }
  }

  const df = new Map();
  for (const s of sections) for (const t of s.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLength = sections.reduce((n, s) => n + s.length, 0) / Math.max(sections.length, 1);
  return {pages, sections, df, avgLength, builtAt: Date.now()};
}

let index;
let building;
export async function getIndex() {
  if (!index || Date.now() - index.builtAt > REFRESH_MS) {
    building ??= build().finally(() => (building = null));
    index = await building;
  }
  return index;
}

function snippet(text, terms, size = 300) {
  const plain = text.replace(/```[\s\S]*?```/g, ' [code] ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const lower = plain.toLowerCase();
  const hit = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), plain.length);
  const start = hit === plain.length ? 0 : Math.max(0, hit - size / 3);
  return (start > 0 ? '…' : '') + plain.slice(start, start + size).trim() + (start + size < plain.length ? '…' : '');
}

export async function search(query, {limit = 8, pathPrefix} = {}) {
  const {sections, df, avgLength} = await getIndex();
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const N = sections.length;
  const k1 = 1.2;
  const b = 0.75;
  const phrase = query.toLowerCase().trim();

  const scored = [];
  for (const s of sections) {
    if (pathPrefix && !s.page.path.startsWith(pathPrefix)) continue;
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const f = s.tf.get(t);
      if (!f) continue;
      matched++;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * s.length) / avgLength)));
    }
    if (!score) continue;
    score *= matched / terms.length; // prefer sections that contain every word
    if (terms.length > 1 && `${s.heading ?? ''} ${s.text}`.toLowerCase().includes(phrase)) score *= 1.5;
    scored.push({s, score});
  }
  scored.sort((x, y) => y.score - x.score);

  // At most 2 sections per page, so one long page can't crowd out the rest.
  const perPage = new Map();
  const results = [];
  for (const {s, score} of scored) {
    const n = perPage.get(s.page.path) ?? 0;
    if (n >= 2) continue;
    perPage.set(s.page.path, n + 1);
    results.push({
      title: s.page.title,
      section: s.heading,
      url: s.page.url + (s.anchor ? `#${s.anchor}` : ''),
      path: s.page.path,
      source: s.page.source,
      updated: s.page.updated,
      score: Number(score.toFixed(2)),
      snippet: snippet(s.text || s.heading || '', terms),
    });
    if (results.length >= limit) break;
  }
  return results;
}

// Accepts a docs/ path ("guides/writing-docs.md"), a site URL, or a URL path.
export async function findPage(ref) {
  const {pages} = await getIndex();
  const clean = ref.trim().replace(/^docs\//, '').replace(/#.*$/, '');
  const asPath = clean.replace(/^\.?\//, '');
  const byPath = pages.find((p) => p.path === asPath || p.path.replace(/\.mdx?$/, '') === asPath);
  if (byPath) return byPath;
  const urlPath = clean.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
  return pages.find((p) => p.url.replace(SITE_URL, '').replace(/\/$/, '') === urlPath.replace(/\/$/, '')) ?? null;
}

export function extractSection(page, heading) {
  const want = heading.toLowerCase().replace(/^#+\s*/, '').trim();
  const sections = splitSections(page.body);
  const i = sections.findIndex((s) => s.heading?.toLowerCase() === want);
  if (i < 0) return null;
  // Include sub-sections (deeper headings) until the next heading at the same level or above.
  const parts = [`${'#'.repeat(sections[i].depth)} ${sections[i].heading}\n\n${sections[i].text}`];
  for (const s of sections.slice(i + 1)) {
    if (s.depth <= sections[i].depth) break;
    parts.push(`${'#'.repeat(s.depth)} ${s.heading}\n\n${s.text}`);
  }
  return parts.join('\n\n');
}

export function headings(page) {
  return splitSections(page.body).filter((s) => s.heading).map((s) => `${'  '.repeat(s.depth - 2)}- ${s.heading}`);
}

// Every heading anchor on a page (as Docusaurus generates them), for link checking.
export function pageAnchors(page) {
  const seen = new Map();
  return new Set(splitSections(page.body).filter((s) => s.heading).map((s) => anchor(s.heading, seen)));
}

// Site URL prefix the page URLs start with (DOCS_SITE_URL)
export const SITE_URL_PREFIX = SITE_URL;
