// Notebooks: a folder of Jupyter notebooks (.ipynb) for debugging and troubleshooting the Bluecore
// stack. Shared by the site's Notebooks page (notebooks-api.mjs) and the MCP notebook tools
// (notebooks-tools.mjs). Running cells goes through the JupyterLab container (jupyter.mjs); this file
// only reads and writes the files, so listing, reading and editing work even when Jupyter is down.
//
// NOTEBOOKS_DIR: the folder (default ./notebooks in this repo; /notebooks inside Docker, where
// docker-compose.yml mounts it into both the MCP server and JupyterLab). Starter notebooks are in
// mcp/starter-notebooks and are copied into the folder on request.
//
// The site records who wrote a notebook in its metadata, like notes do: metadata.bluecore =
// {title, author, model, created, updated, edited_by, edited_model, target, last_run}. target: the
// environment the notebook runs against ("local", or a deployed one from local-stack.mjs), which the
// kernel's helper (docker/jupyter/bluecore.py) reads from the file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkTarget} from './local-stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const NOTEBOOKS = path.resolve(REPO, process.env.NOTEBOOKS_DIR || 'notebooks');
export const STARTERS = path.join(HERE, 'starter-notebooks');
// Notebooks are off unless JUPYTER_NOTEBOOK=true in .env: then the JupyterLab container, the Notebooks
// page, this API and the notebook tools exist
export const NOTEBOOKS_ENABLED = /^(true|1|yes|on)$/i.test(String(process.env.JUPYTER_NOTEBOOK ?? '').trim());
const TRASH = '.trash';
const MAX_BYTES = 20_000_000; // outputs with images make notebooks large
const MAX_CELL_SOURCE = 200_000;

export class NotebookError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function ensureNotebooks() {
  fs.mkdirSync(NOTEBOOKS, {recursive: true});
}

// --- Paths ---------------------------------------------------------------------------------------

// A folder-relative path from a client → absolute path inside the folder, or an error. Dot folders
// (.trash, .ipynb_checkpoints, .git) are never read or written.
function resolve(rel) {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) throw new NotebookError(400, `Invalid path "${rel}"`);
  if (!clean.toLowerCase().endsWith('.ipynb')) throw new NotebookError(400, `Not a notebook (.ipynb): "${rel}"`);
  const abs = path.resolve(NOTEBOOKS, clean);
  if (!abs.startsWith(NOTEBOOKS + path.sep)) throw new NotebookError(400, `Invalid path "${rel}"`);
  if (fs.existsSync(abs) && !fs.realpathSync(abs).startsWith(fs.realpathSync(NOTEBOOKS) + path.sep)) throw new NotebookError(400, `Invalid path "${rel}"`);
  return {abs, rel: clean};
}

function walk(dir = NOTEBOOKS, prefix = '') {
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
    return e.isFile() && e.name.toLowerCase().endsWith('.ipynb') ? [rel] : [];
  });
}

