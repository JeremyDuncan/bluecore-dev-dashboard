// Notes: a folder of Markdown files that is also an Obsidian vault. Shared by the live API (the
// site's Notes page, live-api.mjs) and the MCP notes tools (notes-tools.mjs).
//
// Everything is plain files, so the vault works without Obsidian and Obsidian works without this
// site: open the folder as a vault in Obsidian at any time, or point NOTES_DIR at an existing vault.
// A note is `<folder>/<Title>.md` with optional YAML front matter. The site reads and writes:
//   tags      list of tags (Obsidian's "tags" property); inline #tags in the text count too
//   created   ISO date-time, set when the site or an agent creates a note
//   updated   ISO date-time, set on every save from the site or an agent
//   author    who created it from here: "you", or the AI agent ("Claude Code", "Codex", …)
//   model     the exact AI model that wrote it, e.g. "claude-sonnet-4-5-20250929" (AI-written notes)
//   edited_by / edited_model   the AI that last changed its text (cleared when you save it here)
// Other properties (aliases, anything Obsidian or a plugin adds) are kept as they are.
//
// NOTES_DIR: the vault folder (default ./notes in this repo; /notes inside Docker, where
// docker-compose.yml mounts the folder named by NOTES_DIR in .env).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validIcon} from './folder-icons.mjs';
import YAML from 'yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VAULT = path.resolve(REPO, process.env.NOTES_DIR || 'notes');
// The folder's name on the host, which is also the vault's name in Obsidian (for obsidian:// links).
// Inside Docker the folder is /notes, so compose passes the host path in NOTES_SOURCE.
export const VAULT_NAME = process.env.NOTES_VAULT_NAME || path.basename(process.env.NOTES_SOURCE || VAULT);

const ATTACHMENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};
const MAX_NOTE_BYTES = 1_000_000;

export class NoteError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const WELCOME = `---
tags: [getting-started]
created: ${new Date().toISOString()}
---
# Welcome to your notes

This folder is your notes vault: plain Markdown files, one per note.

- **On the site:** open **Notes** in the navbar to read, search and write notes, and browse them by date, tag or folder.
- **With AI:** "Ask the docs" and any agent connected to the MCP server can search, read and add notes (\`search_notes\`, \`read_note\`, \`create_note\`, …).
- **In Obsidian:** open this folder as a vault (*Open folder as vault*). Notes you write there show up on the site, and the other way round.

Tag a note with front matter (\`tags: [meeting, api]\`) or inline, like #getting-started. Link one note to another with \`[[Note title]]\`.

Delete this note whenever you like.
`;

// Creates the vault with a welcome note the first time
export function ensureVault() {
  fs.mkdirSync(VAULT, {recursive: true});
  if (!walk().length) fs.writeFileSync(path.join(VAULT, 'Welcome.md'), WELCOME);
}

// --- Paths ---------------------------------------------------------------------------------------

// A vault-relative path from a client → absolute path inside the vault, or an error.
// Dot folders (.obsidian, .trash, .git) are never read or written.
function resolve(rel, {ext} = {}) {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) {
    throw new NoteError(400, `Invalid path "${rel}"`);
  }
  if (ext && !ext.includes(path.extname(clean).toLowerCase())) throw new NoteError(400, `Not a ${ext.join('/')} file: "${rel}"`);
  const abs = path.resolve(VAULT, clean);
  if (!abs.startsWith(VAULT + path.sep)) throw new NoteError(400, `Invalid path "${rel}"`);
  // A symlink inside the vault may not lead outside it
  if (fs.existsSync(abs) && !fs.realpathSync(abs).startsWith(fs.realpathSync(VAULT) + path.sep)) throw new NoteError(400, `Invalid path "${rel}"`);
  return {abs, rel: clean};
}

// Every Markdown file in the vault (vault-relative, "/" separators), skipping dot folders
function walk(dir = VAULT, prefix = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    if (e.name.startsWith('.') || e.name === 'node_modules') return [];
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return walk(path.join(dir, e.name), rel);
    return e.isFile() && e.name.toLowerCase().endsWith('.md') ? [rel] : [];
  });
}

// The attachments folder (pasted and dropped images) is for images only: the app doesn't show it
// as a folder, and notes and folders can't be put in it. Images in it still embed as ![[name]].
export function isAttachmentsFolder(folder) {
  const dir = cleanFolder(ATTACHMENT_DIR).toLowerCase();
  const rel = String(folder ?? '').replace(/^\/+|\/+$/g, '').toLowerCase();
  return Boolean(dir) && (rel === dir || rel.startsWith(`${dir}/`));
}

function notInAttachments(folder) {
  if (isAttachmentsFolder(folder)) throw new NoteError(400, `"${cleanFolder(ATTACHMENT_DIR)}" is the folder for images; put notes and folders somewhere else`);
}

// Every folder in the vault, empty ones included (vault-relative), skipping dot folders and the
// attachments folder
export function listFolders(dir = VAULT, prefix = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap((e) => {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (isAttachmentsFolder(rel)) return [];
      return [rel, ...listFolders(path.join(dir, e.name), rel)];
    });
}

// Characters Obsidian doesn't allow in a note name (plus path separators)
const safeName = (s) =>
  String(s)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

// --- Parsing -------------------------------------------------------------------------------------

function splitFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return {data: {}, body: text};
  try {
    const data = YAML.parse(m[1]);
    return {data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, body: text.slice(m[0].length)};
  } catch {
    return {data: {}, body: text, badFrontMatter: true}; // shown as text rather than lost
  }
}

// Obsidian tags: letters, digits, _ - / (nested tags), not only digits. Stored without the "#".
const normTag = (t) => String(t ?? '').trim().replace(/^#/, '');
// Needs a letter, _ or - ("#339/#340" is issue numbers, not a tag) and no / at either end
const validTag = (t) => /^[\p{L}\p{N}_\-/]+$/u.test(t) && /[\p{L}_-]/u.test(t) && !/^\/|\/$/.test(t);

// Tags: a list, or one string of tags separated by commas or spaces (a tag has no spaces)
function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(asList);
  return String(v).split(/[,\s]+/).filter(Boolean);
}

// Aliases: a list, or one alias (which may contain spaces)
const asNames = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((a) => String(a).trim()).filter(Boolean));

// Text outside code blocks and inline code
const proseOnly = (body) => body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');

function inlineTags(body) {
  const tags = [];
  for (const m of proseOnly(body).matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) if (validTag(m[2])) tags.push(m[2]);
  return tags;
}

