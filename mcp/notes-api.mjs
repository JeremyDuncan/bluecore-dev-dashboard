// Notes for the site's Notes page (src/pages/notes.js), served next to the MCP endpoint:
//
//   GET  /api/notes                     every note's metadata, the tags, the vault's name
//   GET  /api/notes/search?q=<words>    notes matching all the words (title, tags, text)
//   GET  /api/notes/note?path=<path>    one note with its text and backlinks
//   POST /api/notes/note                create {title, body, tags, folder}
//   PUT  /api/notes/note?path=<path>    save {body, tags, baseMtime} (409 if it changed meanwhile)
//   GET  /api/notes/file?path=<path>    an image or PDF from the vault (for ![[embeds]])
//   POST /api/notes/export              {paths, name} → a zip of those notes and the images they embed
//   POST /api/notes/delete              {paths} → moves those notes to the vault's .trash folder
//   POST /api/notes/move                {path, folder} → moves a note to a folder ('' = top level)
//   POST /api/notes/folder              {path} → creates a folder
//   POST /api/notes/folder/rename       {path, name} → renames a folder
//   POST /api/notes/folder/delete       {path} → deletes an empty folder
//   POST /api/notes/pin                 {path, pinned} → pins or unpins a note
//   POST /api/notes/rename              {path, title} → renames a note and updates [[links]] to it
//   GET  /api/notes/trash               what's in the vault's .trash
//   POST /api/notes/trash/restore       {name} → puts it back where it was
//   POST /api/notes/trash/purge         {name} → deletes it for good
//   POST /api/notes/attachment?name=    an image (raw bytes, content-type image/*) → attachments/
//   GET  /api/notes/templates           notes in Templates/;  POST /api/notes/templates/starter adds three
//   GET  /api/notes/doc-links?path=     notes that link to a docs page (shown on that page)
//   GET  /api/notes/docs-search?q=      docs pages, for linking a note to one
//
// Like the rest of this server it only listens on this machine. Writes must come from a page on
// this machine (or LIVE_ALLOWED_ORIGINS) with a JSON body, which a browser only sends cross-site
// after a CORS check, so another website can't write notes.
import {zip} from './zip.mjs';
import {search as searchDocs} from './docs-index.mjs';
import {
  createStarterTemplates,
  listTemplates,
  listTrash,
  notesLinkingTo,
  purgeFromTrash,
  renameNote,
  restoreFromTrash,
  saveAttachment,
} from './notes.mjs';
import {allTags, createFolder, createNote, deleteFolder, deleteNotes, exportFiles, listFolders, moveNote, renameFolder, findAttachment, listNotes, NoteError, readAttachment, readNote, searchNotes, updateNote, VAULT_NAME} from './notes.mjs';
import {allowedOrigin} from './live-api.mjs';

const MAX_BODY = 1_200_000;
const MAX_UPLOAD = 20_000_000;

// An image upload: the raw bytes. Its image/* content type can't be sent cross-site without a CORS
// check, like JSON.
async function readImage(req) {
  if (!/^image\//i.test(req.headers['content-type'] ?? '')) throw new NoteError(415, 'Send an image (content-type: image/…)');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD) throw new NoteError(413, 'The image is too large (20 MB at most)');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(origin && {'access-control-allow-origin': origin, vary: 'Origin'}),
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new NoteError(415, 'Send JSON (content-type: application/json)');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new NoteError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new NoteError(400, 'Invalid JSON');
  }
}