// A file name from a title: no slashes or characters that trouble file systems
const fileTitle = (title) =>
  String(title ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

const cleanFolder = (folder) => {
  const f = String(folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (f && f.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) throw new NotebookError(400, `Invalid folder "${folder}"`);
  return f;
};

// A free path for a new notebook: "Title.ipynb", else "Title 2.ipynb", …
function freePath(folder, title) {
  const base = fileTitle(title) || 'Untitled';
  for (let n = 1; ; n++) {
    const rel = `${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.ipynb`;
    if (!fs.existsSync(path.join(NOTEBOOKS, rel))) return rel;
  }
}

// --- Reading -------------------------------------------------------------------------------------

const joinSource = (s) => (Array.isArray(s) ? s.join('') : String(s ?? ''));
// Jupyter stores multi-line strings as a list of lines (each keeping its "\n")
const splitSource = (s) => {
  const lines = String(s ?? '').split(/(?<=\n)/);
  return lines.length === 1 && lines[0] === '' ? [] : lines;
};
const newId = () => crypto.randomBytes(4).toString('hex');

function load(abs) {
  const stat = fs.statSync(abs);
  if (stat.size > MAX_BYTES) throw new NotebookError(413, 'Notebook too large (20 MB at most)');
  let nb;
  try {
    nb = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    throw new NotebookError(422, 'Not a valid notebook (the file isn\'t JSON)');
  }
  if (!Array.isArray(nb.cells)) throw new NotebookError(422, 'Not a valid notebook (no cells)');
  return {nb, mtime: stat.mtimeMs};
}

const titleOf = (nb, rel) => {
  const meta = nb.metadata?.bluecore?.title;
  if (meta) return meta;
  const first = nb.cells.find((c) => c.cell_type === 'markdown');
  const heading = first && joinSource(first.source).match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(rel, '.ipynb');
};

// An output's text, for agents and summaries: streams, text/plain results, errors (ANSI colors removed)
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
export function outputText(o) {
  if (o.output_type === 'stream') return joinSource(o.text);
  if (o.output_type === 'error') return `${o.ename}: ${o.evalue}\n${(o.traceback ?? []).join('\n')}`.replace(ANSI, '');
  const data = o.data ?? {};
  if (data['text/plain']) return joinSource(data['text/plain']);
  if (data['text/markdown']) return joinSource(data['text/markdown']);
  const kinds = Object.keys(data);
  return kinds.length ? `[${kinds.join(', ')}]` : '';
}

const cellView = (c, index) => ({
  index,
  id: c.id ?? null,
  type: c.cell_type,
  source: joinSource(c.source),
  executionCount: c.execution_count ?? null,
  outputs: c.outputs ?? [],
});

function summary(rel, nb, mtime) {
  const code = nb.cells.filter((c) => c.cell_type === 'code');
  const meta = nb.metadata?.bluecore ?? {};
  return {
    path: rel,
    title: titleOf(nb, rel),
    folder: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
    cells: nb.cells.length,
    codeCells: code.length,
    ran: code.filter((c) => c.execution_count != null).length,
    errors: code.filter((c) => (c.outputs ?? []).some((o) => o.output_type === 'error')).length,
    updated: new Date(mtime).toISOString(),
    lastRun: meta.last_run ?? null,
    target: meta.target || 'local',
    author: meta.author ?? null,
    model: meta.model ?? null,
    editedBy: meta.edited_by ?? null,
    editedModel: meta.edited_model ?? null,
    created: meta.created ?? new Date(mtime).toISOString(),
    tags: cleanTags(meta.tags),
    pinned: meta.pinned === true,
    // The first line of text, for the list: the intro Markdown under the title, else the first code line
    excerpt: excerptOf(nb),
  };
}

const cleanTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))].slice(0, 30);