function wikiLinks(body) {
  return [...proseOnly(body).matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

// Unique, case-insensitively (Obsidian treats #API and #api as one tag); the first spelling wins
function uniqueTags(list) {
  const seen = new Map();
  for (const t of list.map(normTag).filter(validTag)) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

function validDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

const excerptOf = (body) =>
  proseOnly(body)
    .replace(/^#+\s.*$/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '') // table separator rows
    .replace(/\|/g, ' ')
    .replace(/^\s*>?\s*\[![\w-]+\][+-]?/gm, '') // callout markers
    .replace(/^[\s>]*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, '') // list markers and task boxes (in quotes too)
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '') // embedded images
    .replace(/!?\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>`~=]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

// Parsed notes, kept until the file changes (mtime + size)
const cache = new Map();

function load(rel) {
  const abs = path.join(VAULT, rel);
  const stat = fs.statSync(abs);
  const hit = cache.get(rel);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.note;
  const text = stat.size > MAX_NOTE_BYTES ? '' : fs.readFileSync(abs, 'utf8');
  const {data, body, badFrontMatter} = splitFrontMatter(text);
  const fileName = path.basename(rel, path.extname(rel));
  // Created: the note's own date, else the file's (birthtime isn't kept on every file system)
  const created = validDate(data.created) ?? validDate(data.date) ?? validDate(stat.birthtimeMs > 0 ? stat.birthtime : null) ?? stat.mtime;
  // Updated: whichever is later, our property or the file (an edit in Obsidian only changes the file)
  const stamped = validDate(data.updated) ?? validDate(data.modified);
  const updated = stamped && stamped > stat.mtime ? stamped : stat.mtime;
  const note = {
    path: rel,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : fileName,
    folder: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
    tags: uniqueTags([...asList(data.tags ?? data.tag), ...inlineTags(body)]),
    propertyTags: uniqueTags(asList(data.tags ?? data.tag)), // the editable ones; inline #tags live in the text
    aliases: asNames(data.aliases ?? data.alias),
    created: created.toISOString(),
    updated: updated.toISOString(),
    author: typeof data.author === 'string' ? data.author : null,
    model: typeof data.model === 'string' ? data.model : null,
    editedBy: typeof data.edited_by === 'string' ? data.edited_by : null,
    editedModel: typeof data.edited_model === 'string' ? data.edited_model : null,
    pinned: data.pinned === true,
    icon: validIcon(data.icon) ? data.icon : null, // its own icon on the Notes page ("line:<name>" or "emoji:<emoji>")
    template: isTemplatePath(rel),
    links: [...new Set(wikiLinks(body))],
    excerpt: excerptOf(body),
    words: (body.match(/\S+/g) ?? []).length,
    mtimeMs: stat.mtimeMs,
    tooLarge: stat.size > MAX_NOTE_BYTES,
    badFrontMatter: Boolean(badFrontMatter),
    // Not sent in lists; read with readNote
    raw: text, // the whole file, front matter included (Copy and Export on the Notes page)
    body,
    frontMatter: data,
  };
  cache.set(rel, {mtimeMs: stat.mtimeMs, size: stat.size, note});
  return note;
}

const summary = ({body, frontMatter, raw, ...meta}) => meta;

// --- Reading -------------------------------------------------------------------------------------

// Every note's metadata (no bodies), newest change first
export function listNotes() {
  const paths = walk();
  for (const key of cache.keys()) if (!paths.includes(key)) cache.delete(key);
  return paths
    .map((rel) => {
      try {
        return summary(load(rel));
      } catch {
        return null; // removed while listing
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function allTags(notes = listNotes()) {
  const counts = new Map();
  for (const n of notes) {
    for (const t of n.tags) {
      const key = t.toLowerCase();
      const entry = counts.get(key) ?? {tag: t, count: 0};
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Finds a note by path, by "path" without .md, by title or file name, or by alias (as [[links]] do)
export function findNote(ref) {
  const want = String(ref ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!want) return null;
  const paths = walk();
  const lower = want.toLowerCase().replace(/\.md$/, '');
  const exact = paths.find((p) => p.toLowerCase().replace(/\.md$/, '') === lower);
  if (exact) return exact;
  const base = lower.split('/').pop();
  const byName = paths.find((p) => path.posix.basename(p, '.md').toLowerCase() === base);
  if (byName) return byName;
  return paths.find((p) => {
    const n = load(p);
    return n.title.toLowerCase() === base || n.aliases.some((a) => a.toLowerCase() === base);
  }) ?? null;
}

// One note with its text, plus the notes that link to it
export function readNote(ref) {
  const rel = findNote(ref);
  if (!rel) throw new NoteError(404, `No note "${ref}"`);
  resolve(rel, {ext: ['.md']});
  const note = load(rel);
  const names = new Set([path.posix.basename(rel, '.md').toLowerCase(), rel.toLowerCase().replace(/\.md$/, ''), ...note.aliases.map((a) => a.toLowerCase())]);
  const backlinks = listNotes()
    .filter((n) => n.path !== rel && n.links.some((l) => names.has(l.toLowerCase())))
    .map((n) => ({path: n.path, title: n.title}));
  return {...note, backlinks};
}

// Keyword search over titles, tags and text. Every word must match somewhere.
export function searchNotes(query, {limit = 20} = {}) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return walk()
    .map((rel) => load(rel))
    .map((n) => {
      const title = n.title.toLowerCase();
      const tags = n.tags.join(' ').toLowerCase();
      const body = n.body.toLowerCase();
      let score = 0;
      for (const w of words.map((w) => w.replace(/^#/, ''))) {
        const s = (title.includes(w) ? 5 : 0) + (tags.includes(w) ? 3 : 0) + Math.min(body.split(w).length - 1, 5);
        if (!s) return null;
        score += s;
      }
      const at = body.indexOf(words[0]);
      const snippet = at < 0 ? n.excerpt : n.body.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ').trim();
      return {...summary(n), score, snippet};
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.updated.localeCompare(a.updated))
    .slice(0, limit);
}

// An image or PDF in the vault, for ![[embeds]] and Markdown images
export function readAttachment(rel) {
  const {abs} = resolve(rel, {ext: Object.keys(ATTACHMENT_TYPES)});
  if (!fs.existsSync(abs)) throw new NoteError(404, `No file "${rel}"`);
  return {data: fs.readFileSync(abs), type: ATTACHMENT_TYPES[path.extname(abs).toLowerCase()]};
}

// An attachment by name, as Obsidian resolves ![[image.png]]: exact path, else any file with that name
export function findAttachment(name) {
  const want = String(name).replace(/^\/+/, '').toLowerCase();
  const found = [];
  (function scan(dir, prefix) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) scan(path.join(dir, e.name), rel);
      else if (ATTACHMENT_TYPES[path.extname(e.name).toLowerCase()]) found.push(rel);
    }
  })(VAULT, '');
  return found.find((p) => p.toLowerCase() === want) ?? found.find((p) => path.posix.basename(p).toLowerCase() === path.posix.basename(want)) ?? null;
}

// --- Export --------------------------------------------------------------------------------------

const MAX_EXPORT_FILES = 5000;
const MAX_EXPORT_BYTES = 200_000_000;

// Images and PDFs a note embeds: ![[name]] (found anywhere in the vault, as Obsidian does) and
// ![alt](relative/path) (relative to the note's folder first)
export function embeddedAttachments(note) {
  const found = new Set();
  const text = proseOnly(note.body);
  for (const m of text.matchAll(/!\[\[([^\]|#]+)/g)) {
    const rel = findAttachment(m[1].trim());
    if (rel) found.add(rel);
  }
  for (const m of text.matchAll(/!\[[^\]]*\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z]+:|^\/\//i.test(m[1])) continue;
    let name;
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const rel = findAttachment(note.folder ? path.posix.join(note.folder, name) : name) ?? findAttachment(name);
    if (rel) found.add(rel);
  }
  return [...found];
}

// The files for a zip of these notes, with their vault paths kept (so it unzips into a vault as is),
// plus the images and PDFs they embed
export function exportFiles(refs) {
  const paths = [...new Set(asNames(refs).map((r) => findNote(r)).filter(Boolean))];
  if (!paths.length) throw new NoteError(400, 'No notes to export');
  if (paths.length > MAX_EXPORT_FILES) throw new NoteError(413, `Too many notes (${MAX_EXPORT_FILES} at most)`);
  const files = new Map();
  for (const rel of paths) {
    const {abs} = resolve(rel, {ext: ['.md']});
    files.set(rel, abs);
    for (const att of embeddedAttachments(load(rel))) files.set(att, resolve(att).abs);
  }
  let bytes = 0;
  return [...files.entries()].map(([name, abs]) => {
    const stat = fs.statSync(abs);
    bytes += stat.size;
    if (bytes > MAX_EXPORT_BYTES) throw new NoteError(413, 'The export is too large (200 MB at most)');
    return {name, data: fs.readFileSync(abs), mtime: stat.mtime};
  });
}

// --- Deleting ------------------------------------------------------------------------------------

// Moves notes to the vault's .trash folder, as Obsidian's "Move to Obsidian trash" does, so they
// can be restored (Obsidian lists them under Trash). Dot folders are never listed, so they disappear
// from the site. A name already in the trash gets a number added. Images they embed are kept.
// Only the Notes page deletes; there is no MCP tool for it.
export function deleteNotes(refs) {
  // Exact vault paths only (no lookup by title), so a delete can't hit a different note of the same name
  const existing = new Set(walk());
  const paths = [...new Set(asNames(refs))].filter((r) => existing.has(r));
  if (!paths.length) throw new NoteError(404, 'No such notes');
  const trash = path.join(VAULT, '.trash');
  fs.mkdirSync(trash, {recursive: true});
  const origins = readOrigins();
  const deleted = [];
  for (const rel of paths) {
    const {abs} = resolve(rel, {ext: ['.md']});
    const base = path.basename(rel, '.md');
    let target = path.join(trash, `${base}.md`);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(trash, `${base} ${i}.md`);
    fs.renameSync(abs, target);
    cache.delete(rel);
    origins[path.basename(target)] = {path: rel, deleted: new Date().toISOString()};
    deleted.push(rel);
  }
  writeOrigins(origins);
  return {deleted, trash: '.trash'};
}

// --- Trash ---------------------------------------------------------------------------------------
// Obsidian's .trash is flat, so where each note came from is kept in .trash/.restore.json
// (written by the site; notes trashed in Obsidian restore to the top level).

const TRASH = () => path.join(VAULT, '.trash');
const ORIGINS = () => path.join(TRASH(), '.restore.json');

function readOrigins() {
  try {
    return JSON.parse(fs.readFileSync(ORIGINS(), 'utf8'));
  } catch {
    return {};
  }
}

function writeOrigins(origins) {
  fs.mkdirSync(TRASH(), {recursive: true});
  fs.writeFileSync(ORIGINS(), `${JSON.stringify(origins, null, 2)}\n`);
}

// A file name inside .trash (no folders, no dot files)
function trashFile(name) {
  const clean = String(name ?? '');
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.startsWith('.')) throw new NoteError(400, `Invalid name "${name}"`);
  const abs = path.join(TRASH(), clean);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new NoteError(404, `"${clean}" isn't in the trash`);
  return abs;
}

export function listTrash() {
  let entries;
  try {
    entries = fs.readdirSync(TRASH(), {withFileTypes: true});
  } catch {
    return [];
  }
  const origins = readOrigins();
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => {
      const stat = fs.statSync(path.join(TRASH(), e.name));
      const origin = origins[e.name];
      return {
        name: e.name,
        title: e.name.replace(/\.md$/i, ''),
        note: /\.md$/i.test(e.name),
        from: origin?.path ?? null,
        deleted: origin?.deleted ?? stat.ctime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => b.deleted.localeCompare(a.deleted));
}

// Puts a trashed file back where it was (or at the top level), with a number added if that name is taken
export function restoreFromTrash(name) {
  const abs = trashFile(name);
  const origins = readOrigins();
  const from = origins[name]?.path ?? path.basename(abs).replace(/ \d+(\.md)$/i, '$1');
  const dir = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
  const ext = path.extname(from);
  const base = path.posix.basename(from, ext);
  let rel = dir ? `${dir}/${base}${ext}` : `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(VAULT, rel)); i++) rel = dir ? `${dir}/${base} ${i}${ext}` : `${base} ${i}${ext}`;
  const {abs: target} = resolve(rel);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.renameSync(abs, target);
  delete origins[name];
  writeOrigins(origins);
  return {restored: rel};
}

// Deletes a trashed file for good
export function purgeFromTrash(name) {
  const abs = trashFile(name);
  fs.rmSync(abs);
  const origins = readOrigins();
  delete origins[name];
  writeOrigins(origins);
  return {purged: name};
}

// --- Attachments (pasted or dropped images) ------------------------------------------------------

const ATTACHMENT_DIR = process.env.NOTES_ATTACHMENTS || 'attachments';
const IMAGE_EXT = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp'};
const MAX_IMAGE_BYTES = 20_000_000;

// Saves an image as attachments/Pasted image <timestamp>.png (Obsidian's naming), or under its own
// name when it was dropped as a file. Returns the name to embed: ![[name]].
export function saveAttachment(data, type, name) {
  const ext = IMAGE_EXT[String(type).toLowerCase().split(';')[0]];
  if (!ext) throw new NoteError(415, 'Only PNG, JPEG, GIF and WebP images can be added');
  if (!data.length) throw new NoteError(400, 'The image is empty');
  if (data.length > MAX_IMAGE_BYTES) throw new NoteError(413, 'The image is too large (20 MB at most)');
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const base = safeName(String(name ?? '').replace(/\.[a-z0-9]+$/i, '')) || `Pasted image ${stamp}`;
  const dir = cleanFolder(ATTACHMENT_DIR);
  let file = `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(VAULT, dir, file)); i++) file = `${base} ${i}${ext}`;
  const {abs} = resolve(dir ? `${dir}/${file}` : file);
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, data, {flag: 'wx'});
  return {name: file, path: dir ? `${dir}/${file}` : file};
}

// --- Templates -----------------------------------------------------------------------------------
// Notes in the Templates folder (Obsidian's usual template folder). {{title}}, {{date}}, {{time}}
// and {{date:YYYY-MM-DD}} are filled in by the editor when a template is used.

export const TEMPLATE_DIR = process.env.NOTES_TEMPLATES || 'Templates';

function isTemplatePath(rel) {
  return rel.startsWith(`${TEMPLATE_DIR}/`);
}

export function listTemplates() {
  return listNotes()
    .filter((n) => n.folder === TEMPLATE_DIR || n.folder.startsWith(`${TEMPLATE_DIR}/`))
    .sort((a, b) => a.title.localeCompare(b.title));
}

const STARTER_TEMPLATES = {
  'Meeting notes': `---
tags: [meeting]
---
# {{title}}

**Date:** {{date}}
**Attendees:**

## Agenda

-

## Notes

## Decisions

-

## Action items

- [ ]
`,
  'How-to': `---
tags: [howto]
---
# {{title}}

What this does and when you need it.

## Before you start

-

## Steps

1.

## Check it worked

## Related

-
`,
  'Decision record': `---
tags: [decision]
---
# {{title}}

**Date:** {{date}}
**Status:** proposed

## Context

What is the issue, and why does it need a decision?

## Options

1.

## Decision

## Consequences

What becomes easier or harder because of this decision?
`,
};

// Adds the starter templates that aren't there yet
export function createStarterTemplates() {
  const dir = cleanFolder(TEMPLATE_DIR);
  fs.mkdirSync(path.join(VAULT, dir), {recursive: true});
  const created = [];
  for (const [name, text] of Object.entries(STARTER_TEMPLATES)) {
    const abs = path.join(VAULT, dir, `${name}.md`);
    if (fs.existsSync(abs)) continue;
    fs.writeFileSync(abs, text);
    created.push(`${dir}/${name}.md`);
  }
  return {created};
}

// Saves a template in the Templates folder: from a note (`fromNote`; its text, tags and other
// properties, with the note's title in its first heading turned into {{title}}) or from `body` and
// `tags`. `replace`: overwrite the template with that name (otherwise " 2" is added).
// writer: {author, model} when an AI saves it (recorded like a note's author and model)
export function saveTemplate({name, body, tags, fromNote, replace = false, writer} = {}) {
  let data = {};
  let text = body ?? '';
  if (fromNote) {
    const source = readNote(fromNote);
    data = withoutOwn(source.frontMatter);
    for (const k of ['author', 'model', 'edited_by', 'edited_model']) delete data[k];
    text = body ?? source.body.replace(titleHeading(source.title), '$1{{title}}');
    name = String(name ?? '').trim() || source.title;
  }
  checkSize(text);
  if (tags !== undefined) data.tags = uniqueTags(asList(tags));
  if (!String(name ?? '').trim()) throw new NoteError(400, 'A template needs a name');
  const clean = safeName(name);
  if (!clean) throw new NoteError(400, 'The name has no usable characters');
  const dir = cleanFolder(TEMPLATE_DIR);
  const existing = `${dir}/${clean}.md`;
  const replacing = replace && fs.existsSync(path.join(VAULT, existing));
  const target = replacing ? {rel: existing, abs: resolve(existing, {ext: ['.md']}).abs} : newNoteFile(clean, dir);
  // Replacing keeps the template's own properties (its tags too, unless new ones are given)
  if (replacing && !fromNote) data = {...load(existing).frontMatter, ...data};
  if (writer) {
    for (const k of ['author', 'model', 'edited_by', 'edited_model']) delete data[k];
    data.author = writer.author;
    if (writer.model) data.model = writer.model;
  }
  fs.mkdirSync(path.dirname(target.abs), {recursive: true});
  fs.writeFileSync(target.abs, serialize(data, text.replace(/^\n+/, '')));
  return readNote(target.rel);
}

// --- Links to the docs ---------------------------------------------------------------------------

// The site path a link points at ("/guides/notes"), or null for other sites, notes and anchors.
// Absolute links count when they point at this site (DOCS_SITE_URL, or any localhost).
function docPath(href) {
  let url;
  try {
    url = new URL(href, 'http://docs.invalid');
  } catch {
    return null;
  }
  const site = new URL(process.env.DOCS_SITE_URL || 'http://localhost:3000');
  const local = url.host === 'docs.invalid' || url.host === site.host || ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!local || !/^https?:$/.test(url.protocol) || url.pathname.startsWith('/notes')) return null;
  return url.pathname.replace(/\/+$/, '') || '/';
}