// Returns true when the request was for /api/notes...
export async function handleNotesApi(req, res, pathname) {
  if (pathname !== '/api/notes' && !pathname.startsWith('/api/notes/')) return false;
  const origin = allowedOrigin(req.headers.origin);
  const params = new URL(req.url, 'http://x').searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, {
      ...(origin && {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, PUT',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      }),
    });
    res.end();
    return true;
  }
  // A browser always sends Origin on a write; refuse any page that isn't ours
  if (req.method !== 'GET' && req.headers.origin && !origin) {
    send(res, 403, {error: 'Origin not allowed'}, null);
    return true;
  }

  try {
    if (pathname === '/api/notes' && req.method === 'GET') {
      const notes = listNotes();
      send(res, 200, {vault: VAULT_NAME, notes, folders: listFolders(), tags: allTags(notes), at: new Date().toISOString()}, origin);
    } else if (pathname === '/api/notes/search' && req.method === 'GET') {
      send(res, 200, {results: searchNotes(params.get('q'), {limit: 100}).map((n) => ({path: n.path, snippet: n.snippet}))}, origin);
    } else if (pathname === '/api/notes/note' && req.method === 'GET') {
      send(res, 200, strip(readNote(params.get('path'))), origin);
    } else if (pathname === '/api/notes/note' && req.method === 'POST') {
      const {title, body, tags, folder, author} = await readJson(req);
      // "you", or a label for where it came from (the chat box saves answers as "Ask the docs")
      send(res, 201, strip(createNote({title, body, tags, folder, author: typeof author === 'string' && author.trim() ? author : 'you'})), origin);
    } else if (pathname === '/api/notes/note' && req.method === 'PUT') {
      const {body, tags, baseMtime, folder} = await readJson(req);
      let note = updateNote(params.get('path'), {body, tags, baseMtime});
      // A changed Folder field moves the note too
      if (typeof folder === 'string' && folder.replace(/^\/+|\/+$/g, '') !== note.folder) note = moveNote(note.path, folder);
      send(res, 200, strip(note), origin);
    } else if (pathname === '/api/notes/pin' && req.method === 'POST') {
      const {path: notePath, pinned} = await readJson(req);
      send(res, 200, strip(updateNote(notePath, {pinned: Boolean(pinned)})), origin);
    } else if (pathname === '/api/notes/rename' && req.method === 'POST') {
      const {path: notePath, title} = await readJson(req);
      const result = renameNote(notePath, String(title ?? ''));
      send(res, 200, {...result, note: strip(result.note)}, origin);
    } else if (pathname === '/api/notes/trash' && req.method === 'GET') {
      send(res, 200, {items: listTrash()}, origin);
    } else if (pathname === '/api/notes/trash/restore' && req.method === 'POST') {
      send(res, 200, restoreFromTrash((await readJson(req)).name), origin);
    } else if (pathname === '/api/notes/trash/purge' && req.method === 'POST') {
      send(res, 200, purgeFromTrash((await readJson(req)).name), origin);
    } else if (pathname === '/api/notes/attachment' && req.method === 'POST') {
      send(res, 201, saveAttachment(await readImage(req), req.headers['content-type'], params.get('name')), origin);
    } else if (pathname === '/api/notes/templates' && req.method === 'GET') {
      send(res, 200, {templates: listTemplates().map(({path, title}) => ({path, title}))}, origin);
    } else if (pathname === '/api/notes/templates/starter' && req.method === 'POST') {
      send(res, 201, createStarterTemplates(), origin);
    } else if (pathname === '/api/notes/doc-links' && req.method === 'GET') {
      send(res, 200, {notes: notesLinkingTo(params.get('path'))}, origin);
    } else if (pathname === '/api/notes/docs-search' && req.method === 'GET') {
      const results = await searchDocs(params.get('q') ?? '', {limit: 12});
      const site = (process.env.DOCS_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
      const seen = new Set();
      const pages = results
        .map((r) => ({title: r.title, section: r.section, path: r.url.startsWith(site) ? r.url.slice(site.length) || '/' : r.url}))
        .filter((r) => !seen.has(r.path) && seen.add(r.path));
      send(res, 200, {pages}, origin);
    } else if (pathname === '/api/notes/move' && req.method === 'POST') {
      const {path: notePath, folder} = await readJson(req);
      send(res, 200, strip(moveNote(notePath, folder)), origin);
    } else if (pathname === '/api/notes/folder' && req.method === 'POST') {
      send(res, 201, createFolder((await readJson(req)).path), origin);
    } else if (pathname === '/api/notes/folder/rename' && req.method === 'POST') {
      const {path: folder, name} = await readJson(req);
      send(res, 200, renameFolder(folder, name), origin);
    } else if (pathname === '/api/notes/folder/delete' && req.method === 'POST') {
      send(res, 200, deleteFolder((await readJson(req)).path), origin);
    } else if (pathname === '/api/notes/delete' && req.method === 'POST') {
      const {paths} = await readJson(req);
      send(res, 200, deleteNotes(paths), origin);
    } else if (pathname === '/api/notes/export' && req.method === 'POST') {
      const {paths, name} = await readJson(req);
      const data = zip(exportFiles(paths));
      const file = `${String(name || 'notes').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 100) || 'notes'}.zip`;
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': data.length,
        'content-disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}`,
        'cache-control': 'no-store',
        ...(origin && {'access-control-allow-origin': origin, vary: 'Origin'}),
      });
      res.end(data);
    } else if (pathname === '/api/notes/file' && req.method === 'GET') {
      const rel = findAttachment(params.get('path') ?? '');
      if (!rel) throw new NoteError(404, 'No such file');
      const {data, type} = readAttachment(rel);
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-cache',
        // Opened directly, an SVG or PDF can't run scripts with this server's origin
        'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        'x-content-type-options': 'nosniff',
        ...(origin && {'access-control-allow-origin': origin, vary: 'Origin'}),
      });
      res.end(data);
    } else {
      send(res, 404, {error: 'unknown endpoint'}, origin);
    }
  } catch (err) {
    if (!(err instanceof NoteError)) console.error('[notes-api]', err);
    send(res, err.status ?? 500, {error: err.message, ...(err.note && {note: err.note})}, origin);
  }
  return true;
}

const strip = ({frontMatter, ...note}) => note;
