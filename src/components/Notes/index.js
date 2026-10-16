// The Notes page (/notes): read, search and write the notes vault served by the MCP container
// (mcp/notes.mjs). Everything is in the URL, so every view can be linked and the Back button works:
//   ?note=<path>            a note          ?note=<path>&edit   editing it
//   ?new[&title=…][&tag=…]  a new note      ?view=date|tags|folders, ?tag=, ?folder=, ?q=, ?sort=created
import React, {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import Link from '@docusaurus/Link';
import {useHistory, useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import NoteMarkdown from './NoteMarkdown';
import {copyText, makeResolver, useNoteList, useNotesApi} from './api';
import ConfirmDelete from './ConfirmDelete';
import {FolderGlyph, Glyph, IconButtonGlyph, IconPicker, IconPickerHost, RowIconButton, rowItemClass} from '../FolderIcons';
import MarkdownToolbar, {insertAtCursor} from './MarkdownToolbar';
import Outline, {useOutline} from './Outline';
import QuickSwitcher from './QuickSwitcher';
import Trash, {useTrash} from './Trash';
import {clearDraft, readDraft, useDraftAutosave} from './drafts';
import {
  ArrowLeftIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  DuplicateIcon,
  EditIcon,
  EyeIcon,
  FolderIcon,
  HelpIcon,
  LayoutIcon,
  LinkIcon,
  MoreIcon,
  NoteIcon,
  ObsidianIcon,
  PanelIcon,
  PinIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SelectIcon,
  SparkleIcon,
  TagIcon,
  TemplateIcon,
  TextIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from './icons';
import {ProviderIcon} from '../AskDocs/CliPicker';
import PageHero from '../PageHero';
import {writer} from './authors';
import styles from './styles.module.css';

// --- Dates ---------------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dateGroup(iso, now = new Date()) {
  const t = new Date(iso).getTime();
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return 'Previous 7 days';
  const d = new Date(iso);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Earlier this month';
  return d.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
}

export function shortWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (startOfDay(d) === startOfDay(now)) return d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() && {year: 'numeric'})});
}

// "just now", "5 min ago", "3 h ago", "yesterday", then the date
export function relWhen(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  if (startOfDay(new Date(iso)) === startOfDay(new Date()) - DAY) return 'yesterday';
  return shortWhen(iso);
}
const longWhen = (iso) => new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});

// --- URL state -----------------------------------------------------------------------------------

function useNotesUrl() {
  const location = useLocation();
  const history = useHistory();
  const base = useBaseUrl('/notes');
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  // A link to the page with these params changed (null removes one). Link adds the base URL itself.
  const href = useCallback(
    (changes, {keep = true} = {}) => {
      const next = new URLSearchParams(keep ? params : undefined);
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === false) next.delete(k);
        else next.set(k, v === true ? '' : v);
      }
      // Opening a note (or starting one) leaves the Trash page
      if ((changes.note || changes.new) && !('trash' in changes)) next.delete('trash');
      const q = next.toString().replace(/=(&|$)/g, '$1');
      return `/notes${q ? `?${q}` : ''}`;
    },
    [params],
  );
  const go = useCallback((to, {replace} = {}) => history[replace ? 'replace' : 'push'](base + to.slice('/notes'.length)), [history, base]);
  return {
    params,
    href,
    go,
    note: params.get('note'),
    editing: params.has('edit'),
    creating: params.has('new'),
    view: params.get('view') || 'date',
    tag: params.get('tag'),
    folder: params.get('folder'),
    q: params.get('q') || '',
    sort: params.get('sort') === 'created' ? 'created' : 'updated',
    trash: params.has('trash'),
  };
}

// --- Small pieces --------------------------------------------------------------------------------
// TagBrowser, TagInput, GroupCheck, Menu, FolderNameInput, buildTree, useOpenFolders and the date
// helpers are exported for the Notebooks page, whose list looks and works like this one.

function TagChip({tag, count, active, to}) {
  return (
    <Link to={to} className={`${styles.tag} ${active ? styles.tagActive : ''}`} aria-current={active ? 'true' : undefined}>
      <TagIcon size={12} />
      {tag}
      {count != null && <span className={styles.tagCount}>{count}</span>}
    </Link>
  );
}

// --- Finding a tag among many: filter, sort, show the top ones -----------------------------------

const TAG_SORTS = [
  ['count', 'Most used'],
  ['name', 'A–Z'],
  ['recent', 'Recently used'],
];
const TAG_SORT_KEY = 'notes-tag-sort';