function excerptOf(nb) {
  for (const c of nb.cells) {
    const lines = joinSource(c.source).split('\n').map((l) => l.trim()).filter((l) => l && !(c.cell_type === 'markdown' && l.startsWith('#')));
    if (lines.length) return lines[0].replace(/[*_`]/g, '').slice(0, 160);
  }
  return '';
}

export function listNotebooks() {
  return walk()
    .flatMap((rel) => {
      try {
        const {nb, mtime} = load(path.join(NOTEBOOKS, rel));
        return [summary(rel, nb, mtime)];
      } catch {
        return []; // skip files that aren't notebooks
      }
    })
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

// A path, or a title (case-insensitive)
export function findNotebook(ref) {
  const r = String(ref ?? '').trim();
  if (!r) throw new NotebookError(400, 'Name a notebook (its path or title)');
  const asPath = r.toLowerCase().endsWith('.ipynb') ? r : `${r}.ipynb`;
  try {
    const {abs, rel} = resolve(asPath);
    if (fs.existsSync(abs)) return rel;
  } catch {
    // not a path; try it as a title
  }
  const want = r.replace(/\.ipynb$/i, '').toLowerCase();
  const hit = listNotebooks().find((n) => n.title.toLowerCase() === want || path.basename(n.path, '.ipynb').toLowerCase() === want);
  if (!hit) throw new NotebookError(404, `No notebook "${ref}". list_notebooks shows them.`);
  return hit.path;
}

export function readNotebook(ref) {
  const rel = findNotebook(ref);
  const {abs} = resolve(rel);
  const {nb, mtime} = load(abs);
  return {...summary(rel, nb, mtime), mtime, cellsList: nb.cells.map(cellView), kernel: nb.metadata?.kernelspec?.name ?? 'python3'};
}

// --- Writing -------------------------------------------------------------------------------------

function save(abs, nb) {
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(nb, null, 1)}\n`);
  fs.renameSync(tmp, abs);
}

function makeCell(type, source) {
  if (!['code', 'markdown', 'raw'].includes(type)) throw new NotebookError(400, `Unknown cell type "${type}" (code, markdown or raw)`);
  if (String(source ?? '').length > MAX_CELL_SOURCE) throw new NotebookError(413, 'Cell too large');
  const cell = {cell_type: type, id: newId(), metadata: {}, source: splitSource(source)};
  if (type === 'code') Object.assign(cell, {execution_count: null, outputs: []});
  return cell;
}

const blank = () => ({
  cells: [],
  metadata: {
    kernelspec: {display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3'},
    language_info: {name: 'python'},
  },
  nbformat: 4,
  nbformat_minor: 5,
});

// Who changed it: an AI's edit is recorded until the person saves it themselves
function stamp(nb, {writer, created} = {}) {
  const now = new Date().toISOString();
  const meta = (nb.metadata.bluecore ??= {});
  if (created) {
    meta.created = now;
    if (writer?.author) meta.author = writer.author;
    if (writer?.model) meta.model = writer.model;
  } else if (writer?.author) {
    meta.edited_by = writer.author;
    if (writer.model) meta.edited_model = writer.model;
    else delete meta.edited_model;
  }
  meta.updated = now;
}

export function listStarters() {
  let files = [];
  try {
    files = fs.readdirSync(STARTERS).filter((f) => f.endsWith('.ipynb')).sort();
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    try {
      const nb = JSON.parse(fs.readFileSync(path.join(STARTERS, f), 'utf8'));
      const intro = nb.cells.find((c) => c.cell_type === 'markdown');
      const lines = intro ? joinSource(intro.source).split('\n') : [];
      const description = lines.find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
      return [{name: path.basename(f, '.ipynb'), title: titleOf(nb, f), group: nb.metadata?.bluecore?.group ?? '', description}];
    } catch {
      return [];
    }
  });
}

// A starter by its file name or title
function starterNotebook(name) {
  const want = String(name).replace(/\.ipynb$/i, '').toLowerCase();
  const starters = listStarters();
  const hit = starters.find((s) => s.name.toLowerCase() === want || s.title.toLowerCase() === want);
  if (!hit) throw new NotebookError(404, `No starter notebook "${name}". Starters: ${starters.map((s) => s.name).join(', ')}`);
  return JSON.parse(fs.readFileSync(path.join(STARTERS, `${hit.name}.ipynb`), 'utf8'));
}

// cells: [{type, source}]. starter: start from a starter notebook (its cells come first).
export function createNotebook({title, cells = [], folder = '', starter, target, writer} = {}) {
  ensureNotebooks();
  const nb = starter ? starterNotebook(starter) : blank();
  for (const c of nb.cells) c.id ??= newId();
  nb.cells.push(...cells.map((c) => makeCell(c.type ?? 'code', c.source)));
  const name = title || (starter ? titleOf(nb, `${starter}.ipynb`) : 'Untitled');
  nb.metadata.bluecore = {title: name, ...(target && target !== 'local' && {target: checkTarget(target)})};
  stamp(nb, {writer, created: true});
  const rel = freePath(cleanFolder(folder), name);
  save(resolve(rel).abs, nb);
  return readNotebook(rel);
}

// Copies every starter notebook into the folder (skipping ones already there)
export function createStarterNotebooks() {
  ensureNotebooks();
  const added = [];
  for (const s of listStarters()) {
    const rel = `Starters/${fileTitle(s.title)}.ipynb`;
    if (fs.existsSync(path.join(NOTEBOOKS, rel))) continue;
    const nb = starterNotebook(s.name);
    nb.metadata.bluecore = {title: s.title};
    stamp(nb, {created: true, writer: {author: 'starter'}});
    save(resolve(rel).abs, nb);
    added.push(rel);
  }
  return added;
}

// ops, applied in order:
//   {op: 'append', type, source}            add a cell at the end
//   {op: 'insert', index, type, source}     add a cell before index
//   {op: 'replace', index, source, type?}   change a cell's text (clears its outputs)
//   {op: 'delete', index}                   remove a cell
//   {op: 'clear_outputs'}                   clear every cell's outputs
// Indexes refer to the notebook as it is when that op runs. baseMtime: refuse if the file changed since.
// target: the environment it runs against ("local" removes the setting).
// cells: the editor on the Notebooks page saves the whole list instead: [{from, type, source}] in the new
// order, where from is the cell's index in the saved notebook (null for a new cell). Cells left out are
// deleted; an edited cell keeps its outputs until it runs again, as in Jupyter.
export function updateNotebook(ref, {ops = [], cells, baseMtime, writer, title, target} = {}) {
  const rel = findNotebook(ref);
  const {abs} = resolve(rel);
  const {nb, mtime} = load(abs);
  if (baseMtime && Math.abs(mtime - baseMtime) > 1) throw new NotebookError(409, 'The notebook changed since you opened it (in JupyterLab or by an agent). Reload it and try again.');
  const at = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= nb.cells.length) throw new NotebookError(400, `No cell ${i} (the notebook has cells 0–${nb.cells.length - 1})`);
    return nb.cells[i];
  };
  if (cells) {
    if (!Array.isArray(cells) || cells.length > 2000) throw new NotebookError(400, 'cells must be a list (2000 at most)');
    const old = nb.cells;
    const used = new Set();
    nb.cells = cells.map((c) => {
      const type = c?.type ?? 'code';
      const prev = Number.isInteger(c?.from) && !used.has(c.from) ? old[c.from] : undefined;
      if (!prev) return makeCell(type, c?.source);
      used.add(c.from);
      if (prev.cell_type === type) {
        if (String(c.source ?? '').length > MAX_CELL_SOURCE) throw new NotebookError(413, 'Cell too large');
        prev.source = splitSource(c.source);
        return prev;
      }
      const cell = makeCell(type, c.source); // a new type: outputs don't carry over
      cell.id = prev.id ?? cell.id;
      return cell;
    });
  }
  for (const o of ops) {
    if (o.op === 'append') nb.cells.push(makeCell(o.type ?? 'code', o.source));
    else if (o.op === 'insert') {
      if (!Number.isInteger(o.index) || o.index < 0 || o.index > nb.cells.length) throw new NotebookError(400, `Can't insert at ${o.index}`);
      nb.cells.splice(o.index, 0, makeCell(o.type ?? 'code', o.source));
    } else if (o.op === 'replace') {
      const old = at(o.index);
      const cell = makeCell(o.type ?? old.cell_type, o.source);
      cell.id = old.id ?? cell.id;
      nb.cells[o.index] = cell;
    } else if (o.op === 'delete') {
      at(o.index);
      nb.cells.splice(o.index, 1);
    } else if (o.op === 'clear_outputs') {
      for (const c of nb.cells) if (c.cell_type === 'code') Object.assign(c, {outputs: [], execution_count: null});
    } else throw new NotebookError(400, `Unknown op "${o.op}"`);
  }
  if (title) (nb.metadata.bluecore ??= {}).title = title;
  if (target) {
    const t = checkTarget(target);
    // Outputs from another environment would be mistaken for this one's
    if (t !== (nb.metadata.bluecore?.target || 'local')) for (const c of nb.cells) if (c.cell_type === 'code') Object.assign(c, {outputs: [], execution_count: null});
    if (t === 'local') delete (nb.metadata.bluecore ??= {}).target;
    else (nb.metadata.bluecore ??= {}).target = t;
  }
  stamp(nb, {writer});
  // The person saving on the page: no AI edit to flag any more
  if (writer === null && nb.metadata.bluecore) {
    delete nb.metadata.bluecore.edited_by;
    delete nb.metadata.bluecore.edited_model;
  }
  save(abs, nb);
  return readNotebook(rel);
}