// Notes that link to a docs page, for the "Notes about this page" box on that page
export function notesLinkingTo(pagePath) {
  const want = String(pagePath ?? '').replace(/\/+$/, '') || '/';
  return walk()
    .map((rel) => load(rel))
    .filter((n) => [...proseOnly(n.body).matchAll(/\[[^\]]*\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g)].some((m) => docPath(m[1]) === want))
    .map((n) => ({path: n.path, title: n.title, updated: new Date(n.mtimeMs).toISOString(), excerpt: n.excerpt}));
}

// --- Renaming a note -----------------------------------------------------------------------------

// Rewrites [[links]] in text outside code: `rewrite(target)` returns the new target, or null to keep it
function rewriteLinks(text, rewrite) {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(`[^`\n]*`)/)
            .map((piece, j) =>
              j % 2
                ? piece
                : piece.replace(/(!?\[\[)([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?\]\])/g, (all, open, target, rest) => {
                    const next = rewrite(target.trim());
                    return next == null ? all : `${open}${next}${rest}`;
                  }),
            )
            .join(''),
    )
    .join('');
}

// Renames a note's file (same folder) and updates the [[links]] that point to it in every note.
// A link written as a path ([[Folder/Old]]) gets the new path; a plain one ([[Old]]) the new name.
export function renameNote(notePath, title) {
  const existing = walk();
  if (!existing.includes(notePath)) throw new NoteError(404, `No note "${notePath}"`);
  const name = safeName(title);
  if (!name) throw new NoteError(400, 'The title has no usable characters');
  const dir = path.posix.dirname(notePath) === '.' ? '' : path.posix.dirname(notePath);
  const oldName = path.posix.basename(notePath, '.md');
  const target = dir ? `${dir}/${name}.md` : `${name}.md`;
  const sameFile = target.toLowerCase() === notePath.toLowerCase();
  if (target === notePath) return {note: readNote(notePath), linksUpdated: 0, notesUpdated: 0};
  const {abs} = resolve(notePath, {ext: ['.md']});
  const {abs: targetAbs} = resolve(target, {ext: ['.md']});
  if (fs.existsSync(targetAbs) && !sameFile) throw new NoteError(409, `There's already a note called "${name}" in ${dir || 'the top level'}`);

  // A plain [[Old]] only points here if no other note has that file name
  const plainIsOurs = !existing.some((p) => p !== notePath && path.posix.basename(p, '.md').toLowerCase() === oldName.toLowerCase());
  const oldPath = notePath.replace(/\.md$/i, '').toLowerCase();
  const newPath = target.replace(/\.md$/i, '');
  const rewrite = (linkTarget) => {
    const t = linkTarget.replace(/\.md$/i, '');
    if (t.toLowerCase() === oldPath) return newPath;
    if (plainIsOurs && t.toLowerCase() === oldName.toLowerCase()) return name;
    return null;
  };

  // The note itself: keep a title property only if the file name can't hold the title as typed
  const current = load(notePath);
  const data = {...current.frontMatter};
  if (name !== title.trim()) data.title = title.trim();
  else delete data.title;
  data.updated = new Date().toISOString();
  fs.writeFileSync(abs, serialize(data, current.body));
  fs.renameSync(abs, targetAbs);
  cache.delete(notePath);

  let linksUpdated = 0;
  let notesUpdated = 0;
  for (const rel of walk()) {
    const note = load(rel);
    let count = 0;
    const body = rewriteLinks(note.body, (t) => {
      const next = rewrite(t);
      if (next != null) count++;
      return next;
    });
    if (!count) continue;
    const {abs: noteAbs} = resolve(rel, {ext: ['.md']});
    // Only the links change, so the text after the front matter is swapped as is
    const raw = fs.readFileSync(noteAbs, 'utf8');
    fs.writeFileSync(noteAbs, raw.slice(0, raw.length - note.body.length) + body);
    linksUpdated += count;
    notesUpdated++;
  }
  return {note: readNote(target), linksUpdated, notesUpdated};
}