// tags: [{tag, count}]; activeTag: the selected one (always shown); hrefFor(tag) → link;
// onPick(tag): Enter in the filter box picks the first match. limit: how many show before "Show all".
export function TagBrowser({tags, notes, activeTag, hrefFor, onPick, limit = 24}) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [sort, setSortState] = useState(() => {
    try {
      return localStorage.getItem(TAG_SORT_KEY) || 'count';
    } catch {
      return 'count';
    }
  });
  const setSort = (next) => {
    setSortState(next);
    try {
      localStorage.setItem(TAG_SORT_KEY, next);
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  };
  // When each tag was last used (its newest note), for "Recently used"
  const lastUsed = useMemo(() => {
    const m = new Map();
    for (const n of notes) for (const t of n.tags) if ((m.get(t.toLowerCase()) ?? '') < n.updated) m.set(t.toLowerCase(), n.updated);
    return m;
  }, [notes]);
  const want = q.trim().replace(/^#/, '').toLowerCase();
  const active = activeTag?.toLowerCase();
  const shown = useMemo(() => {
    const matches = tags.filter((t) => !want || t.tag.toLowerCase().includes(want));
    const byName = (a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true, sensitivity: 'base'});
    const order = {
      count: (a, b) => b.count - a.count || byName(a, b),
      name: byName,
      recent: (a, b) => (lastUsed.get(b.tag.toLowerCase()) ?? '').localeCompare(lastUsed.get(a.tag.toLowerCase()) ?? '') || byName(a, b),
    }[sort] ?? byName;
    // Typing: tags that start with the text come first
    return [...matches].sort((a, b) => (want ? Number(b.tag.toLowerCase().startsWith(want)) - Number(a.tag.toLowerCase().startsWith(want)) : 0) || order(a, b));
  }, [tags, want, sort, lastUsed]);
  const capped = !want && !expanded && shown.length > limit;
  let visible = capped ? shown.slice(0, limit) : shown;
  if (capped && active && !visible.some((t) => t.tag.toLowerCase() === active)) visible = [...visible, ...shown.filter((t) => t.tag.toLowerCase() === active)];

  if (!tags.length) return <p className={styles.empty}>No tags yet.</p>;
  return (
    <div className={styles.tagBrowser}>
      <div className={styles.tagTools}>
        <label className={styles.tagFilter}>
          <SearchIcon size={14} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shown[0]) {
                e.preventDefault();
                onPick(shown[0].tag);
              } else if (e.key === 'Escape' && q) {
                e.stopPropagation();
                setQ('');
              }
            }}
            placeholder={`Filter ${tags.length} tags`}
            aria-label="Filter tags"
          />
        </label>
        <select className={styles.tagSort} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tags">
          {TAG_SORTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {shown.length ? (
        <div className={styles.tagCloud}>
          {visible.map((t) => (
            <TagChip key={t.tag} tag={t.tag} count={t.count} active={t.tag.toLowerCase() === active} to={hrefFor(t.tag.toLowerCase() === active ? null : t.tag)} />
          ))}
        </div>
      ) : (
        <p className={styles.tagNone}>No tags match “{q.trim()}”.</p>
      )}
      <div className={styles.tagFoot}>
        <span>{want ? `${shown.length} of ${tags.length} tags` : `${tags.length} tags`}</span>
        {!want && shown.length > limit && (
          <button type="button" className={styles.linkButton} onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            {expanded ? 'Show fewer' : `Show all ${shown.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

function Unavailable({error}) {
  return (
    <div className={styles.unavailable}>
      <h1>Notes</h1>
      {error ? (
        <p>
          The notes server isn't answering (<code>{error}</code>). Notes are served by the MCP container: start the site with{' '}
          <code>make up</code> (or <code>npm run mcp</code>) and reload this page.
        </p>
      ) : (
        <p>Notes are personal and only available when you run this site on your own machine (<code>make up</code>).</p>
      )}
      <p>
        <Link to="/guides/notes" className={styles.withIcon}>
          <HelpIcon size={16} /> How notes work
        </Link>
      </p>
    </div>
  );
}

// --- The list (left column) ----------------------------------------------------------------------

function NoteRow({note, active, to, field, snippet, selecting, checked, onToggle}) {
  const content = (
    <>
      <span className={styles.rowTitle}>
        {note.pinned && <PinIcon size={13} />}
        <Glyph icon={note.icon} size={14} />
        {note.title}
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.metaItem}>
          {field === 'created' ? <CalendarIcon size={12} /> : <ClockIcon size={12} />}
          <time dateTime={note[field]}>{shortWhen(note[field])}</time>
        </span>
        {note.template ? (
          <span className={styles.templateBadge}>
            <TemplateIcon size={12} />
            Template
          </span>
        ) : (
          note.folder && (
            <span className={styles.metaItem}>
              <FolderIcon size={12} />
              {note.folder}
            </span>
          )
        )}
        {note.tags.length > 0 && (
          <span className={`${styles.metaItem} ${styles.rowTag}`}>
            <TagIcon size={12} />
            {note.tags.slice(0, 3).join(', ')}
            {note.tags.length > 3 && ` +${note.tags.length - 3}`}
          </span>
        )}
      </span>
      {(snippet || note.excerpt) && <span className={`${styles.rowExcerpt} ${note.template ? styles.rowExcerptTemplate : ''}`}>{snippet || note.excerpt}</span>}
    </>
  );
  // Selecting (for Export): the whole row toggles its checkbox instead of opening the note
  if (selecting) {
    return (
      <li>
        <label className={`${styles.row} ${styles.rowSelectable} ${checked ? styles.rowChecked : ''}`}>
          <input type="checkbox" className={styles.check} checked={checked} onChange={(e) => onToggle([note.path], e.target.checked)} />
          <span className={styles.rowContent}>{content}</span>
        </label>
      </li>
    );
  }
  return (
    <li className={rowItemClass}>
      <Link to={to} className={`${styles.row} ${active ? styles.rowActive : ''}`} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
      <RowIconButton item={{path: note.path, name: note.title, icon: note.icon, fallback: <NoteIcon size={20} />}} />
    </li>
  );
}

// A checkbox for a whole group: checked when all its notes are, "partly" when some are
export function GroupCheck({paths, selected, onToggle, label}) {
  const count = paths.filter((p) => selected.has(p)).length;
  return (
    <input
      type="checkbox"
      className={styles.check}
      checked={count > 0 && count === paths.length}
      ref={(el) => el && (el.indeterminate = count > 0 && count < paths.length)}
      onChange={(e) => onToggle(paths, e.target.checked)}
      aria-label={`Select all in ${label}`}
    />
  );
}

// The "By date" and "By tag" lists, and search results: notes under a heading per group
function Groups({groups, url, field, snippets, selecting, selected, onToggle}) {
  if (!groups.length) return <p className={styles.empty}>No notes match.</p>;
  return groups.map(([label, notes]) => {
    return (
      <section key={label} className={styles.group}>
        <h3 className={styles.groupTitle}>
          {selecting && <GroupCheck paths={notes.map((n) => n.path)} selected={selected} onToggle={onToggle} label={label} />}
          {label} <span className={styles.groupCount}>{notes.length}</span>
        </h3>
        <ul className={styles.rows}>
          {notes.map((n) => (
            <NoteRow
              key={n.path}
              note={n}
              field={field}
              active={n.path === url.note}
              to={url.href({note: n.path, edit: null, new: null, title: null})}
              snippet={snippets?.get(n.path)}
              selecting={selecting}
              checked={selected.has(n.path)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </section>
    );
  });
}

const today = () => new Date().toISOString().slice(0, 10);

// Selecting notes and exporting them (one → .md, several → .zip)
function useExporter(list) {
  const {exportNotes} = useNotesApi();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [state, setState] = useState(null); // {busy} | {error}
  const toggle = useCallback(
    (paths, on) =>
      setSelected((s) => {
        const next = new Set(s);
        paths.forEach((p) => (on ? next.add(p) : next.delete(p)));
        return next;
      }),
    [],
  );
  // Only notes and folders that still exist (one may have been deleted in Obsidian meanwhile)
  const chosen = list.notes.filter((n) => selected.has(n.path));
  const chosenFolders = selectedFolders(list.folders, selected);
  const run = async (paths, name) => {
    setState({busy: true});
    try {
      await exportNotes(paths, name);
      setState(null);
      return true;
    } catch (err) {
      setState({error: err.message});
      return false;
    }
  };
  const exportChosen = async () => {
    const folders = new Set(chosen.map((n) => n.folder));
    const folder = folders.size === 1 ? [...folders][0] : null;
    const name = folder ? folder.split('/').pop() : `notes-${today()}`;
    if (await run(chosen.map((n) => n.path), name)) {
      setSelecting(false);
      setSelected(new Set());
    }
  };
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
    setState(null);
  };
  return {selecting, start: () => setSelecting(true), stop, selected, toggle, chosen, chosenFolders, run, exportChosen, state};
}

// --- Folder tree (the "By folder" view) ----------------------------------------------------------
// Like the docs sidebar: folders open and close. "+" adds a note or folder (at the top, or inside a
// folder), a folder can be renamed (or deleted when empty), and notes and folders (with everything in
// them) can be dragged onto a folder or onto "Top level" to move them.

// Folders and notes as a tree: {name, path, folders: [...], notes: [...], all: [every note path inside],
// dirs: [this folder and every folder inside, as selection keys (folderKey)]}.
// `folders`: every folder in the vault, so empty ones show too (left out while a filter is on).
// The selection bar's count: short, as the bar shares a narrow panel with two buttons ("3 selected",
// "2 folders", "3 + 1 folder"), with the full wording ("3 notes and 1 folder selected") as its tooltip
export function SelectionCount({items, folders, kind}) {
  const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const full = [items && part(items, kind), folders && part(folders, 'folder')].filter(Boolean).join(' and ') + ' selected';
  const short = !folders ? (
    <>
      <strong>{items}</strong> selected
    </>
  ) : !items ? (
    <strong>{part(folders, 'folder')}</strong>
  ) : (
    <>
      <strong>{items}</strong> + {part(folders, 'folder')}
    </>
  );
  return (
    <span className={styles.selectCount} title={full}>
      {short}
      <span className={styles.srOnly}> ({full})</span>
    </span>
  );
}

// A folder in a selection: its path with a trailing "/", which no note or notebook path has
export const folderKey = (path) => `${path}/`;
export const selectedFolders = (folders = [], selected) => folders.filter((f) => selected.has(folderKey(f)));

export function buildTree(notes, folders = []) {
  const root = {name: '', path: '', folders: new Map(), notes: []};
  const nodeFor = (folder) => {
    let node = root;
    for (const part of folder ? folder.split('/') : []) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, {name: part, path, folders: new Map(), notes: []});
      node = node.folders.get(part);
    }
    return node;
  };
  folders.forEach(nodeFor);
  for (const n of notes) nodeFor(n.folder).notes.push(n);
  const finish = (node) => {
    const subfolders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})).map(finish);
    const notesHere = [...node.notes].sort((a, b) => a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}));
    const all = [...subfolders.flatMap((f) => f.all), ...notesHere.map((n) => n.path)];
    const dirs = [...(node.path ? [folderKey(node.path)] : []), ...subfolders.flatMap((f) => f.dirs)];
    return {...node, folders: subfolders, notes: notesHere, all, dirs};
  };
  return finish(root);
}

const OPEN_KEY = 'notes-open-folders';
function loadOpen(key = OPEN_KEY) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
}

// Which folders are open: what you opened or closed (kept in this browser), else open while a filter
// is on. The folders holding the open note are always open, so it's never hidden.
// key: where the open folders are remembered (the Notebooks page keeps its own)
export function useOpenFolders(activeNote, filtered, key = OPEN_KEY) {
  const [state, setState] = useState(() => loadOpen(key));
  const isOpen = (path) => (activeNote?.startsWith(`${path}/`) ? true : path in state ? state[path] : filtered);
  const set = (path, open) =>
    setState((s) => {
      const next = {...s, [path]: open};
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: folders just don't stay open between visits
      }
      return next;
    });
  // A folder was renamed or moved: carry its open state, and its sub-folders', to the new path
  const move = (from, to) =>
    setState((s) => {
      const next = {...s};
      for (const [path, value] of Object.entries(s)) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        delete next[path];
        next[to + path.slice(from.length)] = value;
      }
      next[to] = true;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: folders just don't stay open between visits
      }
      return next;
    });
  return {isOpen, set, move, toggle: (path) => set(path, !isOpen(path))};
}

// A small menu under an icon button (the "+" menus). Closes on a click outside or Esc.
export function Menu({label, icon, items, className}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => (e.type === 'keydown' ? e.key === 'Escape' && setOpen(false) : !ref.current?.contains(e.target) && setOpen(false));
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span className={styles.menuWrap} ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}>
        {icon}
      </button>
      {open && (
        <span className={styles.menu} role="menu">
          {items.map(({label: text, icon: itemIcon, onClick}) => (
            <button
              key={text}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onClick();
              }}
            >
              {itemIcon}
              {text}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// Typing a folder's name (new folder, or rename): Enter saves, Esc cancels
export function FolderNameInput({initial = '', depth, onSubmit, onCancel}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim() || value.trim() === initial) return onCancel();
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className={styles.folderInputRow} style={{'--depth': depth}}>
      <FolderIcon size={15} />
      <input
        className={styles.folderInput}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => !busy && !error && submit()}
        placeholder="Folder name"
        aria-label={initial ? `New name for ${initial}` : 'New folder name'}
        disabled={busy}
        autoFocus
        onFocus={(e) => e.target.select()}
      />
      {error && (
        <span className={styles.folderInputError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const NOTE_TYPE = 'application/x-bluecore-note';
const FOLDER_TYPE = 'application/x-bluecore-note-folder';

// Drag props for a folder row, shared with the Notebooks page: drags the folder with all it holds
export function folderDragProps(node, drag, type) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(type, node.path);
      e.dataTransfer.setData('text/plain', node.name);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => drag.startFolder(node), 0); // Chrome cancels a drag whose source changes as it starts
    },
    onDragEnd: drag.end,
  };
}

// Whether what's being dragged can go into `folder`: not where it already is, and a folder not into
// itself or one of its own sub-folders
export function canDropInto(drag, folder) {
  if (!drag.dragging || drag.from === folder) return false;
  return drag.kind !== 'folder' || (folder !== drag.dragging && !folder.startsWith(`${drag.dragging}/`));
}

function TreeNote({note, depth, ctx}) {
  const {url, selecting, selected, onToggle, drag} = ctx;
  const active = note.path === url.note;
  const inner = (
    <>
      <Glyph icon={note.icon} size={15} fallback={note.pinned ? <PinIcon size={15} /> : <NoteIcon size={15} />} />
      <span className={styles.treeLabel}>{note.title}</span>
    </>
  );
  return (
    <li className={rowItemClass}>
      {selecting ? (
        <label className={`${styles.treeRow} ${selected.has(note.path) ? styles.rowChecked : ''}`} style={{'--depth': depth}}>
          <input type="checkbox" className={styles.check} checked={selected.has(note.path)} onChange={(e) => onToggle([note.path], e.target.checked)} />
          {inner}
        </label>
      ) : (
        <Link
          to={url.href({note: note.path, edit: null, new: null, title: null, in: null})}
          className={`${styles.treeRow} ${active ? styles.rowActive : ''} ${drag.dragging === note.path ? styles.dragSource : ''}`}
          style={{'--depth': depth}}
          aria-current={active ? 'page' : undefined}
          title={`${note.title} (drag onto a folder to move it)`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NOTE_TYPE, note.path);
            e.dataTransfer.setData('text/plain', note.title);
            e.dataTransfer.effectAllowed = 'move';
            // Update the page after the drag has started: Chrome cancels a drag whose source moves
            // while it starts
            setTimeout(() => drag.start(note), 0);
          }}
          onDragEnd={drag.end}
        >
          {inner}
        </Link>
      )}
      {!selecting && <RowIconButton compact item={{path: note.path, name: note.title, icon: note.icon, fallback: <NoteIcon size={20} />}} />}
    </li>
  );
}

// Drop target props for a folder row or the "Top level" strip. Hovering over a closed folder while
// dragging opens it after a moment, so you can drop deeper.
function useDropTarget(folder, ctx, onHoverOpen) {
  const {drag} = ctx;
  const timer = useRef(null);
  const canDrop = canDropInto(drag, folder);
  const leave = () => {
    clearTimeout(timer.current);
    if (drag.over === folder) drag.setOver(null);
  };
  // Both dragenter and dragover accept the note: browsers that follow the spec closely (Firefox)
  // only drop on a target whose dragenter was accepted too
  const accept = (e) => {
    if (!canDrop || !(e.dataTransfer.types.includes(NOTE_TYPE) || e.dataTransfer.types.includes(FOLDER_TYPE))) return;
    e.preventDefault();
    e.stopPropagation(); // the innermost folder takes it, not the folders around it
    e.dataTransfer.dropEffect = 'move';
    if (drag.over !== folder) {
      drag.setOver(folder);
      clearTimeout(timer.current);
      if (onHoverOpen) timer.current = setTimeout(onHoverOpen, 700);
    }
  };
  return {
    over: canDrop && drag.over === folder,
    props: {
      onDragEnter: accept,
      onDragOver: accept,
      onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && leave(),
      onDrop: (e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        const path = e.dataTransfer.getData(NOTE_TYPE) || e.dataTransfer.getData(FOLDER_TYPE);
        if (path && canDrop) drag.drop(path, folder);
      },
    },
  };
}

function TreeFolder({node, depth, ctx}) {
  const {open, selecting, selected, onToggle, onExport, busy, editing, setEditing, actions, drag} = ctx;
  const isOpen = open.isOpen(node.path);
  const drop = useDropTarget(node.path, ctx, () => open.set(node.path, true));
  const empty = !node.all.length && !node.folders.length;
  const renaming = editing?.mode === 'rename' && editing.path === node.path;
  const dragging = drag.kind === 'folder' && (drag.dragging === node.path || node.path.startsWith(`${drag.dragging}/`));
  return (
    <li>
      {renaming ? (
        <FolderNameInput initial={node.name} depth={depth} onSubmit={(name) => actions.renameFolder(node.path, name)} onCancel={() => setEditing(null)} />
      ) : (
        <div
          className={`${styles.folderRow} ${drop.over ? styles.dropOver : ''} ${dragging ? styles.dragSource : ''}`}
          style={{'--depth': depth}}
          title={selecting ? undefined : 'Drag onto another folder to move it, with everything in it'}
          {...(selecting ? {} : folderDragProps(node, drag, FOLDER_TYPE))}
          {...drop.props}
        >
          {selecting && <GroupCheck paths={[...node.all, ...node.dirs]} selected={selected} onToggle={onToggle} label={node.name} />}
          <button type="button" className={styles.folderToggle} onClick={() => open.toggle(node.path)} aria-expanded={isOpen}>
            <FolderGlyph icon={ctx.icons[node.path]} open={isOpen} />
            <span className={styles.treeLabel}>{node.name}</span>
            <span className={styles.groupCount}>{node.all.length}</span>
          </button>
          {!selecting && (
            <span className={styles.folderActions}>
              <Menu
                label={`Add to ${node.name}`}
                icon={<PlusIcon size={14} />}
                className={styles.folderAction}
                items={[
                  {label: 'New note here', icon: <NoteIcon size={14} />, onClick: () => actions.newNote(node.path)},
                  {
                    label: 'New folder inside',
                    icon: <FolderIcon size={14} />,
                    onClick: () => {
                      open.set(node.path, true);
                      setEditing({mode: 'new', parent: node.path});
                    },
                  },
                ]}
              />
              <button type="button" className={styles.folderAction} onClick={() => ctx.setPicking(node.path)} title="Set an icon" aria-label={`Set an icon for folder ${node.name}`}>
                <IconButtonGlyph size={14} />
              </button>
              <button type="button" className={styles.folderAction} onClick={() => setEditing({mode: 'rename', path: node.path})} title="Rename folder" aria-label={`Rename folder ${node.name}`}>
                <EditIcon size={14} />
              </button>
              {node.all.length > 0 && (
                <button
                  type="button"
                  className={styles.folderAction}
                  onClick={() => onExport(node.all, node.name)}
                  disabled={busy}
                  title={node.all.length === 1 ? 'Export this note (.md)' : `Export ${node.all.length} notes (.zip)${node.folders.length ? ', sub-folders included' : ''}`}
                  aria-label={`Export folder ${node.name}`}
                >
                  <DownloadIcon size={14} />
                </button>
              )}
              {empty && (
                <button type="button" className={`${styles.folderAction} ${styles.danger}`} onClick={() => actions.deleteFolder(node.path)} title="Delete this empty folder" aria-label={`Delete empty folder ${node.name}`}>
                  <TrashIcon size={14} />
                </button>
              )}
            </span>
          )}
          <button type="button" className={styles.caret} onClick={() => open.toggle(node.path)} aria-label={`${isOpen ? 'Close' : 'Open'} folder ${node.name}`} tabIndex={-1}>
            <ChevronIcon size={14} />
          </button>
        </div>
      )}
      {isOpen && <TreeItems node={node} depth={depth + 1} ctx={ctx} />}
    </li>
  );
}

// A folder's contents: a new-folder field if one is being added here, its sub-folders, then its notes (A–Z)
function TreeItems({node, depth, ctx}) {
  const {editing, setEditing, actions} = ctx;
  return (
    <ul className={styles.tree}>
      {editing?.mode === 'new' && editing.parent === node.path && (
        <li>
          <FolderNameInput depth={depth} onSubmit={(name) => actions.createFolder(node.path ? `${node.path}/${name}` : name)} onCancel={() => setEditing(null)} />
        </li>
      )}
      {node.folders.map((f) => (
        <TreeFolder key={f.path} node={f} depth={depth} ctx={ctx} />
      ))}
      {node.notes.map((n) => (
        <TreeNote key={n.path} note={n} depth={depth} ctx={ctx} />
      ))}
    </ul>
  );
}

function TopLevelDrop({ctx}) {
  const drop = useDropTarget('', ctx);
  if (!ctx.drag.dragging || ctx.drag.from === '') return null;
  return (
    <div className={`${styles.topDrop} ${drop.over ? styles.dropOver : ''}`} {...drop.props}>
      <ArrowLeftIcon size={14} /> Drop here to move to the top level
    </div>
  );
}

function FolderTree({notes, list, url, filtered, ...props}) {
  const {call} = useNotesApi();
  const tree = useMemo(() => buildTree(notes, filtered ? [] : list.folders), [notes, list.folders, filtered]);
  const open = useOpenFolders(url.note, filtered);
  const [editing, setEditing] = useState(null); // {mode: 'new', parent} | {mode: 'rename', path}
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(null); // {path, from, kind: 'note' | 'folder'}
  const [over, setOver] = useState(null);
  const [picking, setPicking] = useState(null); // the folder whose icon is being picked
  const icons = list.folderIcons ?? {};

  const done = async (text) => {
    setEditing(null);
    await list.reload();
    setMessage(text ? {text} : null);
  };
  const fail = (err) => setMessage({error: err.message});
  const actions = {
    newNote: (folder) => url.go(url.href({new: true, in: folder, note: null, edit: null, title: null})),
    createFolder: async (path) => {
      const {folder} = await call('/folder', {method: 'POST', body: {path}});
      open.set(folder, true);
      await done();
    },
    renameFolder: async (path, name) => {
      const {folder} = await call('/folder/rename', {method: 'POST', body: {path, name}});
      if (folder !== path) open.move(path, folder);
      // The open note was inside: follow it to its new path
      if (url.note?.startsWith(`${path}/`)) url.go(url.href({note: folder + url.note.slice(path.length)}), {replace: true});
      await done();
    },
    deleteFolder: (path) =>
      call('/folder/delete', {method: 'POST', body: {path}})
        .then(() => done())
        .catch(fail),
  };
  const drag = {
    dragging: dragging?.path,
    from: dragging?.from,
    kind: dragging?.kind,
    over,
    setOver,
    start: (note) => {
      setMessage(null);
      setDragging({path: note.path, from: note.folder, kind: 'note'});
    },
    startFolder: (node) => {
      setMessage(null);
      setDragging({path: node.path, from: node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '', kind: 'folder'});
    },
    end: () => {
      setDragging(null);
      setOver(null);
    },
    drop: async (path, folder) => {
      const kind = dragging?.kind;
      setDragging(null);
      setOver(null);
      try {
        if (kind === 'folder') {
          const moved = await call('/folder/move', {method: 'POST', body: {path, folder}});
          open.move(path, moved.folder);
          if (folder) open.set(folder, true);
          // The open note was inside: follow it to its new path
          if (url.note?.startsWith(`${path}/`)) url.go(url.href({note: moved.folder + url.note.slice(path.length)}), {replace: true});
          return await done(`Moved the folder “${path.split('/').pop()}” to ${folder || 'the top level'}`);
        }
        const moved = await call('/move', {method: 'POST', body: {path, folder}});
        if (url.note === path) url.go(url.href({note: moved.path}), {replace: true});
        if (folder) open.set(folder, true);
        await done(`Moved “${moved.title}” to ${folder || 'the top level'}`);
      } catch (err) {
        fail(err);
      }
    },
  };
  const ctx = {url, open, editing, setEditing, actions, drag, icons, setPicking, ...props};

  return (
    <nav aria-label="Notes by folder" className={styles.treeNav}>
      <IconPicker
        item={picking}
        current={picking ? icons[picking] : null}
        onPick={async (icon) => {
          await call('/folder/icon', {method: 'POST', body: {path: picking, icon}});
          setPicking(null);
          await list.reload();
        }}
        onClose={() => setPicking(null)}
      />
      <div className={styles.treeHead}>
        <span>Folders</span>
        {!props.selecting && (
          <Menu
            label="Add a note or folder"
            icon={<PlusIcon size={15} />}
            className={styles.folderAction}
            items={[
              {label: 'New note', icon: <NoteIcon size={14} />, onClick: () => actions.newNote('')},
              {label: 'New folder', icon: <FolderIcon size={14} />, onClick: () => setEditing({mode: 'new', parent: ''})},
            ]}
          />
        )}
      </div>
      {message && (
        <p className={message.error ? styles.treeError : styles.treeMessage} role={message.error ? 'alert' : 'status'}>
          {message.error || message.text}
          <button type="button" className={styles.tagRemove} onClick={() => setMessage(null)} aria-label="Dismiss">
            <XIcon size={12} />
          </button>
        </p>
      )}
      <TopLevelDrop ctx={ctx} />
      {!notes.length && !tree.folders.length && editing?.mode !== 'new' ? <p className={styles.empty}>No notes match.</p> : <TreeItems node={tree} depth={0} ctx={ctx} />}
    </nav>
  );
}

function useSearch(q) {
  const {call} = useNotesApi();
  const [hits, setHits] = useState(null);
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      call(`/search?q=${encodeURIComponent(q)}`)
        .then((d) => !cancelled && setHits(new Map(d.results.map((r) => [r.path, r.snippet]))))
        .catch(() => !cancelled && setHits(new Map()));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, call]);
  return hits;
}

function NoteList({list, url, onJump, onCollapse}) {
  const {call} = useNotesApi();
  const ex = useExporter(list);
  // The hover button on a note's row (RowIconButton): sets its icon, then the list (and the open note) refresh
  const saveIcon = async (item, icon) => {
    await call('/icon', {method: 'POST', body: {path: item.path, icon}});
    await list.reload();
  };
  const trash = useTrash(list.notes.length);
  const [deleting, setDeleting] = useState(null); // {notes, folders}
  const [kept, setKept] = useState(null); // folders a delete left because they weren't empty
  const [query, setQuery] = useState(url.q);
  useEffect(() => {
    setQuery(url.q);
  }, [url.q]);
  const hits = useSearch(url.q);
  const want = url.tag?.toLowerCase();
  const field = url.sort;
  const notes = useMemo(() => {
    let out = list.notes.filter(
      (n) =>
        (!want || n.tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`))) &&
        (url.folder == null || n.folder === url.folder || n.folder.startsWith(`${url.folder}/`)) &&
        (!hits || hits.has(n.path)),
    );
    if (hits) out = out.sort((a, b) => [...hits.keys()].indexOf(a.path) - [...hits.keys()].indexOf(b.path));
    else out = out.sort((a, b) => b[field].localeCompare(a[field]));
    return out;
  }, [list.notes, want, url.folder, hits, field]);

  const groups = useMemo(() => {
    if (hits) return notes.length ? [['Best matches', notes]] : [];
    // Pinned notes first, in their own group
    const pinned = notes.filter((n) => n.pinned);
    const map = new Map();
    for (const n of notes.filter((x) => !x.pinned)) map.set(dateGroup(n[field]), [...(map.get(dateGroup(n[field])) ?? []), n]);
    return [...(pinned.length ? [['Pinned', pinned]] : []), ...map.entries()];
  }, [notes, hits, url.view, field]);

  const submit = (e) => {
    e.preventDefault();
    url.go(url.href({q: query.trim() || null}), {replace: true});
  };
  const views = [
    ['date', 'By date', CalendarIcon],
    ['tags', 'By tag', TagIcon],
    ['folders', 'By folder', FolderIcon],
  ];

  return (
    <IconPickerHost save={saveIcon}>
    <aside className={styles.side} aria-label="Notes">
      <div className={styles.sideHead}>
        <Link to={url.href({}, {keep: false})} className={styles.sideTitle}>
          Notes
        </Link>
        <div className={styles.sideActions}>
          <button type="button" className={styles.collapseButton} onClick={onCollapse} title="Hide the notes list" aria-label="Hide the notes list">
            <PanelIcon size={16} />
          </button>
          <button type="button" className={styles.textAction} onClick={ex.selecting ? ex.stop : ex.start} aria-pressed={ex.selecting} title="Select notes to export or delete">
            {ex.selecting ? <XIcon size={14} /> : <SelectIcon size={14} />}
            {ex.selecting ? 'Cancel' : 'Select'}
          </button>
          <Link to={url.href({new: true, note: null, edit: null, title: null})} className={`button button--primary button--sm ${styles.withIcon}`}>
            <PlusIcon size={14} /> New note
          </Link>
        </div>
      </div>
      {ex.selecting && (
        <div className={styles.selectBar} role="region" aria-label="Export selected notes">
          {/* One checkbox for every note shown: ticks them all, or clears them when all are ticked */}
          <label className={styles.selectAll}>
            <GroupCheck paths={notes.map((n) => n.path)} selected={ex.selected} onToggle={ex.toggle} label="the list" />
            {ex.chosen.length || ex.chosenFolders.length ? <SelectionCount items={ex.chosen.length} folders={ex.chosenFolders.length} kind="note" /> : 'Select all'}
          </label>
          <button
            type="button"
            className={`${styles.iconOnly} ${styles.danger}`}
            onClick={() => setDeleting({notes: ex.chosen, folders: ex.chosenFolders})}
            disabled={!(ex.chosen.length || ex.chosenFolders.length) || ex.state?.busy}
            title="Delete selected notes and folders"
            aria-label="Delete selected notes and folders"
          >
            <TrashIcon />
          </button>
          <button type="button" className={`button button--primary button--sm ${styles.withIcon}`} onClick={ex.exportChosen} disabled={!ex.chosen.length || ex.state?.busy}>
            <DownloadIcon size={14} /> {ex.state?.busy ? 'Exporting…' : ex.chosen.length > 1 ? 'Export .zip' : ex.chosen.length ? 'Export .md' : 'Export'}
          </button>
        </div>
      )}
      <ConfirmDelete
        notes={deleting?.notes}
        folders={deleting?.folders}
        onCancel={() => setDeleting(null)}
        onDeleted={async (paths, kept) => {
          setDeleting(null);
          ex.stop();
          await list.reload();
          if (paths.includes(url.note)) url.go(url.href({note: null, edit: null}), {replace: true});
          setKept(kept?.length ? kept : null); // the latest delete's result, so an old alert doesn't linger
        }}
      />
      {kept && (
        <p className={styles.sideError} role="alert">
          {kept.length === 1 ? `Kept the folder “${kept[0].folder}”` : `Kept ${kept.length} folders`}: {kept.length === 1 ? 'it still holds' : 'they still hold'} notes or folders you didn't select.
          <button type="button" className={styles.tagRemove} onClick={() => setKept(null)} aria-label="Dismiss">
            <XIcon size={12} />
          </button>
        </p>
      )}
      {ex.state?.error && (
        <p className={styles.sideError} role="alert">
          Export failed: {ex.state.error}
        </p>
      )}
      <form className={styles.search} role="search" onSubmit={submit}>
        <SearchIcon size={15} />
        <button type="button" className={styles.jumpButton} onClick={onJump} title="Jump to a note by title" aria-label="Jump to a note">
          <kbd className={styles.kbd}>{typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} P</kbd>
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) url.go(url.href({q: null}), {replace: true});
          }}
          placeholder="Search notes (Enter)"
          aria-label="Search notes"
        />
      </form>
      <nav className={styles.views} aria-label="Organize notes">
        {views.map(([id, label, Icon]) => (
          <Link key={id} to={url.href({view: id === 'date' ? null : id})} className={`${styles.view} ${url.view === id ? styles.viewActive : ''}`} aria-current={url.view === id ? 'true' : undefined}>
            <Icon size={14} />
            {label}
          </Link>
        ))}
      </nav>
      {url.view === 'date' && !hits && (
        <div className={styles.sortRow}>
          {field === 'created' ? <CalendarIcon size={12} /> : <ClockIcon size={12} />} Sorted by{' '}
          <Link to={url.href({sort: null})} className={field === 'updated' ? styles.sortActive : undefined}>
            last change
          </Link>{' '}
          ·{' '}
          <Link to={url.href({sort: 'created'})} className={field === 'created' ? styles.sortActive : undefined}>
            created
          </Link>
        </div>
      )}
      {url.view === 'tags' && (
        <TagBrowser tags={list.tags} notes={list.notes} activeTag={url.tag} hrefFor={(tag) => url.href({tag})} onPick={(tag) => url.go(url.href({tag}), {replace: true})} limit={20} />
      )}
      {(url.tag || url.folder != null || url.q) && (
        <div className={styles.filters}>
          {url.tag && (
            <Link to={url.href({tag: null})} className={styles.filter} aria-label={`Remove filter: tag ${url.tag}`}>
              <TagIcon size={12} /> {url.tag} <XIcon size={12} />
            </Link>
          )}
          {url.folder != null && (
            <Link to={url.href({folder: null})} className={styles.filter} aria-label={`Remove filter: folder ${url.folder || 'top level'}`}>
              <FolderIcon size={12} /> {url.folder || 'Top level'} <XIcon size={12} />
            </Link>
          )}
          {url.q && (
            <Link to={url.href({q: null})} className={styles.filter} aria-label="Clear search">
              <SearchIcon size={12} /> “{url.q}” <XIcon size={12} />
            </Link>
          )}
        </div>
      )}
      <div className={styles.list}>
        {url.view === 'folders' && !hits ? (
          <FolderTree
            notes={notes}
            list={list}
            url={url}
            filtered={Boolean(url.tag || url.folder != null)}
            selecting={ex.selecting}
            selected={ex.selected}
            onToggle={ex.toggle}
            onExport={ex.run}
            busy={ex.state?.busy}
          />
        ) : (
          <Groups groups={groups} url={url} field={field} snippets={hits} selecting={ex.selecting} selected={ex.selected} onToggle={ex.toggle} />
        )}
      </div>
      <div className={styles.sideFoot}>
        <Link
          to={url.href({trash: true, note: null, edit: null, new: null, title: null})}
          className={`${styles.footLink} ${url.trash && !url.note && !url.creating ? styles.footLinkActive : ''}`}
          aria-current={url.trash && !url.note && !url.creating ? 'page' : undefined}
        >
          <TrashIcon size={14} /> Trash
          {trash.items?.length > 0 && <span className={styles.groupCount}>{trash.items.length}</span>}
        </Link>
      </div>
    </aside>
    </IconPickerHost>
  );
}