// Saves run results: results = [{index, outputs, executionCount}]
export function saveOutputs(rel, results, {writer} = {}) {
  const {abs} = resolve(rel);
  const {nb} = load(abs);
  for (const r of results) {
    const cell = nb.cells[r.index];
    if (cell?.cell_type !== 'code') continue;
    cell.outputs = r.outputs;
    cell.execution_count = r.executionCount ?? null;
  }
  const meta = (nb.metadata.bluecore ??= {});
  meta.last_run = {at: new Date().toISOString(), by: writer?.author ?? 'you', ...(writer?.model && {model: writer.model}), target: meta.target || 'local'};
  save(abs, nb);
  return readNotebook(rel);
}

// Moves a notebook to the folder's .trash (the person deletes, on the Notebooks page; agents can't)
// .trash/.restore.json remembers where each trashed notebook came from: {name: {path, title, deleted}}
const ORIGINS = () => path.join(NOTEBOOKS, TRASH, '.restore.json');
function readOrigins() {
  try {
    return JSON.parse(fs.readFileSync(ORIGINS(), 'utf8'));
  } catch {
    return {};
  }
}
const writeOrigins = (o) => fs.writeFileSync(ORIGINS(), `${JSON.stringify(o, null, 1)}\n`);

export function trashNotebook(ref) {
  const rel = findNotebook(ref);
  const {abs} = resolve(rel);
  let title = path.basename(rel, '.ipynb');
  try {
    title = titleOf(load(abs).nb, rel);
  } catch {
    // keep the file name
  }
  const dir = path.join(NOTEBOOKS, TRASH);
  fs.mkdirSync(dir, {recursive: true});
  const base = path.basename(rel, '.ipynb');
  let target = path.join(dir, `${base}.ipynb`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} ${n}.ipynb`);
  fs.renameSync(abs, target);
  const origins = readOrigins();
  origins[path.basename(target)] = {path: rel, title, deleted: new Date().toISOString()};
  writeOrigins(origins);
  return rel;
}

export function trashNotebooks(refs) {
  if (!Array.isArray(refs) || !refs.length || refs.length > 500) throw new NotebookError(400, 'Name the notebooks to delete');
  return {deleted: refs.map((r) => trashNotebook(r))};
}

// JupyterLab deletes into the folder's freedesktop trash (.Trash-<uid>/files, with info/<name>.trashinfo
// saying where each came from); the page's Trash lists those too, as "jupyterlab:<dir>/<name>"
function jupyterTrash() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(NOTEBOOKS).filter((d) => /^\.Trash-\d+$/.test(d));
  } catch {
    return [];
  }
  return dirs.flatMap((d) => {
    let files = [];
    try {
      files = fs.readdirSync(path.join(NOTEBOOKS, d, 'files')).filter((f) => f.toLowerCase().endsWith('.ipynb'));
    } catch {
      return [];
    }
    return files.map((name) => {
      let info = '';
      try {
        info = fs.readFileSync(path.join(NOTEBOOKS, d, 'info', `${name}.trashinfo`), 'utf8');
      } catch {
        // no info: it goes back to the top level
      }
      const original = decodeURIComponent(info.match(/^Path=(.*)$/m)?.[1] ?? name);
      // The path is the container's (/notebooks/…): keep the part inside the folder
      const from = original.replace(/^.*?\/notebooks\//, '').replace(/^\/+/, '') || name;
      const when = info.match(/^DeletionDate=(.*)$/m)?.[1];
      return {name: `jupyterlab:${d}/${name}`, file: path.join(NOTEBOOKS, d, 'files', name), info: path.join(NOTEBOOKS, d, 'info', `${name}.trashinfo`), title: path.basename(from, '.ipynb'), from, deleted: when ? new Date(when).toISOString() : fs.statSync(path.join(NOTEBOOKS, d, 'files', name)).mtime.toISOString(), via: 'JupyterLab'};
    });
  });
}

export function listTrash() {
  const dir = path.join(NOTEBOOKS, TRASH);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.ipynb'));
  } catch {
    // none deleted from the page yet
  }
  const origins = readOrigins();
  return [
    ...files.map((name) => {
      const o = origins[name] ?? {};
      const stat = fs.statSync(path.join(dir, name));
      return {name, title: o.title ?? path.basename(name, '.ipynb'), from: o.path ?? name, deleted: o.deleted ?? stat.mtime.toISOString()};
    }),
    ...jupyterTrash().map(({file, info, ...item}) => item),
  ].sort((a, b) => b.deleted.localeCompare(a.deleted));
}

// Puts a trashed notebook back where it was (or next to it, if that name is taken now)
export function restoreFromTrash(name) {
  if (String(name ?? '').startsWith('jupyterlab:')) {
    const item = jupyterTrash().find((t) => t.name === name);
    if (!item) throw new NotebookError(404, `"${name}" isn't in the trash`);
    const rel = putBack(item.file, item.from);
    fs.rmSync(item.info, {force: true});
    return {restored: rel};
  }
  const clean = path.basename(String(name ?? ''));
  const abs = path.join(NOTEBOOKS, TRASH, clean);
  if (!clean.toLowerCase().endsWith('.ipynb') || !fs.existsSync(abs)) throw new NotebookError(404, `"${name}" isn't in the trash`);
  const origins = readOrigins();
  const rel = putBack(abs, origins[clean]?.path ?? clean);
  delete origins[clean];
  writeOrigins(origins);
  return {restored: rel};
}

