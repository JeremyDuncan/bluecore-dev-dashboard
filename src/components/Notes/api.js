// The notes API (mcp/notes-api.mjs), served by the MCP container next to the live GitHub data
import {useCallback, useEffect, useRef, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export function useNotesApi() {
  const base = useDocusaurusContext().siteConfig.customFields?.liveApiUrl;
  const call = useCallback(
    async (path, {method = 'GET', body} = {}) => {
      const res = await fetch(`${base}/notes${path}`, {
        method,
        headers: body ? {'content-type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {status: res.status, data});
      return data;
    },
    [base],
  );
  const fileUrl = useCallback((name) => `${base}/notes/file?path=${encodeURIComponent(name)}`, [base]);

  // Downloads notes: one note as its .md file, several as a zip (with the images they embed).
  // `name`: the zip's file name, without .zip
  const exportNotes = useCallback(
    async (paths, name) => {
      if (paths.length === 1) {
        const note = await call(`/note?path=${encodeURIComponent(paths[0])}`);
        download(new Blob([note.raw], {type: 'text/markdown;charset=utf-8'}), note.path.split('/').pop());
        return;
      }
      const res = await fetch(`${base}/notes/export`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({paths, name})});
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      download(await res.blob(), `${name}.zip`);
    },
    [base, call],
  );
  // Saves an image into the vault's attachments folder; returns {name} to embed as ![[name]].
  // Pasted screenshots are all called "image.png", so those get a timestamped name instead.
  const uploadImage = useCallback(
    async (file) => {
      const name = file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? file.name : '';
      const res = await fetch(`${base}/notes/attachment?name=${encodeURIComponent(name)}`, {method: 'POST', headers: {'content-type': file.type}, body: file});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    [base],
  );
  return {enabled: Boolean(base), call, fileUrl, exportNotes, uploadImage};
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href: url, download: fileName});
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Copies text; falls back to a hidden textarea where the Clipboard API isn't available
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // e.g. not a secure context
  }
  const ta = Object.assign(document.createElement('textarea'), {value: text});
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Copying is blocked in this browser');
}

// Every note's metadata. Reloads every 20s, when the tab gets focus and on a "notes-changed" event
// (the chat box saved a note), so notes written in Obsidian or by an agent show up without a reload.
export function useNoteList() {
  const {enabled, call} = useNotesApi();
  const [state, setState] = useState({status: enabled ? 'loading' : 'disabled', notes: [], folders: [], folderIcons: {}, tags: [], vault: null, error: null});
  const busy = useRef(false);
  const reload = useCallback(async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    try {
      const data = await call('');
      setState({status: 'ready', notes: data.notes, folders: data.folders ?? [], folderIcons: data.folderIcons ?? {}, tags: data.tags, vault: data.vault, error: null});
    } catch (err) {
      setState((s) => ({...s, status: s.status === 'ready' ? 'ready' : 'error', error: err.message}));
    } finally {
      busy.current = false;
    }
  }, [enabled, call]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 20_000);
    window.addEventListener('focus', reload);
    window.addEventListener('notes-changed', reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('notes-changed', reload);
    };
  }, [reload]);
  return {...state, reload};
}

// Finds a note the way [[links]] do: path, file name, title or alias (case-insensitive)
export function makeResolver(notes) {
  const map = new Map();
  const add = (key, path) => key && !map.has(key.toLowerCase()) && map.set(key.toLowerCase(), path);
  for (const n of notes) add(n.path.replace(/\.md$/i, ''), n.path);
  for (const n of notes) add(n.path.split('/').pop().replace(/\.md$/i, ''), n.path);
  for (const n of notes) [n.title, ...(n.aliases ?? [])].forEach((k) => add(k, n.path));
  return (name) => (name ? map.get(String(name).trim().replace(/\.md$/i, '').toLowerCase()) ?? null : null);
}