// --- One note ------------------------------------------------------------------------------------

function useNote(path, listEntry) {
  const {call} = useNotesApi();
  const [state, setState] = useState({note: null, error: null, loading: true});
  const mtime = listEntry?.mtimeMs;
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return call(`/note?path=${encodeURIComponent(path)}`)
      .then((note) => setState({note, error: null, loading: false}))
      .catch((err) => setState({note: null, error: err, loading: false}));
  }, [path, call]);
  useEffect(() => {
    setState({note: null, error: null, loading: true});
    load();
  }, [load]);
  // Reload when the file changes (Obsidian, an agent, another tab)
  useEffect(() => {
    if (mtime && state.note && mtime !== state.note.mtimeMs) load();
  }, [mtime]); // eslint-disable-line react-hooks/exhaustive-deps
  return {...state, reload: load};
}

function obsidianUrl(vault, path) {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`;
}

// Copy (the note's Markdown, front matter included, to paste anywhere) and Export (.md download),
// Delete, and a "⋯" menu with the less frequent actions
function NoteTools({note, onDelete, vault, onShowInFolders, onTogglePin, onSetIcon, onDuplicate, onSaveTemplate}) {
  const {exportNotes} = useNotesApi();
  const [copied, setCopied] = useState(null); // 'ok' | error message
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () =>
    copyText(note.raw)
      .then(() => setCopied('ok'))
      .catch((err) => setCopied(err.message));
  return (
    <>
      <button type="button" className={styles.iconButton} onClick={copy} title="Copy as Markdown" aria-label="Copy note as Markdown">
        {copied === 'ok' ? <CheckIcon /> : <CopyIcon />}
        <span className={styles.iconButtonLabel}>{copied === 'ok' ? 'Copied' : 'Copy'}</span>
      </button>
      <button type="button" className={styles.iconButton} onClick={() => exportNotes([note.path]).catch((err) => setCopied(err.message))} title="Download as a .md file" aria-label="Export note as a Markdown file">
        <DownloadIcon />
        <span className={styles.iconButtonLabel}>Export</span>
      </button>
      <button type="button" className={`${styles.iconButton} ${styles.danger}`} onClick={onDelete} title="Delete this note" aria-label="Delete note">
        <TrashIcon />
        <span className={styles.iconButtonLabel}>Delete</span>
      </button>
      {/* Less frequent actions, out of the way */}
      <Menu
        label="More actions"
        icon={<MoreIcon />}
        className={`${styles.iconButton} ${styles.moreButton}`}
        items={[
          {label: note.pinned ? 'Unpin' : 'Pin to the top of the list', icon: <PinIcon size={14} />, onClick: onTogglePin},
          {label: note.icon ? 'Change icon…' : 'Set an icon…', icon: <IconButtonGlyph size={14} />, onClick: onSetIcon},
          {label: 'Duplicate', icon: <DuplicateIcon size={14} />, onClick: onDuplicate},
          {label: 'Save as template', icon: <TemplateIcon size={14} />, onClick: onSaveTemplate},
          ...(vault
            ? [{label: 'Open in Obsidian', icon: <ObsidianIcon size={14} />, onClick: () => (window.location.href = obsidianUrl(vault, note.path))}]
            : []),
          {
            label: 'Copy [[link]] to this note',
            icon: <LinkIcon size={14} />,
            onClick: () =>
              copyText(`[[${note.title}]]`)
                .then(() => setCopied('ok'))
                .catch((err) => setCopied(err.message)),
          },
          {label: 'Show in folders', icon: <FolderIcon size={14} />, onClick: onShowInFolders},
        ]}
      />
      {copied && copied !== 'ok' && (
        <span className={styles.toolError} role="alert">
          {copied}
        </span>
      )}
      <span className={styles.srOnly} aria-live="polite">
        {copied === 'ok' ? 'Copied to the clipboard' : ''}
      </span>
    </>
  );
}

// "- [ ] task" / "1. [x] task" (also inside quotes); the checkbox is group 2
const TASK_LINE = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

function NoteView({list, url, resolve, flash}) {
  const entry = list.notes.find((n) => n.path === url.note);
  const {note, error, loading, reload} = useNote(url.note, entry);
  const {call, fileUrl} = useNotesApi();
  const [deleting, setDeleting] = useState(null);
  const [pendingBody, setPendingBody] = useState(null); // a ticked task, shown while it saves
  const [pickingIcon, setPickingIcon] = useState(false);
  const bodyRef = useRef(null);
  useEffect(() => setPendingBody(null), [note?.mtimeMs]);
  const outline = useOutline(bodyRef, [note?.raw, pendingBody]);
  if (loading) return <p className={styles.empty}>Loading…</p>;
  if (error) return <p className={styles.error}>{error.status === 404 ? 'This note no longer exists (it was renamed or deleted).' : error.message}</p>;

  const source = pendingBody ?? note.body;
  const by = writer(note.author, note.model);
  const edited = note.editedBy ? writer(note.editedBy, note.editedModel) : null;
  const tasks = source.split('\n').reduce((t, line) => {
    const m = line.match(TASK_LINE);
    return m ? {total: t.total + 1, done: t.done + (m[2] === ' ' ? 0 : 1)} : t;
  }, {total: 0, done: 0});
  // A first "# Title" line that repeats the title isn't shown twice
  let skipped = 0;
  const body = source.replace(/^\s*#\s+(.+)\n/, (line, h) => {
    if (h.trim() !== note.title) return line;
    skipped = line.split('\n').length - 1;
    return '';
  });

  // Ticking a checkbox saves the note straight away (refused if it changed elsewhere meanwhile)
  const toggleTask = async (line, checked) => {
    const lines = source.split('\n');
    const i = line - 1 + skipped;
    if (!TASK_LINE.test(lines[i] ?? '')) return;
    lines[i] = lines[i].replace(TASK_LINE, `$1${checked ? 'x' : ' '}$3`);
    const next = lines.join('\n');
    setPendingBody(next);
    try {
      await call(`/note?path=${encodeURIComponent(note.path)}`, {method: 'PUT', body: {body: next, baseMtime: note.mtimeMs}});
      await Promise.all([reload(), list.reload()]);
    } catch (err) {
      setPendingBody(null);
      await reload();
      flash(err.status === 409 ? 'This note changed somewhere else, so it was reloaded. Tick the box again.' : `Couldn't save: ${err.message}`, 'error');
    }
  };
  const setIcon = async (icon) => {
    await call('/icon', {method: 'POST', body: {path: note.path, icon}});
    setPickingIcon(false);
    await Promise.all([reload(), list.reload()]);
  };
  const togglePin = async () => {
    try {
      await call('/pin', {method: 'POST', body: {path: note.path, pinned: !note.pinned}});
      await Promise.all([reload(), list.reload()]);
    } catch (err) {
      flash(`Couldn't ${note.pinned ? 'unpin' : 'pin'}: ${err.message}`, 'error');
    }
  };
  // Both make a new note and open it in the editor, to rename or trim
  const duplicate = async () => {
    try {
      const copy = await call('/duplicate', {method: 'POST', body: {path: note.path}});
      await list.reload();
      url.go(url.href({note: copy.path, edit: true}));
      flash(`Made a copy: "${copy.title}". Change its title here to rename it.`);
    } catch (err) {
      flash(`Couldn't duplicate: ${err.message}`, 'error');
    }
  };
  const saveTemplate = async () => {
    try {
      const t = await call('/templates', {method: 'POST', body: {fromNote: note.path}});
      await list.reload();
      url.go(url.href({note: t.path, edit: true}));
      flash(`Saved as the template "${t.title}" in ${t.folder}. Trim it to the parts you'll reuse; {{title}} and {{date}} are filled in when it's used.`);
    } catch (err) {
      flash(`Couldn't save the template: ${err.message}`, 'error');
    }
  };

  return (
    <div className={styles.noteLayout}>
      <article className={styles.note}>
        <header className={styles.noteHead}>
          <div className={styles.noteTopbar}>
            <nav className={styles.crumbs} aria-label="Where this note is">
              <Link to={url.href({note: null, edit: null}, {keep: false})}>Notes</Link>
              {(note.folder ? note.folder.split('/') : []).map((part, i, parts) => (
                <React.Fragment key={i}>
                  <ChevronIcon size={12} />
                  <Link to={url.href({note: null, edit: null, view: 'folders', folder: parts.slice(0, i + 1).join('/')}, {keep: false})}>{part}</Link>
                </React.Fragment>
              ))}
              {note.template && (
                <span className={styles.templateBadge}>
                  <TemplateIcon size={12} />
                  Template
                </span>
              )}
            </nav>
            <div className={styles.noteActions}>
              <div className={styles.actionGroup}>
                <NoteTools note={note} vault={list.vault} onDelete={() => setDeleting([note])} onShowInFolders={() => url.go(url.href({view: 'folders'}))} onTogglePin={togglePin} onSetIcon={() => setPickingIcon(true)} onDuplicate={duplicate} onSaveTemplate={saveTemplate} />
              </div>
              <Link to={url.href({edit: true})} className={`button button--primary button--sm ${styles.withIcon}`}>
                <EditIcon size={14} /> Edit
              </Link>
            </div>
          </div>
          <h1 className={styles.noteTitle}>
            {note.pinned && (
              <span className={styles.pinMark} title="Pinned">
                <PinIcon size={20} />
              </span>
            )}
            {note.icon && (
              <button type="button" className={styles.titleIcon} onClick={() => setPickingIcon(true)} title="Change icon" aria-label="Change this note's icon">
                <Glyph icon={note.icon} size={30} />
              </button>
            )}
            {note.title}
          </h1>
          <IconPicker item={pickingIcon ? note.path : null} name={note.title} fallback={<NoteIcon size={20} />} current={note.icon} onPick={setIcon} onClose={() => setPickingIcon(false)} />
          <div className={styles.byline}>
            <span className={`${styles.avatar} ${by.ai ? styles.avatarAi : ''} ${by.provider ? styles.avatarLogo : ''}`} aria-hidden="true">
              {by.provider ? <ProviderIcon icon={by.provider} size={20} /> : by.ai ? <SparkleIcon size={16} /> : <UserIcon size={16} />}
            </span>
            <span className={styles.bylineText}>
              <span className={styles.bylineAuthor}>
                {by.name}
                {by.ai && (
                  <span className={styles.modelChip} title={by.modelId ? `Written by ${by.name} with ${by.modelId}` : 'The model wasn’t recorded for this note'}>
                    {by.model ?? 'model not recorded'}
                  </span>
                )}
              </span>
              <span className={styles.bylineMeta}>
                <time dateTime={note.created} title={`Created ${longWhen(note.created)}`}>
                  {new Date(note.created).toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'})}
                </time>
                {note.updated.slice(0, 16) !== note.created.slice(0, 16) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <time dateTime={note.updated} title={`Last changed ${longWhen(note.updated)}`}>
                      Updated {relWhen(note.updated)}
                    </time>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span title={`${note.words} words`}>{Math.max(1, Math.round(note.words / 220))} min read</span>
                {edited && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.editedBy} title={edited.modelId ? `Last changed by ${edited.name} with ${edited.modelId}` : undefined}>
                      {edited.provider && <ProviderIcon icon={edited.provider} size={13} />}
                      Edited by {edited.name}
                      {edited.model ? ` · ${edited.model}` : ''}
                    </span>
                  </>
                )}
              </span>
            </span>
            {tasks.total > 0 && (
              <span className={styles.taskMeter} title={`${tasks.done} of ${tasks.total} tasks done`}>
                <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
                  <circle cx="18" cy="18" r="15" className={styles.ringTrack} />
                  {tasks.done > 0 && <circle cx="18" cy="18" r="15" className={styles.ringFill} strokeDasharray={`${(tasks.done / tasks.total) * 94.25} 94.25`} />}
                </svg>
                <span>
                  <strong>
                    {tasks.done}/{tasks.total}
                  </strong>{' '}
                  tasks done
                </span>
              </span>
            )}
          </div>
          {note.tags.length > 0 && (
            <div className={styles.noteTags}>
              {note.tags.map((t) => (
                <TagChip key={t} tag={t} to={url.href({tag: t, note: null, view: 'tags'})} />
              ))}
            </div>
          )}
          {note.badFrontMatter && <p className={styles.warning}>The properties at the top of this note aren't valid YAML, so they're shown as text. Fix them in Obsidian or a text editor.</p>}
        </header>
        <div ref={bodyRef}>
          <NoteMarkdown
            body={body}
            resolve={resolve}
            noteHref={(p) => url.href({note: p, edit: null})}
            tagHref={(t) => url.href({tag: t, note: null, view: 'tags'})}
            newHref={(title) => url.href({new: true, title, note: null, edit: null})}
            fileUrl={fileUrl}
            onToggleTask={note.badFrontMatter || note.tooLarge ? undefined : toggleTask}
          />
        </div>
        <footer className={styles.noteEnd}>
          <span className={styles.notePath} title="The file in your vault">
            <NoteIcon size={13} />
            {note.path}
          </span>
          <Link to={url.href({edit: true})} className={styles.withIcon}>
            <EditIcon size={13} /> Edit this note
          </Link>
        </footer>
        <ConfirmDelete
          notes={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await list.reload();
            url.go(url.href({note: null, edit: null}), {replace: true});
          }}
        />
        {note.backlinks.length > 0 && (
          <footer className={styles.backlinks}>
            <h2 className={styles.sectionTitle}>
              <LinkIcon size={16} /> Linked from {note.backlinks.length} {note.backlinks.length === 1 ? 'note' : 'notes'}
            </h2>
            <div className={styles.cards}>
              {note.backlinks.map((b) => {
                const entry = list.notes.find((n) => n.path === b.path);
                return entry ? (
                  <NoteCard key={b.path} note={entry} to={url.href({note: b.path})} />
                ) : (
                  <Link key={b.path} to={url.href({note: b.path})} className={styles.card}>
                    <span className={styles.cardTitle}>{b.title}</span>
                  </Link>
                );
              })}
            </div>
          </footer>
        )}
      </article>
      <Outline items={outline} containerRef={bodyRef} />
    </div>
  );
}