// Moves a file back to `from` (a path inside the folder), numbering the name if it's taken now
function putBack(abs, from) {
  const safeFrom = (() => {
    try {
      return resolve(from).rel;
    } catch {
      return path.basename(from);
    }
  })();
  from = safeFrom;
  const folder = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
  let rel = from;
  for (let n = 2; fs.existsSync(path.join(NOTEBOOKS, rel)); n++) rel = `${folder ? `${folder}/` : ''}${path.basename(from, '.ipynb')} ${n}.ipynb`;
  const target = resolve(rel).abs;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.renameSync(abs, target);
  return rel;
}

// --- Organizing: tags, pins, folders, copies -----------------------------------------------------

// Changes a notebook's tags or pin (metadata.bluecore), without touching its cells
export function setNotebookMeta(ref, {tags, pinned} = {}) {
  const rel = findNotebook(ref);
  const {abs} = resolve(rel);
  const {nb} = load(abs);
  const meta = (nb.metadata.bluecore ??= {});
  if (tags !== undefined) {
    const clean = cleanTags(tags);
    if (clean.length) meta.tags = clean;
    else delete meta.tags;
  }
  if (pinned !== undefined) {
    if (pinned) meta.pinned = true;
    else delete meta.pinned;
  }
  save(abs, nb);
  return readNotebook(rel);
}