// --- Writing -------------------------------------------------------------------------------------

function serialize(data, body) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
  const yaml = Object.keys(clean).length ? `---\n${YAML.stringify(clean, {lineWidth: 0}).trimEnd()}\n---\n` : '';
  const text = body.replace(/\r\n/g, '\n');
  return `${yaml}${text.endsWith('\n') || !text ? text : `${text}\n`}`;
}

function checkSize(body) {
  if (typeof body !== 'string') throw new NoteError(400, 'The note text must be a string');
  if (Buffer.byteLength(body) > MAX_NOTE_BYTES) throw new NoteError(413, 'The note is too large (1 MB at most)');
}

// New note at <folder>/<title>.md (" 2", " 3", … added if the name is taken). Returns the note.
export function createNote({title, body = '', tags = [], folder = '', author, model, icon} = {}) {
  if (icon != null && !validIcon(icon)) throw new NoteError(400, 'Pick an icon from the list, or one emoji');
  checkSize(body);
  const {rel, abs} = newNoteFile(title, folder);
  const now = new Date().toISOString();
  // The title is the file name, as in Obsidian; keep it as a property only when it had to be changed
  const data = {
    ...(title && safeName(title) !== title.trim() ? {title: title.trim()} : {}),
    tags: uniqueTags(asList(tags)),
    created: now,
    updated: now,
    ...(author ? {author: String(author).slice(0, 80)} : {}),
    ...(model ? {model: String(model).slice(0, 80)} : {}),
    ...(icon ? {icon} : {}),
  };
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, serialize(data, body), {flag: 'wx'});
  return readNote(rel);
}