// --- Writing -------------------------------------------------------------------------------------

export function TagInput({tags, onChange, known}) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const t = raw.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setDraft('');
  };
  const suggestions = known
    .map((k) => k.tag)
    .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()) && (!draft || t.toLowerCase().includes(draft.toLowerCase())))
    .slice(0, 8);
  return (
    <div className={styles.tagInput}>
      <div className={styles.tagInputBox}>
        {tags.map((t) => (
          <span key={t} className={styles.tag}>
            <TagIcon size={12} />
            {t}
            <button type="button" className={styles.tagRemove} onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
              <XIcon size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => (/[,\s]$/.test(e.target.value) ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={tags.length ? 'Add a tag' : 'Add tags (Enter or comma)'}
          aria-label="Tags"
        />
      </div>
      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          {suggestions.map((t) => (
            <button key={t} type="button" className={styles.suggestion} onClick={() => add(t)} aria-label={`Add tag ${t}`}>
              <PlusIcon size={11} />
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// {{title}}, {{date}}, {{time}} and {{date:YYYY-MM-DD HH:mm}} in a template, as Obsidian fills them
function fillTemplate(text, title) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const format = (f) =>
    f.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => ({YYYY: now.getFullYear(), MM: pad(now.getMonth() + 1), DD: pad(now.getDate()), HH: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds())})[t]);
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/g, (_, key, fmt) =>
    // No title yet: {{title}} stays, and saving the note fills it in
    key === 'title' ? title || '{{title}}' : format(fmt?.trim() || (key === 'date' ? 'YYYY-MM-DD' : 'HH:mm')),
  );
}

const NEW_TEMPLATE = '\u0000new'; // the "New template…" choice in the Template list

function useTemplates() {
  const {call} = useNotesApi();
  const [state, setState] = useState({templates: null, folder: 'Templates'});
  const reload = useCallback(
    () => call('/templates').then((d) => setState({templates: d.templates, folder: d.folder ?? 'Templates'}), () => setState((s) => ({...s, templates: []}))),
    [call],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return {...state, reload};
}

// The editor's layout: Write, Split (text and live preview side by side, on wide screens) or Preview.
// The choice is remembered in this browser.
const LAYOUT_KEY = 'notes-editor-layout';
function useEditorLayout() {
  const [wide, setWide] = useState(false);
  const [layout, setLayoutState] = useState(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) || 'split';
    } catch {
      return 'split';
    }
  });
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const setLayout = (next) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  };
  return {layout: layout === 'split' && !wide ? 'write' : layout, wide, setLayout};
}

const sameForm = (a, b) => a && b && a.title === b.title && a.folder === b.folder && a.body === b.body && (a.tags ?? []).join() === (b.tags ?? []).join();

function NoteEditor({list, url, resolve, flash}) {
  const {call, fileUrl, uploadImage} = useNotesApi();
  const existing = url.editing && url.note ? url.note : null;
  const loaded = useNote(existing, null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);
  const [draft, setDraft] = useState(null); // an unsaved draft found for this note, offered back
  const [uploading, setUploading] = useState(0);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const {layout, wide, setLayout} = useEditorLayout();
  const {templates, folder: templateFolder, reload: reloadTemplates} = useTemplates();
  // A new note becomes a template by saving it in the templates folder; from an existing note, start a blank one
  // A template applied before the note had a title left {{title}}; a new note gets its title there
  // (a new template keeps the placeholder)
  const fillTitle = (f) =>
    f.folder.trim() === templateFolder || f.folder.trim().startsWith(`${templateFolder}/`) || !f.title.trim() ? f.body : f.body.replace(/\{\{\s*title\s*\}\}/g, f.title.trim());
  const newTemplate = () =>
    existing ? url.go(url.href({new: true, in: templateFolder, note: null, edit: null, title: null})) : setForm((f) => ({...f, folder: templateFolder}));
  const preview = useDeferredValue(form?.body ?? '');

  // Start from the note (editing) or from the link that asked for a new note, then look for a draft
  useEffect(() => {
    let start = null;
    if (existing && loaded.note) start = {title: loaded.note.title, folder: loaded.note.folder, tags: loaded.note.propertyTags, body: loaded.note.body, baseMtime: loaded.note.mtimeMs};
    if (!existing) {
      // ?in=<folder>: "New note here" in the tree; ?link=&linkTitle=: "Note about this page" on a docs page
      const link = url.params.get('link');
      start = {
        title: url.params.get('title') ?? '',
        folder: url.params.get('in') ?? url.folder ?? '',
        tags: url.tag ? [url.tag] : [],
        body: link ? `About [${url.params.get('linkTitle') || link}](${link})\n\n` : '',
        baseMtime: null,
      };
    }
    if (!start) return;
    setForm(start);
    // ?template=<path>: "Use" on a template in the overview
    const template = !existing && url.params.get('template');
    if (template) {
      call(`/note?path=${encodeURIComponent(template)}`)
        .then((t) =>
          setForm((f) => ({
            ...f,
            body: fillTemplate(t.body.replace(/^\n+/, ''), f.title.trim()),
            tags: [...f.tags, ...t.propertyTags.filter((x) => !f.tags.some((y) => y.toLowerCase() === x.toLowerCase()))],
          })),
        )
        .catch(setProblem);
    }
    const saved = readDraft(existing);
    if (saved && !sameForm(saved, start)) setDraft(saved);
    else if (saved) clearDraft(existing);
  }, [existing, loaded.note]); // eslint-disable-line react-hooks/exhaustive-deps

  const original = existing ? loaded.note : null;
  const dirty = Boolean(
    form &&
      (existing
        ? original &&
          (form.body !== original.body || form.tags.join() !== original.propertyTags.join() || form.folder.trim() !== original.folder || form.title.trim() !== original.title)
        : form.title || form.body.trim() || form.tags.length),
  );
  // Keep a draft while there are changes (not while a found draft is still waiting for an answer)
  const draftSavedAt = useDraftAutosave(existing, form, dirty, !draft);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async ({force} = {}) => {
    if (!form || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      let note = existing
        ? await call(`/note?path=${encodeURIComponent(existing)}`, {method: 'PUT', body: {body: form.body, tags: form.tags, folder: form.folder.trim(), baseMtime: force ? null : form.baseMtime}})
        : await call('/note', {method: 'POST', body: {title: form.title.trim(), folder: form.folder.trim(), tags: form.tags, body: fillTitle(form)}});
      // A new title renames the file and updates the [[links]] that point to it
      if (existing && form.title.trim() && form.title.trim() !== original.title) {
        const renamed = await call('/rename', {method: 'POST', body: {path: note.path, title: form.title.trim()}});
        note = renamed.note;
        if (renamed.linksUpdated) flash(`Renamed, and updated ${renamed.linksUpdated} ${renamed.linksUpdated === 1 ? 'link' : 'links'} in ${renamed.notesUpdated} ${renamed.notesUpdated === 1 ? 'note' : 'notes'}.`);
      }
      clearDraft(existing);
      await list.reload();
      url.go(url.href({note: note.path, edit: null, new: null, title: null, in: null, link: null, linkTitle: null, template: null}), {replace: !existing});
    } catch (err) {
      setProblem(err);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Pasted, dropped or chosen images: saved in the vault, embedded at the cursor
  const addImages = async (files) => {
    const images = [...files].filter((f) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type));
    if (!images.length) return false;
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        const {name} = await uploadImage(file);
        if (bodyRef.current) insertAtCursor(bodyRef.current, `![[${name}]]\n`);
      } catch (err) {
        setProblem(new Error(`Couldn't add the image: ${err.message}`));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    return true;
  };

  const applyTemplate = async (path) => {
    if (!path) return;
    if (path === NEW_TEMPLATE) return newTemplate();
    try {
      const t = await call(`/note?path=${encodeURIComponent(path)}`);
      const text = fillTemplate(t.body.replace(/^\n+/, ''), form.title.trim());
      setForm((f) => ({
        ...f,
        body: f.body.trim() ? `${f.body.replace(/\s*$/, '')}\n\n${text}` : text, // text already there stays, the template goes below
        tags: [...f.tags, ...t.propertyTags.filter((x) => !f.tags.some((y) => y.toLowerCase() === x.toLowerCase()))],
      }));
    } catch (err) {
      setProblem(err);
    }
  };

  if (existing && loaded.error) return <p className={styles.error}>{loaded.error.message}</p>;
  if (!form) return <p className={styles.empty}>Loading…</p>;
  const folders = [...new Set([...list.folders, ...list.notes.map((n) => n.folder).filter(Boolean)])].sort();
  const cancelTo = existing ? url.href({edit: null}) : url.href({new: null, title: null, in: null, link: null, linkTitle: null, template: null});
  const layouts = [
    ['write', 'Write', EditIcon],
    ...(wide ? [['split', 'Split', LayoutIcon]] : []),
    ['preview', 'Preview', EyeIcon],
  ];
  const previewPane = (
    <div className={styles.preview}>
      {preview.trim() ? (
        <NoteMarkdown body={preview} resolve={resolve} noteHref={(p) => url.href({note: p, edit: null, new: null})} tagHref={(t) => url.href({tag: t})} newHref={(title) => url.href({new: true, title})} fileUrl={fileUrl} />
      ) : (
        <p className={styles.empty}>Nothing to preview yet.</p>
      )}
    </div>
  );

  return (
    <form
      className={`${styles.editor} ${layout === 'split' ? styles.editorWide : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={styles.editorHead}>
        <div className={styles.editorStatus}>
          <span className={styles.eyebrow}>{existing ? 'Editing' : 'New note'}</span>
          <span className={`${styles.saveState} ${dirty ? styles.saveStateDirty : ''}`} aria-live="polite">
            <span className={styles.saveDot} aria-hidden="true" />
            {saving ? 'Saving…' : dirty ? (draftSavedAt ? `Unsaved · draft kept ${shortWhen(draftSavedAt)}` : 'Unsaved changes') : existing ? 'No changes' : 'Not saved yet'}
          </span>
        </div>
        <div className={styles.noteActions}>
          <Link to={cancelTo} className={styles.iconButton} onClick={() => clearDraft(existing)}>
            <XIcon />
            Cancel
          </Link>
          <button type="submit" className={`button button--primary button--sm ${styles.withIcon}`} disabled={saving || (existing && !dirty)}>
            <CheckIcon size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {draft && (
        <div className={styles.draftBanner} role="status">
          <span>
            <ClockIcon size={15} /> You have unsaved changes to {existing ? 'this note' : 'a new note'} from {longWhen(draft.savedAt)}.
          </span>
          <span className={styles.draftActions}>
            <button
              type="button"
              className={`button button--primary button--sm ${styles.withIcon}`}
              onClick={() => {
                setForm((f) => ({...f, title: draft.title, folder: draft.folder, tags: draft.tags, body: draft.body, baseMtime: existing ? draft.baseMtime : null}));
                setDraft(null);
              }}
            >
              <ArrowLeftIcon size={14} /> Restore them
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => {
                clearDraft(existing);
                setDraft(null);
              }}
            >
              <XIcon /> Discard
            </button>
          </span>
        </div>
      )}

      {problem && (
        <div className={styles.error} role="alert">
          {problem.status === 409 ? (
            <>
              This note was changed somewhere else (in Obsidian or by an agent) after you opened it.{' '}
              <button type="button" className={styles.linkButton} onClick={() => save({force: true})}>
                Save mine anyway
              </button>{' '}
              (replaces their changes) or{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  clearDraft(existing);
                  window.location.reload();
                }}
              >
                discard mine and reload
              </button>
              .
            </>
          ) : (
            problem.message
          )}
        </div>
      )}

      {/* The title is the page's heading: type straight into it */}
      <h1 className={styles.srOnly}>{existing ? `Editing ${original?.title ?? ''}` : 'New note'}</h1>
      <input
        className={styles.titleInput}
        value={form.title}
        onChange={(e) => setForm({...form, title: e.target.value})}
        placeholder="Untitled"
        aria-label="Title (becomes the file name, as in Obsidian)"
        autoFocus={!existing}
        aria-describedby={existing && form.title.trim() !== original?.title ? 'rename-hint' : undefined}
      />
      {existing && form.title.trim() !== original?.title && (
        <p id="rename-hint" className={styles.renameHint}>
          Saving renames the file and updates [[links]] to it in other notes.
        </p>
      )}

      {/* Properties, as in Obsidian: a label and a quiet value that becomes a field on hover/focus */}
      <div className={styles.props}>
        <label className={styles.prop}>
          <span className={styles.propLabel}>
            <FolderIcon size={14} /> Folder
          </span>
          <input className={styles.propInput} value={form.folder} onChange={(e) => setForm({...form, folder: e.target.value})} placeholder="Top level" list="note-folders" />
          <datalist id="note-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className={styles.prop}>
          <span className={styles.propLabel}>
            <TagIcon size={14} /> Tags
          </span>
          <TagInput tags={form.tags} onChange={(tags) => setForm({...form, tags})} known={list.tags} />
        </div>
        <label className={styles.prop}>
          <span className={styles.propLabel}>
            <TemplateIcon size={14} /> Template
          </span>
          {templates?.length ? (
            <select className={`${styles.propInput} ${styles.propSelect}`} value="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">{form.body.trim() ? 'Add a template below…' : 'Start from a template…'}</option>
              {templates.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.title}
                </option>
              ))}
              <option value={NEW_TEMPLATE}>＋ New template…</option>
            </select>
          ) : (
            <span className={styles.templateButtons}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() =>
                  call('/templates/starter', {method: 'POST'})
                    .then(() => Promise.all([reloadTemplates(), list.reload()]))
                    .catch(setProblem)
                }
                disabled={templates == null}
                title="Adds Meeting notes, How-to and Decision record to a Templates folder, which you can edit like any note"
              >
                <PlusIcon /> Add starter templates
              </button>
              <button type="button" className={styles.iconButton} onClick={newTemplate} disabled={templates == null} title={`A blank note in the ${templateFolder} folder`}>
                <TemplateIcon size={14} /> New template
              </button>
            </span>
          )}
        </label>
      </div>

      <div className={styles.field}>
        <div className={styles.tabs} role="tablist" aria-label="Editor layout">
          {layouts.map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={layout === id} className={`${styles.tabButton} ${layout === id ? styles.tabActive : ''}`} onClick={() => setLayout(id)}>
              <Icon size={13} />
              {label}
            </button>
          ))}
          <span className={styles.hint}>
            {uploading ? 'Adding image…' : 'Markdown · type [[ to link a note · paste or drop images · ⌘/Ctrl+S saves'}
          </span>
        </div>
        <div className={layout === 'split' ? styles.split : undefined}>
          {layout !== 'preview' && (
            <div className={styles.writePane}>
              <MarkdownToolbar textareaRef={bodyRef} notes={list.notes.filter((n) => n.path !== existing)} onPickImage={() => fileRef.current?.click()} />
              <textarea
                ref={bodyRef}
                className={styles.textarea}
                value={form.body}
                onChange={(e) => setForm({...form, body: e.target.value})}
                onPaste={(e) => {
                  if ([...e.clipboardData.files].some((f) => f.type.startsWith('image/'))) {
                    e.preventDefault();
                    addImages(e.clipboardData.files);
                  }
                }}
                onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
                onDrop={(e) => {
                  if (e.dataTransfer.files.length) {
                    e.preventDefault();
                    addImages(e.dataTransfer.files);
                  }
                }}
                placeholder="Write in Markdown…"
                aria-label="Note text"
                autoFocus={Boolean(existing)}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          )}
          {layout !== 'write' && previewPane}
        </div>
      </div>
      <p className={`${styles.hint} ${styles.editorFooter}`}>
        <span>
          {(form.body.match(/\S+/g) ?? []).length} words · {form.body.length.toLocaleString()} characters
        </span>
        <span>
          Saved as a Markdown file in your vault{list.vault ? ` (“${list.vault}”)` : ''}. While you type, a draft is kept in this browser until you save.
        </span>
      </p>
    </form>
  );
}

// --- Nothing selected: an overview ---------------------------------------------------------------

// A note as a card: title, where and when, the start of its text and its tags
function NoteCard({note, to}) {
  const ai = writer(note.author, note.model);
  return (
    <Link to={to} className={styles.card}>
      <span className={styles.cardTitle}>
        {note.pinned && <PinIcon size={14} />}
        <Glyph icon={note.icon} size={15} />
        {note.title}
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.metaItem}>
          <ClockIcon size={12} />
          <time dateTime={note.updated}>{shortWhen(note.updated)}</time>
        </span>
        {note.folder && (
          <span className={styles.metaItem}>
            <FolderIcon size={12} />
            {note.folder}
          </span>
        )}
        {ai.ai && (
          <span className={styles.metaItem} title={ai.modelId ? `Written by ${ai.name} with ${ai.modelId}` : `Written by ${ai.name}`}>
            {ai.provider ? <ProviderIcon icon={ai.provider} size={12} /> : <SparkleIcon size={12} />}
            {ai.model ?? ai.name}
          </span>
        )}
      </span>
      {note.excerpt && <span className={styles.cardExcerpt}>{note.excerpt}</span>}
      {note.tags.length > 0 && (
        <span className={styles.cardTags}>
          {note.tags.slice(0, 3).map((t) => (
            <span key={t} className={styles.cardTag}>
              #{t}
            </span>
          ))}
          {note.tags.length > 3 && <span className={styles.cardTag}>+{note.tags.length - 3}</span>}
        </span>
      )}
    </Link>
  );
}

const WAYS = [
  [EditIcon, 'Here', <><em>New note</em>, or open a note and choose <em>Edit</em>. Start from a template, paste images, link notes with <code>[[</code>.</>],
  [SparkleIcon, 'Ask the docs', <>Ask it to save something, or use <em>Save as note</em> under an answer.</>],
  [PlugIcon, 'Any AI agent', <>Connected to the MCP server (<code>localhost:3001/mcp</code>), with tools like <code>create_note</code>.</>],
  [BookIcon, 'From a docs page', <><em>Note about this page</em> at the bottom of any page. Linked notes are listed there.</>],
];

function Overview({list, url}) {
  const {templates, folder: templateFolder} = useTemplates();
  const notes = list.notes.filter((n) => !n.template);
  const week = notes.filter((n) => Date.now() - new Date(n.updated).getTime() < 7 * DAY).length;
  const ai = notes.filter((n) => n.author && n.author !== 'you').length;
  const pinned = notes.filter((n) => n.pinned);
  const recent = notes.filter((n) => !n.pinned).slice(0, pinned.length ? 4 : 6);
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const noteTo = (n) => url.href({note: n.path, edit: null, new: null, title: null});
  return (
    <div className={styles.overview}>
      <PageHero
        eyebrow="Workspace · Notes"
        title="Your notes"
        lead={
          <>
            Markdown files in your vault{list.vault ? <> “{list.vault}”</> : null}, also open in Obsidian. Press <kbd className={styles.kbd}>{mac ? '⌘' : 'Ctrl'}</kbd>{' '}
            <kbd className={styles.kbd}>P</kbd> to jump to one.
          </>
        }
        actions={[
          {label: 'New note', to: url.href({new: true}), icon: <PlusIcon size={16} />, primary: true},
          {label: 'How notes work', to: '/guides/notes', icon: <HelpIcon size={16} />},
        ]}
        stats={[
          {icon: <NoteIcon size={18} />, value: notes.length, label: notes.length === 1 ? 'note' : 'notes'},
          {icon: <ClockIcon size={18} />, value: week, label: 'changed this week'},
          {icon: <TagIcon size={18} />, value: list.tags.length, label: list.tags.length === 1 ? 'tag' : 'tags', to: url.href({view: 'tags'})},
          {icon: <SparkleIcon size={18} />, value: ai, label: 'written by AI'},
        ]}
      />

      {pinned.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>
            <PinIcon size={18} /> Pinned
          </h2>
          <div className={styles.cards}>
            {pinned.map((n) => (
              <NoteCard key={n.path} note={n} to={noteTo(n)} />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>
            <ClockIcon size={18} /> Recently changed
          </h2>
          <div className={styles.cards}>
            {recent.map((n) => (
              <NoteCard key={n.path} note={n} to={noteTo(n)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className={styles.sectionTitle}>
          <TemplateIcon size={18} /> Templates
          <Link to={url.href({new: true, in: templateFolder})} className={styles.sectionLink}>
            <PlusIcon size={14} /> New template
          </Link>
        </h2>
        {templates?.length ? (
          <ul className={styles.templateList}>
            {templates.map((t) => (
              <li key={t.path} className={styles.templateItem}>
                <Link to={url.href({note: t.path, edit: null, new: null})} className={styles.templateName} title="Open the template to see or edit it">
                  <TemplateIcon size={15} />
                  {t.title}
                </Link>
                <Link to={url.href({new: true, template: t.path, note: null, edit: null, title: null})} className={`button button--sm button--secondary ${styles.withIcon}`}>
                  <PlusIcon size={13} /> Use
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            {templates == null ? 'Loading…' : <>No templates yet. Make one with <em>⋯ → Save as template</em> on any note, or <em>Add starter templates</em> in the editor.</>}
          </p>
        )}
      </section>

      {list.tags.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>
            <TagIcon size={18} /> Tags
          </h2>
          <TagBrowser tags={list.tags} notes={list.notes} hrefFor={(tag) => url.href({tag, view: 'tags'})} onPick={(tag) => url.go(url.href({tag, view: 'tags'}))} limit={30} />
        </section>
      )}

      <section>
        <h2 className={styles.sectionTitle}>
          <PlusIcon size={18} /> Ways to add notes
        </h2>
        <div className={styles.ways}>
          {WAYS.map(([Icon, title, text]) => (
            <div key={title} className={styles.way}>
              <span className={styles.wayIcon}>
                <Icon size={18} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <div className={styles.way}>
            <span className={styles.wayIcon}>
              <ObsidianIcon size={18} />
            </span>
            <div>
              <strong>Obsidian</strong>
              <p>Open the folder as a vault{list.vault ? <> (“{list.vault}”)</> : null}. Changes show up here within seconds.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Page ----------------------------------------------------------------------------------------

// A message at the top of the page for a few seconds (renamed, restored, couldn't save…)
function useFlash() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(null), message.kind === 'error' ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [message]);
  const flash = useCallback((text, kind = 'info') => setMessage({text, kind, at: Date.now()}), []);
  return {message, flash, clear: () => setMessage(null)};
}

// The notes list hidden (a narrow strip instead), remembered in this browser. Wide screens only:
// on phones the list and the note already take turns.
const COLLAPSED_KEY = 'notes-panel-collapsed';
function useCollapsedPanel() {
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 997px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const setCollapsed = (next) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // storage blocked: just not remembered
    }
  };
  return {collapsed: collapsed && wide, setCollapsed};
}

// What's left of the notes list while it's hidden: show it again, jump to a note, new note, trash
function Rail({url, onExpand, onJump}) {
  return (
    <nav className={styles.rail} aria-label="Notes (list hidden)">
      <button type="button" className={styles.railButton} onClick={onExpand} title="Show the notes list" aria-label="Show the notes list">
        <PanelIcon size={18} />
      </button>
      <button type="button" className={styles.railButton} onClick={onJump} title="Jump to a note (⌘P)" aria-label="Jump to a note">
        <SearchIcon size={18} />
      </button>
      <Link to={url.href({new: true, note: null, edit: null, title: null})} className={styles.railButton} title="New note" aria-label="New note">
        <PlusIcon size={18} />
      </Link>
      <Link
        to={url.href({trash: true, note: null, edit: null, new: null, title: null})}
        className={`${styles.railButton} ${styles.railBottom} ${url.trash && !url.note && !url.creating ? styles.railActive : ''}`}
        title="Trash"
        aria-label="Trash"
      >
        <TrashIcon size={18} />
      </Link>
    </nav>
  );
}

export default function Notes() {
  const url = useNotesUrl();
  const panel = useCollapsedPanel();
  const list = useNoteList();
  const resolve = useMemo(() => makeResolver(list.notes), [list.notes]);
  const {message, flash, clear} = useFlash();
  const [switcher, setSwitcher] = useState(false);

  // ⌘P / Ctrl+P: the quick switcher (instead of the browser's Print, on this page only)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setSwitcher(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (list.status === 'disabled' || list.status === 'error') return <Unavailable error={list.status === 'error' ? list.error : null} />;
  if (list.status === 'loading') return <p className={styles.empty}>Loading notes…</p>;

  const selected = url.creating || url.note || url.trash;
  return (
    <div className={`${styles.layout} ${selected ? styles.hasSelection : ''} ${panel.collapsed ? styles.collapsed : ''}`}>
      {panel.collapsed ? (
        <Rail url={url} onExpand={() => panel.setCollapsed(false)} onJump={() => setSwitcher(true)} />
      ) : (
        <NoteList list={list} url={url} onJump={() => setSwitcher(true)} onCollapse={() => panel.setCollapsed(true)} />
      )}
      <main className={styles.main}>
        {selected && (
          <Link to={url.href({note: null, edit: null, new: null, title: null, trash: null})} className={styles.back}>
            <ArrowLeftIcon size={14} /> All notes
          </Link>
        )}
        {message && (
          <p className={message.kind === 'error' ? styles.flashError : styles.flash} role={message.kind === 'error' ? 'alert' : 'status'}>
            <span>{message.text}</span>
            <button type="button" className={styles.tagRemove} onClick={clear} aria-label="Dismiss">
              <XIcon size={14} />
            </button>
          </p>
        )}
        {url.creating || url.editing ? (
          <NoteEditor key={`${url.note}:${url.creating}`} list={list} url={url} resolve={resolve} flash={flash} />
        ) : url.note ? (
          <NoteView list={list} url={url} resolve={resolve} flash={flash} />
        ) : url.trash ? (
          <Trash url={url} list={list} flash={flash} />
        ) : (
          <Overview list={list} url={url} />
        )}
      </main>
      <QuickSwitcher
        open={switcher}
        notes={list.notes}
        onClose={() => setSwitcher(false)}
        onOpen={(path) => {
          setSwitcher(false);
          url.go(url.href({note: path, edit: null, new: null, title: null, trash: null}));
        }}
        onCreate={(title) => {
          setSwitcher(false);
          url.go(url.href({new: true, title, note: null, edit: null, trash: null}));
        }}
      />
    </div>
  );
}