export function allTags(notebooks = listNotebooks()) {
  const counts = new Map();
  for (const n of notebooks) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({tag, count})).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Every folder (empty ones too), like the notes vault: dot folders left out
export function listFolders(dir = NOTEBOOKS, prefix = '') {
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
      return [rel, ...listFolders(path.join(dir, e.name), rel)];
    });
}

const folderAbs = (folder) => {
  const rel = cleanFolder(folder);
  const abs = path.resolve(NOTEBOOKS, rel);
  if (abs !== NOTEBOOKS && !abs.startsWith(NOTEBOOKS + path.sep)) throw new NotebookError(400, `Invalid folder "${folder}"`);
  return {rel, abs};
};
const folderName = (name) => fileTitle(name).replace(/\.+$/, '');

export function createFolder(folder) {
  const parts = String(folder ?? '').split('/').map(folderName).filter(Boolean);
  if (!parts.length) throw new NotebookError(400, 'The folder name has no usable characters');
  const {rel, abs} = folderAbs(parts.join('/'));
  if (fs.existsSync(abs)) throw new NotebookError(409, `There's already a folder "${rel}"`);
  fs.mkdirSync(abs, {recursive: true});
  return {folder: rel};
}

export function renameFolder(folder, name) {
  const {rel, abs} = folderAbs(folder);
  if (!rel || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new NotebookError(404, `No folder "${folder}"`);
  const clean = folderName(name);
  if (!clean) throw new NotebookError(400, 'The folder name has no usable characters');
  const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  const next = parent ? `${parent}/${clean}` : clean;
  const target = folderAbs(next).abs;
  if (fs.existsSync(target)) throw new NotebookError(409, `There's already a folder "${next}"`);
  fs.renameSync(abs, target);
  return {folder: next};
}

// Moves a folder, with everything in it, into another folder ('' = the top level), keeping its name
export function moveFolder(folder, into) {
  const {rel, abs} = folderAbs(folder);
  if (!rel || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new NotebookError(404, `No folder "${folder}"`);
  const dest = cleanFolder(into);
  if (dest === rel || dest.startsWith(`${rel}/`)) throw new NotebookError(400, `Can't move "${rel}" into itself`);
  if (dest && !fs.existsSync(folderAbs(dest).abs)) throw new NotebookError(404, `No folder "${dest}"`);
  const name = path.posix.basename(rel);
  const next = dest ? `${dest}/${name}` : name;
  if (next === rel) return {folder: rel, from: rel};
  const target = folderAbs(next).abs;
  if (fs.existsSync(target)) throw new NotebookError(409, `There's already a folder "${name}" in ${dest || 'the top level'}`);
  fs.renameSync(abs, target);
  return {folder: next, from: rel};
}

// Deletes selected folders after their contents (deepest first, so a parent is empty by its turn).
// Only empty ones go: a folder still holding something (not selected, or added meanwhile) is kept and
// reported, never deleted with what's in it.
export function deleteFolders(folders = []) {
  if (!Array.isArray(folders) || folders.length > 500) throw new NotebookError(400, 'Name the folders to delete');
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

export function deleteFolder(folder) {
  const {rel, abs} = folderAbs(folder);
  if (!rel || !fs.existsSync(abs)) throw new NotebookError(404, `No folder "${folder}"`);
  const left = fs.readdirSync(abs).filter((f) => f !== '.DS_Store' && f !== '.ipynb_checkpoints');
  if (left.length) throw new NotebookError(409, 'Only empty folders can be deleted: move or delete what\'s inside first');
  fs.rmSync(abs, {recursive: true, force: true});
  return {deleted: rel};
}

// Moves a notebook into a folder ('' = the top level), keeping its file name (numbered if taken)
export function moveNotebook(ref, folder) {
  const rel = findNotebook(ref);
  const {abs} = resolve(rel);
  const dest = cleanFolder(folder);
  if (dest) folderAbs(dest);
  const base = path.basename(rel, '.ipynb');
  let next = `${dest ? `${dest}/` : ''}${base}.ipynb`;
  if (next === rel) return readNotebook(rel);
  for (let n = 2; fs.existsSync(path.join(NOTEBOOKS, next)); n++) next = `${dest ? `${dest}/` : ''}${base} ${n}.ipynb`;
  const target = resolve(next).abs;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.renameSync(abs, target);
  return readNotebook(next);
}

// A copy next to the original, "<title> copy", outputs included
export function duplicateNotebook(ref, {title, writer} = {}) {
  const rel = findNotebook(ref);
  const {nb} = load(resolve(rel).abs);
  const name = title || `${titleOf(nb, rel)} copy`;
  const folder = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
  const meta = nb.metadata.bluecore ?? {};
  nb.metadata.bluecore = {title: name, ...(meta.target && {target: meta.target}), ...(meta.tags && {tags: meta.tags})};
  for (const c of nb.cells) c.id = newId();
  stamp(nb, {writer: writer ?? {author: 'you'}, created: true});
  const next = freePath(folder, name);
  save(resolve(next).abs, nb);
  return readNotebook(next);
}

// --- Search ----------------------------------------------------------------------------------------

// Every word must appear in the title, tags, a cell or an output; titles count most. [{path, snippet}]
export function searchNotebooks(query, {limit = 50} = {}) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const rel of walk()) {
    let nb;
    try {
      nb = load(path.join(NOTEBOOKS, rel)).nb;
    } catch {
      continue;
    }
    const title = titleOf(nb, rel).toLowerCase();
    const tags = cleanTags(nb.metadata?.bluecore?.tags).join(' ').toLowerCase();
    const texts = nb.cells.flatMap((c) => [joinSource(c.source), ...(c.outputs ?? []).map(outputText)]);
    const body = texts.join('\n').toLowerCase();
    if (!words.every((w) => title.includes(w) || tags.includes(w) || body.includes(w) || rel.toLowerCase().includes(w))) continue;
    const score = words.reduce((s, w) => s + (title.includes(w) ? 10 : 0) + (tags.includes(w) ? 5 : 0) + Math.min(body.split(w).length - 1, 5), 0);
    // The first line holding a word, as the snippet
    let snippet = '';
    for (const t of texts) {
      const line = t.split('\n').find((l) => words.some((w) => l.toLowerCase().includes(w)));
      if (line) {
        snippet = line.trim().slice(0, 160);
        break;
      }
    }
    hits.push({path: rel, snippet, score});
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({path: p, snippet}) => ({path: p, snippet}));
}

// --- Export ----------------------------------------------------------------------------------------

// [{name, data, mtime}] for zip.mjs: the notebooks, at their paths in the folder
export function exportFiles(refs) {
  if (!Array.isArray(refs) || !refs.length || refs.length > 500) throw new NotebookError(400, 'Name the notebooks to export');
  return refs.map((r) => {
    const rel = findNotebook(r);
    const {abs} = resolve(rel);
    return {name: rel, data: fs.readFileSync(abs), mtime: fs.statSync(abs).mtime};
  });
}

export {resolve as resolveNotebook};