// A free path for a new note: <folder>/<title>.md, with " 2", " 3", … added if the name is taken
function newNoteFile(title, folder) {
  const name = safeName(title || `Note ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}`);
  if (!name) throw new NoteError(400, 'The title has no usable characters');
  const dir = cleanFolder(folder);
  notInAttachments(dir);
  let rel = dir ? `${dir}/${name}.md` : `${name}.md`;
  for (let i = 2; fs.existsSync(path.join(VAULT, rel)); i++) rel = dir ? `${dir}/${name} ${i}.md` : `${name} ${i}.md`;
  return {rel, abs: resolve(rel, {ext: ['.md']}).abs};
}

// Properties that describe one note's history, not its content: left out of copies and templates
const OWN_PROPERTIES = ['title', 'created', 'updated', 'modified', 'date', 'pinned', 'aliases', 'alias'];
const withoutOwn = (data) => Object.fromEntries(Object.entries(data).filter(([k]) => !OWN_PROPERTIES.includes(k)));

// A copy of a note, next to it (or in `folder`), called "<title> copy" unless `title` is given.
// Same text, tags and other properties; new created/updated dates, not pinned.
export function duplicateNote(ref, {title, folder} = {}) {
  const source = readNote(ref);
  const wanted = String(title ?? '').trim() || `${source.title} copy`;
  const {rel, abs} = newNoteFile(wanted, folder ?? source.folder);
  // The file name, with any " 2" added; a title that had to be cleaned for the file name stays a property
  const fileTitle = path.posix.basename(rel, '.md');
  const newTitle = safeName(wanted) === wanted ? fileTitle : wanted;
  const now = new Date().toISOString();
  const data = {
    ...(newTitle !== fileTitle ? {title: newTitle} : {}),
    ...withoutOwn(source.frontMatter),
    created: now,
    updated: now,
  };
  // A first heading that repeats the title follows the new one
  const body = source.body.replace(titleHeading(source.title), (_, start) => `${start}${newTitle}`);
  fs.writeFileSync(abs, serialize(data, body), {flag: 'wx'});
  return readNote(rel);
}

