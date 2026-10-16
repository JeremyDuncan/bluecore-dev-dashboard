// Notebooks for the site's Notebooks page (src/pages/notebooks.js), served next to the MCP endpoint:
//
//   GET  /api/notebooks                       every notebook's summary, the starters, JupyterLab's status,
//                                             the environments notebooks can run against, the local stack checkout
//   GET  /api/notebooks/notebook?path=<path>  one notebook with its cells and outputs
//   POST /api/notebooks/notebook              create {title, folder, starter?}
//   PUT  /api/notebooks/notebook?path=<path>  edit {ops | cells, baseMtime, title?, target?} (see updateNotebook in notebooks.mjs)
//   POST /api/notebooks/run                   {path, cells?, restart?, target?} → runs code cells in JupyterLab, saves the outputs
//   POST /api/notebooks/interrupt             {path} → stops the code running in the notebook's kernel
//   POST /api/notebooks/restart               {path} → restarts the notebook's kernel (clears its variables)
//   POST /api/notebooks/starters              copies the starter notebooks into Starters/
//   POST /api/notebooks/delete                {path} or {paths}, and {folders}? → moves notebooks to the folder's .trash, then
//                                             deletes the folders named that are empty by then
//   GET  /api/notebooks/search?q=             full-text search: titles, tags, cells and outputs
//   POST /api/notebooks/meta                  {path, tags?, pinned?}
//   POST /api/notebooks/duplicate             {path} → a copy next to it
//   POST /api/notebooks/move                  {path, folder} ('' = top level)
//   POST /api/notebooks/folder                {path} → a new folder; /folder/rename {path, name}; /folder/move {path, folder} (with its contents; '' = top level); /folder/delete {path} (empty only)
//   GET  /api/notebooks/trash                 what's in .trash; POST /trash/restore {name} puts one back
//   GET  /api/notebooks/export?path=          the .ipynb file; POST /export {paths, name} → a .zip
//
// Same rules as the notes API: this machine only, and writes need a JSON body from an allowed origin.
import fs from 'node:fs';
import path from 'node:path';
import {allowedOrigin} from './live-api.mjs';
import {readJson, send} from './notes-api.mjs';
import {interruptKernelOf, jupyterStatus, labUrl, restartKernelOf, runCells} from './jupyter.mjs';
import {environments, stackInfo} from './local-stack.mjs';
import {zip} from './zip.mjs';
import {
  allTags,
  createFolder,
  deleteFolder,
  deleteFolders,
  duplicateNotebook,
  exportFiles,
  listFolders,
  listTrash,
  moveFolder,
  moveNotebook,
  renameFolder,
  resolveNotebook,
  restoreFromTrash,
  searchNotebooks,
  setNotebookMeta,
  trashNotebooks,
} from './notebooks.mjs';
import {createNotebook, createStarterNotebooks, listNotebooks, listStarters, NOTEBOOKS, NOTEBOOKS_ENABLED, readNotebook, saveOutputs, trashNotebook, updateNotebook} from './notebooks.mjs';

const withLab = (nb) => ({...nb, labUrl: labUrl(nb.path)});

// After a notebook's environment changed (saved in the notebook, where the kernel reads it; that also
// clears the old environment's outputs): restart its kernel if one runs, as the kernel's environment
// variables are set when it starts. Best effort: JupyterLab may be down.
export async function afterTargetChange(rel) {
  try {
    await restartKernelOf(rel);
  } catch {
    // the next run starts a kernel anyway
  }
}

// Runs a notebook's code cells and saves the outputs; returns the saved notebook and a summary.
// target: switch the notebook to that environment first (see switchTarget).
export async function runNotebook(ref, {cells, restart, keepGoing, timeoutMs, writer, target} = {}) {
  let nb = readNotebook(ref);
  if (target && target !== nb.target) {
    nb = updateNotebook(nb.path, {target, writer});
    restart = true; // a fresh kernel picks up the new environment's variables
  }
  const results = await runCells(nb.path, nb.cellsList, {indexes: cells, restart, keepGoing, timeoutMs, kernel: nb.kernel});
  const saved = saveOutputs(nb.path, results, {writer});
  return {notebook: saved, results};
}

