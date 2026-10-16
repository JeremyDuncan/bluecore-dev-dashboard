// Folder icons for the Notes and Notebooks pages: {folder path: icon} in <root>/.dashboard/folder-icons.json.
// A dot folder, so Obsidian, JupyterLab and the pages' own file lists leave it alone, and the icons travel
// with the vault or notebooks folder. An icon is "line:<name>" (one of the site's line icons,
// mcp/icon-names.mjs) or "emoji:<emoji>"; notes and notebooks keep theirs in the file itself. The APIs move an icon when its folder is
// renamed or moved, and drop it when the folder is deleted.
import fs from 'node:fs';
import path from 'node:path';
import {LINE_ICON_NAMES} from './icon-names.mjs';

const LINE_NAMES = new Set(LINE_ICON_NAMES.map((i) => i.name));
const isEmoji = (t) => t.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t) && !/[\p{L}\p{N}\s<>]/u.test(t.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}/gu, ''));

const file = (root) => path.join(root, '.dashboard', 'folder-icons.json');

function read(root) {
  try {
    const data = JSON.parse(fs.readFileSync(file(root), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function write(root, icons) {
  fs.mkdirSync(path.dirname(file(root)), {recursive: true});
  const sorted = Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file(root), `${JSON.stringify(sorted, null, 1)}\n`);
}

// "line:<name>" (one of LINE_ICON_NAMES) or "emoji:📚" (an emoji, possibly with modifiers or joiners);
// anything else is refused
export function validIcon(icon) {
  if (typeof icon !== 'string') return false;
  if (icon.startsWith('line:')) return LINE_NAMES.has(icon.slice(5));
  return icon.startsWith('emoji:') && isEmoji(icon.slice(6));
}

// An icon as an agent gives it (MCP tools): a line icon's name ("bug"), an emoji ("🐛"), the stored
// form ("line:bug", "emoji:🐛"), or "none" / "" to remove it. Returns the stored form, or null to remove.
export function iconFromInput(input) {
  const t = String(input ?? '').trim();
  if (!t || /^(none|remove|null)$/i.test(t)) return null;
  const icon = t.startsWith('line:') || t.startsWith('emoji:') ? t : LINE_NAMES.has(t.toLowerCase()) ? `line:${t.toLowerCase()}` : `emoji:${t}`;
  if (!validIcon(icon)) throw Object.assign(new Error(`"${t}" isn't an icon. Use one emoji, or one of: ${[...LINE_NAMES].join(', ')}.`), {status: 400});
  return icon;
}

// For agents (the MCP tools' icon option): what an icon can be
export const ICON_HELP = `A line icon's name (${LINE_ICON_NAMES.map((i) => i.name).join(', ')}) or one emoji (e.g. 🧪), or "none" to remove it.`;

// The icons of folders that exist (`folders`: every folder path), so one left by a folder deleted
// outside the site doesn't show up on a new folder of the same name
export function folderIcons(root, folders) {
  const exists = new Set(folders);
  return Object.fromEntries(Object.entries(read(root)).filter(([folder, icon]) => exists.has(folder) && validIcon(icon)));
}

// Sets a folder's icon (null removes it). `folder` must be an existing folder inside root.
export function setFolderIcon(root, folder, icon) {
  const rel = String(folder ?? '').replace(/^\/+|\/+$/g, '');
  const abs = path.resolve(root, rel);
  if (!rel || !abs.startsWith(root + path.sep) || rel.split('/').some((p) => p.startsWith('.'))) {
    throw Object.assign(new Error(`Invalid folder "${folder}"`), {status: 400});
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw Object.assign(new Error(`No folder "${rel}"`), {status: 404});
  if (icon != null && !validIcon(icon)) throw Object.assign(new Error('Pick an icon from the list, or one emoji'), {status: 400});
  const icons = read(root);
  if (icon == null) delete icons[rel];
  else icons[rel] = icon;
  write(root, icons);
  return {folder: rel, icon: icon ?? null};
}

// A folder was renamed or moved: its icon, and its sub-folders', follow it
export function moveFolderIcons(root, from, to) {
  if (!from || !to || from === to) return;
  const icons = read(root);
  let changed = false;
  for (const [folder, icon] of Object.entries(icons)) {
    if (folder !== from && !folder.startsWith(`${from}/`)) continue;
    delete icons[folder];
    icons[to + folder.slice(from.length)] = icon;
    changed = true;
  }
  if (changed) write(root, icons);
}

// Folders were deleted: forget their icons
export function dropFolderIcons(root, folders) {
  const icons = read(root);
  let changed = false;
  for (const gone of folders) {
    for (const folder of Object.keys(icons)) {
      if (folder === gone || folder.startsWith(`${gone}/`)) {
        delete icons[folder];
        changed = true;
      }
    }
  }
  if (changed) write(root, icons);
}