// The note's first "# <title>" heading; group 1 is the "# " part
function titleHeading(title) {
  return new RegExp(`^(\\s*#\\s+)${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');
}

// --- Folders and moving --------------------------------------------------------------------------

// After a note or folder moves: [[links]] written as a path to it ([[Folder/Note]]) get the new path.
// Plain [[Note]] links don't name a folder, so they keep working. `from`/`to`: the old and new path
// of a note (without .md) or of a folder. `folder`: only links through it (`from/…`) change, never one
// that is exactly `from`, which names a note ("Projects.md" next to a "Projects/" folder).
// Returns how many links changed.
function rewritePathLinks(from, to, {folder = false} = {}) {
  const old = from.toLowerCase();
  let linksUpdated = 0;
  for (const rel of walk()) {
    const note = load(rel);
    let count = 0;
    const body = rewriteLinks(note.body, (t) => {
      const target = t.replace(/\.md$/i, '');
      const lower = target.toLowerCase();
      if ((folder || lower !== old) && !lower.startsWith(`${old}/`)) return null;
      count++;
      return to + target.slice(from.length);
    });
    if (!count) continue;
    const {abs} = resolve(rel, {ext: ['.md']});
    const raw = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(abs, raw.slice(0, raw.length - note.body.length) + body);
    cache.delete(rel);
    linksUpdated += count;
  }
  return linksUpdated;
}

// "a / b//c" → "a/b/c", each part cleaned like a note name; '' is the top level
const cleanFolder = (folder) =>
  String(folder ?? '')
    .split(/[\\/]+/)
    .map(safeName)
    .filter(Boolean)
    .join('/');

function existingFolder(rel) {
  const {abs, rel: clean} = resolve(rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new NoteError(404, `No folder "${rel}"`);
  return {abs, rel: clean};
}

export function createFolder(folder) {
  const rel = cleanFolder(folder);
  if (!rel) throw new NoteError(400, 'The folder name has no usable characters');
  notInAttachments(rel);
  const {abs} = resolve(rel);
  if (fs.existsSync(abs)) throw new NoteError(409, `There's already a folder "${rel}"`);
  fs.mkdirSync(abs, {recursive: true});
  return {folder: rel};
}

// Renames a folder in place (same parent). Notes inside keep their names, so [[links]] still work;
// links written as a path through the folder are updated.
export function renameFolder(folder, name) {
  const {abs, rel} = existingFolder(folder);
  const clean = safeName(name);
  if (!clean) throw new NoteError(400, 'The folder name has no usable characters');
  const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  const target = parent ? `${parent}/${clean}` : clean;
  notInAttachments(rel); // renaming it would break where pasted images go
  notInAttachments(target);
  if (target === rel) return {folder: rel};
  const {abs: targetAbs} = resolve(target);
  // A case-only rename ("api" → "API") is the same folder on macOS, so allow it
  if (fs.existsSync(targetAbs) && target.toLowerCase() !== rel.toLowerCase()) throw new NoteError(409, `There's already a folder "${target}"`);
  fs.renameSync(abs, targetAbs);
  for (const key of cache.keys()) if (key.startsWith(`${rel}/`)) cache.delete(key);
  return {folder: target, from: rel, linksUpdated: rewritePathLinks(rel, target, {folder: true})};
}

// Moves a folder, with everything in it, into another folder ('' = the top level), keeping its name.
// Note file names don't change, so [[links]] by name still work; ones written as a path are updated.
export function moveFolder(folder, into) {
  const {abs, rel} = existingFolder(folder);
  const dest = cleanFolder(into);
  notInAttachments(rel);
  notInAttachments(dest);
  if (dest === rel || dest.startsWith(`${rel}/`)) throw new NoteError(400, `Can't move "${rel}" into itself`);
  if (dest) existingFolder(dest);
  const name = path.posix.basename(rel);
  const target = dest ? `${dest}/${name}` : name;
  if (target === rel) return {folder: rel, from: rel};
  const {abs: targetAbs} = resolve(target);
  if (fs.existsSync(targetAbs)) throw new NoteError(409, `There's already a folder "${name}" in ${dest || 'the top level'}`);
  fs.renameSync(abs, targetAbs);
  for (const key of cache.keys()) if (key.startsWith(`${rel}/`)) cache.delete(key);
  return {folder: target, from: rel, linksUpdated: rewritePathLinks(rel, target, {folder: true})};
}

// Deletes selected folders after their contents (deepest first, so a parent is empty by its turn).
// Only empty ones go: a folder still holding something (not selected, or added meanwhile) is kept and
// reported, never deleted with what's in it.
export function deleteFolders(folders = []) {
  if (!Array.isArray(folders) || folders.length > 500) throw new NoteError(400, 'Name the folders to delete');
  const deepestFirst = [...new Set(folders.map(String))].sort((a, b) => b.split('/').length - a.split('/').length);
  const foldersDeleted = [];
  const foldersKept = [];
  for (const folder of deepestFirst) {
    try {
      foldersDeleted.push(deleteFolder(folder).deleted);
    } catch (err) {
      if (err.status !== 404) foldersKept.push({folder, reason: err.message});
    }
  }
  return {foldersDeleted, foldersKept};
}

// Only an empty folder (nothing but a .DS_Store); notes are deleted one by one, to the trash
export function deleteFolder(folder) {
  const {abs, rel} = existingFolder(folder);
  notInAttachments(rel);
  const left = fs.readdirSync(abs).filter((f) => f !== '.DS_Store');
  if (left.length) throw new NoteError(409, `"${rel}" isn't empty. Move or delete what's in it first.`);
  fs.rmSync(abs, {recursive: true});
  return {deleted: rel};
}

// Moves a note (exact path) into a folder ('' = the top level), creating the folder if needed.
// The file name stays, so [[links]] to it keep working.
export function moveNote(notePath, folder) {
  const existing = new Set(walk());
  if (!existing.has(notePath)) throw new NoteError(404, `No note "${notePath}"`);
  const {abs} = resolve(notePath, {ext: ['.md']});
  const dir = cleanFolder(folder);
  notInAttachments(dir);
  const target = dir ? `${dir}/${path.posix.basename(notePath)}` : path.posix.basename(notePath);
  if (target === notePath) return readNote(notePath);
  const {abs: targetAbs} = resolve(target, {ext: ['.md']});
  if (fs.existsSync(targetAbs)) throw new NoteError(409, `There's already a note called "${path.posix.basename(notePath, '.md')}" in ${dir || 'the top level'}`);
  fs.mkdirSync(path.dirname(targetAbs), {recursive: true});
  fs.renameSync(abs, targetAbs);
  cache.delete(notePath);
  rewritePathLinks(notePath.replace(/\.md$/i, ''), target.replace(/\.md$/i, ''));
  return readNote(target);
}

// Changes a note's text and/or tags. `baseMtime`: the mtimeMs the editor loaded; if the file has
// changed since (in Obsidian, or by an agent) the save is refused with 409 instead of overwriting.
// `append` adds text at the end instead of replacing it.
// editor: {author, model} when an AI changes the text (recorded as edited_by / edited_model);
// null when you save it on the Notes page (clears them); left out for anything else
export function updateNote(ref, {body, append, tags, addTags, removeTags, baseMtime, pinned, icon, editor} = {}) {
  const rel = findNote(ref);
  if (!rel) throw new NoteError(404, `No note "${ref}"`);
  const {abs} = resolve(rel, {ext: ['.md']});
  const current = load(rel);
  if (current.tooLarge) throw new NoteError(413, 'This note is too large to edit here');
  if (current.badFrontMatter) throw new NoteError(422, "This note's front matter isn't valid YAML; fix it in a text editor or Obsidian first");
  if (baseMtime != null && Math.abs(Number(baseMtime) - current.mtimeMs) > 1) {
    throw new NoteError(409, 'This note changed since you opened it (in Obsidian or by an agent). Reload it to see the changes.', {
      note: summary(current),
    });
  }
  let text = current.body;
  if (typeof body === 'string') text = body;
  if (typeof append === 'string' && append) text = `${text.replace(/\s*$/, '')}\n\n${append.trim()}\n`;
  checkSize(text);

  const data = {...current.frontMatter};
  // Front matter tags only: inline #tags stay in the text, where the author put them
  let fmTags = uniqueTags(asList(data.tags ?? data.tag));
  if (tags !== undefined) fmTags = uniqueTags(asList(tags));
  if (addTags) fmTags = uniqueTags([...fmTags, ...asList(addTags)]);
  if (removeTags) {
    const drop = new Set(asList(removeTags).map((t) => normTag(t).toLowerCase()));
    fmTags = fmTags.filter((t) => !drop.has(t.toLowerCase()));
  }
  delete data.tag;
  data.tags = fmTags;
  if (pinned === true) data.pinned = true;
  if (pinned === false) delete data.pinned;
  // icon: a line icon or emoji for the Notes page (null removes it)
  if (icon === null) delete data.icon;
  else if (icon !== undefined) {
    if (!validIcon(icon)) throw new NoteError(400, 'Pick an icon from the list, or one emoji');
    data.icon = icon;
  }
  if (editor === null || (editor && text !== current.body)) {
    delete data.edited_by;
    delete data.edited_model;
    // The AI that wrote the note doesn't need repeating as its editor
    if (editor && !(editor.author === data.author && (editor.model ?? null) === (data.model ?? null))) {
      data.edited_by = editor.author;
      if (editor.model) data.edited_model = editor.model;
    }
  }
  data.created ??= current.created; // pin the date it was first seen, so it doesn't drift
  data.updated = new Date().toISOString();
  fs.writeFileSync(abs, serialize(data, text));
  return readNote(rel);
}

// --- Tasks ---------------------------------------------------------------------------------------

// "- [ ] task", "1. [x] task", also in quotes; group 2 is the box
const TASK = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)(.*)$/;