export async function handleNotebooksApi(req, res, pathname) {
  if (pathname !== '/api/notebooks' && !pathname.startsWith('/api/notebooks/')) return false;
  const origin = allowedOrigin(req.headers.origin);
  if (!NOTEBOOKS_ENABLED) {
    send(res, 404, {error: 'Notebooks are turned off (JUPYTER_NOTEBOOK=false in .env)'}, origin);
    return true;
  }
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
  if (req.method !== 'GET' && req.headers.origin && !origin) {
    send(res, 403, {error: 'Origin not allowed'}, null);
    return true;
  }

  try {
    if (pathname === '/api/notebooks' && req.method === 'GET') {
      const {configured, path: stackPath, branch, commit, uncommitted} = stackInfo();
      const notebooks = listNotebooks();
      send(res, 200, {
        folder: process.env.NOTEBOOKS_SOURCE || NOTEBOOKS,
        notebooks,
        tags: allTags(notebooks),
        folders: listFolders(),
        starters: listStarters(),
        jupyter: await jupyterStatus(),
        environments: environments(),
        stack: {configured, path: stackPath ?? null, branch: branch ?? null, commit: commit ?? null, uncommitted: uncommitted?.length ?? null},
      }, origin);
    } else if (pathname === '/api/notebooks/notebook' && req.method === 'GET') {
      send(res, 200, withLab(readNotebook(params.get('path'))), origin);
    } else if (pathname === '/api/notebooks/notebook' && req.method === 'POST') {
      const {title, folder, starter} = await readJson(req);
      send(res, 201, withLab(createNotebook({title, folder, starter, writer: {author: 'you'}})), origin);
    } else if (pathname === '/api/notebooks/notebook' && req.method === 'PUT') {
      const {ops, cells, baseMtime, title, target} = await readJson(req);
      // writer null: the person saved it (clears the AI-edit flag); only switching the environment doesn't count
      const writer = ops?.length || cells || title ? null : undefined;
      const before = target && readNotebook(params.get('path')).target;
      const nb = updateNotebook(params.get('path'), {ops, cells, baseMtime, title, target, writer});
      if (target && nb.target !== before) await afterTargetChange(nb.path);
      send(res, 200, withLab(nb), origin);
    } else if (pathname === '/api/notebooks/run' && req.method === 'POST') {
      const {path, cells, restart, target} = await readJson(req);
      const {notebook, results} = await runNotebook(path, {cells, restart, target});
      send(res, 200, {...withLab(notebook), results: results.map(({index, status}) => ({index, status}))}, origin);
    } else if ((pathname === '/api/notebooks/interrupt' || pathname === '/api/notebooks/restart') && req.method === 'POST') {
      const {path} = await readJson(req);
      const nb = readNotebook(path);
      const done = pathname.endsWith('interrupt') ? await interruptKernelOf(nb.path) : await restartKernelOf(nb.path);
      send(res, 200, {ok: done}, origin);
    } else if (pathname === '/api/notebooks/starters' && req.method === 'POST') {
      send(res, 200, {added: createStarterNotebooks()}, origin);
    } else if (pathname === '/api/notebooks/delete' && req.method === 'POST') {
      const {path, paths, folders = []} = await readJson(req);
      const notebooks = paths?.length || (!path && !folders.length) ? trashNotebooks(paths) : {deleted: path ? [trashNotebook(path)] : []};
      send(res, 200, {...notebooks, ...deleteFolders(folders)}, origin);
    } else if (pathname === '/api/notebooks/search' && req.method === 'GET') {
      send(res, 200, {results: searchNotebooks(params.get('q'))}, origin);
    } else if (pathname === '/api/notebooks/meta' && req.method === 'POST') {
      const {path, tags, pinned} = await readJson(req);
      send(res, 200, withLab(setNotebookMeta(path, {tags, pinned})), origin);
    } else if (pathname === '/api/notebooks/duplicate' && req.method === 'POST') {
      const {path, title} = await readJson(req);
      send(res, 201, withLab(duplicateNotebook(path, {title})), origin);
    } else if (pathname === '/api/notebooks/move' && req.method === 'POST') {
      const {path, folder} = await readJson(req);
      send(res, 200, withLab(moveNotebook(path, folder ?? '')), origin);
    } else if (pathname === '/api/notebooks/folder' && req.method === 'POST') {
      send(res, 201, createFolder((await readJson(req)).path), origin);
    } else if (pathname === '/api/notebooks/folder/rename' && req.method === 'POST') {
      const {path, name} = await readJson(req);
      send(res, 200, renameFolder(path, name), origin);
    } else if (pathname === '/api/notebooks/folder/move' && req.method === 'POST') {
      const {path, folder} = await readJson(req);
      send(res, 200, moveFolder(path, folder ?? ''), origin);
    } else if (pathname === '/api/notebooks/folder/delete' && req.method === 'POST') {
      send(res, 200, deleteFolder((await readJson(req)).path), origin);
    } else if (pathname === '/api/notebooks/trash' && req.method === 'GET') {
      send(res, 200, {items: listTrash()}, origin);
    } else if (pathname === '/api/notebooks/trash/restore' && req.method === 'POST') {
      send(res, 200, restoreFromTrash((await readJson(req)).name), origin);
    } else if (pathname === '/api/notebooks/export') {
      // One notebook: the .ipynb as it is. Several (POST): a zip keeping their folders.
      let data;
      let file;
      let type;
      if (req.method === 'GET') {
        const nb = readNotebook(params.get('path'));
        data = fs.readFileSync(resolveNotebook(nb.path).abs);
        file = path.basename(nb.path);
        type = 'application/x-ipynb+json';
      } else {
        const {paths, name} = await readJson(req);
        data = zip(exportFiles(paths));
        file = `${String(name || 'notebooks').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 100) || 'notebooks'}.zip`;
        type = 'application/zip';
      }
      res.writeHead(200, {
        'content-type': type,
        'content-length': data.length,
        'content-disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}`,
        'cache-control': 'no-store',
        ...(origin && {'access-control-allow-origin': origin, vary: 'Origin'}),
      });
      res.end(data);
    } else {
      send(res, 404, {error: 'Not found'}, origin);
    }
  } catch (err) {
    if (err.status) send(res, err.status, {error: err.message}, origin);
    else {
      console.error('[notebooks]', err);
      send(res, 500, {error: 'Something went wrong reading or running the notebook'}, origin);
    }
  }
  return true;
}