// Each task line outside code blocks: {line (from 1, in the note's text), done, text, section}
function tasksIn(body) {
  const out = [];
  let fence = null;
  let section = null;
  body.split('\n').forEach((line, i) => {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (fence === f[1] ? null : fence) : f[1];
    if (fence || f) return;
    const h = line.match(/^#{1,6}\s+(.+)/);
    if (h) section = h[1].trim();
    const m = line.match(TASK);
    if (m) out.push({line: i + 1, done: m[2] !== ' ', text: m[4].trim(), section});
  });
  return out;
}

// Tasks across notes. status: 'open' (default) | 'done' | 'all'
export function listTasks({status = 'open', tag, folder, since} = {}) {
  const want = tag?.replace(/^#/, '').toLowerCase();
  const dir = folder?.replace(/\/+$/, '');
  return walk()
    .map((rel) => load(rel))
    .filter(
      (n) =>
        (!want || n.tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`))) &&
        (dir == null || n.folder === dir || n.folder.startsWith(`${dir}/`)) &&
        (!since || n.updated.slice(0, 10) >= since),
    )
    .flatMap((n) =>
      tasksIn(n.body)
        .filter((t) => status === 'all' || (status === 'done' ? t.done : !t.done))
        .map((t) => ({...t, path: n.path, title: n.title, updated: n.updated})),
    )
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.line - b.line);
}

// Ticks (or unticks) one task. `text` must match the task on that line, so a note edited since
// list_tasks can't get the wrong box ticked.
export function setTask(notePath, line, text, done = true) {
  const rel = findNote(notePath);
  if (!rel) throw new NoteError(404, `No note "${notePath}"`);
  const note = load(rel);
  const task = tasksIn(note.body).find((t) => t.line === Number(line));
  const norm = (x) => String(x ?? '').trim().toLowerCase();
  if (!task || (text != null && norm(task.text) !== norm(text))) {
    const near = tasksIn(note.body).find((t) => norm(t.text) === norm(text));
    throw new NoteError(409, near ? `That task is now on line ${near.line}; call again with line ${near.line}.` : 'No such task on that line (the note may have changed). Call list_tasks again.');
  }
  if (task.done === done) return {note: readNote(rel), task: {...task, done}, changed: false};
  const lines = note.body.split('\n');
  lines[task.line - 1] = lines[task.line - 1].replace(TASK, (_, a, _box, c, rest) => `${a}${done ? 'x' : ' '}${c}${rest}`);
  const updated = updateNote(rel, {body: lines.join('\n'), baseMtime: note.mtimeMs});
  return {note: updated, task: {...task, done}, changed: true};
}

// --- Sections and connections --------------------------------------------------------------------

export function noteHeadings(body) {
  let fence = null;
  const out = [];
  for (const line of body.split('\n')) {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (fence === f[1] ? null : fence) : f[1];
    if (fence || f) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) out.push({level: h[1].length, text: h[2]});
  }
  return out;
}

// The part of a note under a heading (case-insensitive, partial match), with its sub-sections
export function noteSection(body, heading) {
  const want = String(heading).toLowerCase().replace(/^#+\s*/, '').trim();
  const lines = body.split('\n');
  let fence = null;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (fence === f[1] ? null : fence) : f[1];
    if (fence || f) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!h) continue;
    if (start < 0 && h[2].toLowerCase().includes(want)) {
      start = i;
      level = h[1].length;
    } else if (start >= 0 && h[1].length <= level) {
      return lines.slice(start, i).join('\n').trim();
    }
  }
  return start < 0 ? null : lines.slice(start).join('\n').trim();
}

// Notes connected to one: what it links to (and links that go nowhere yet), what links to it,
// and notes sharing its tags (most shared first)
export function relatedNotes(ref) {
  const n = readNote(ref);
  const outgoing = [];
  const missing = [];
  for (const link of n.links) {
    const target = findNote(link);
    if (target) outgoing.push({path: target, title: load(target).title});
    else if (!findAttachment(link)) missing.push(link); // ![[image.png]] embeds aren't note links
  }
  const mine = new Set(n.tags.map((t) => t.toLowerCase()));
  const sharing = mine.size
    ? listNotes()
        .filter((o) => o.path !== n.path)
        .map((o) => ({path: o.path, title: o.title, shared: o.tags.filter((t) => mine.has(t.toLowerCase()))}))
        .filter((o) => o.shared.length)
        .sort((a, b) => b.shared.length - a.shared.length)
        .slice(0, 15)
    : [];
  return {note: {path: n.path, title: n.title, tags: n.tags}, outgoing, missing, backlinks: n.backlinks, sharing};
}

// --- Attachments ---------------------------------------------------------------------------------

// Every image and PDF in the vault, with the notes that embed it
export function listAttachments() {
  const files = [];
  (function scan(dir, prefix) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) scan(path.join(dir, e.name), rel);
      else if (ATTACHMENT_TYPES[path.extname(e.name).toLowerCase()]) {
        const stat = fs.statSync(path.join(dir, e.name));
        files.push({path: rel, size: stat.size, modified: stat.mtime.toISOString(), usedBy: []});
      }
    }
  })(VAULT, '');
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const rel of walk()) {
    const note = load(rel);
    for (const att of embeddedAttachments(note)) byPath.get(att)?.usedBy.push({path: note.path, title: note.title});
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// An image for an agent to look at: {data (base64), mimeType, size}. Raster images only (PNG, JPEG,
// GIF, WebP), and at most `maxBytes`, since large images cost a lot of tokens.
export const IMAGE_MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'};
export function imageForAgent(rel, maxBytes = 3_000_000) {
  const mimeType = IMAGE_MIME[path.extname(rel).toLowerCase()];
  if (!mimeType) throw new NoteError(415, `${rel} isn't a PNG, JPEG, GIF or WebP image`);
  const {data} = readAttachment(rel);
  if (data.length > maxBytes) throw new NoteError(413, `${rel} is ${(data.length / 1e6).toFixed(1)} MB, over the ${(maxBytes / 1e6).toFixed(1)} MB limit for agents`);
  return {data: data.toString('base64'), mimeType, size: data.length};
}

// --- Health --------------------------------------------------------------------------------------

// What needs tidying: [[links]] to notes that don't exist, attachments nothing embeds, notes
// without tags, tags spelled differently (API / api), empty notes, and what's in the trash
export function notesHealth() {
  const notes = walk().map((rel) => load(rel));
  const broken = [];
  for (const n of notes) {
    const gone = n.links.filter((l) => !findNote(l) && !findAttachment(l));
    if (gone.length) broken.push({path: n.path, title: n.title, links: gone});
  }
  const spellings = new Map();
  for (const n of notes) for (const t of n.tags) spellings.set(t.toLowerCase(), new Set([...(spellings.get(t.toLowerCase()) ?? []), t]));
  return {
    notes: notes.length,
    brokenLinks: broken,
    unusedAttachments: listAttachments().filter((a) => !a.usedBy.length).map(({path: p, size}) => ({path: p, size})),
    untagged: notes.filter((n) => !n.tags.length && !n.folder.startsWith(TEMPLATE_DIR)).map((n) => ({path: n.path, title: n.title})),
    tagVariants: [...spellings.values()].filter((v) => v.size > 1).map((v) => [...v]),
    empty: notes.filter((n) => !n.body.trim()).map((n) => ({path: n.path, title: n.title})),
    trash: listTrash().length,
  };
}

// --- Templates, filled in (for agents; the editor does the same in the browser) ------------------

export function fillTemplate(text, title, now = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  const format = (f) =>
    f.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => ({YYYY: now.getFullYear(), MM: pad(now.getMonth() + 1), DD: pad(now.getDate()), HH: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds())})[t]);
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/g, (_, key, fmt) =>
    key === 'title' ? title || 'Untitled' : format(fmt?.trim() || (key === 'date' ? 'YYYY-MM-DD' : 'HH:mm')),
  );
}

// A template by name or path: {body (filled in), tags}
export function templateFor(name, title) {
  const templates = listTemplates();
  const want = String(name).toLowerCase().replace(/\.md$/, '');
  const t = templates.find((x) => x.path.toLowerCase().replace(/\.md$/, '') === want || x.title.toLowerCase() === want);
  if (!t) throw new NoteError(404, `No template "${name}". Templates: ${templates.map((x) => x.title).join(', ') || 'none yet (they live in the Templates folder)'}`);
  const full = load(t.path);
  return {body: fillTemplate(full.body.replace(/^\n+/, ''), title), tags: full.propertyTags};
}
