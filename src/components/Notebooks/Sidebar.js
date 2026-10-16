// The Notebooks page's left panel, made to look and work like the Notes list (it reuses the Notes
// page's styles and pieces): search, views by date / tag / folder, a folder tree with drag-and-drop,
// tag filters, select-to-export or delete, and the trash. The URL holds the state, as on Notes:
//   ?nb=<path>  a notebook      ?new[&in=<folder>]  a new one      ?trash
//   ?view=date|tags|folders, ?tag=, ?folder=, ?q=, ?sort=created
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Link from '@docusaurus/Link';
import {useHistory, useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {FolderGlyph, Glyph, IconButtonGlyph, IconPicker, IconPickerHost, RowIconButton, rowItemClass} from '../FolderIcons';
import {buildTree, canDropInto, dateGroup, folderDragProps, FolderNameInput, GroupCheck, Menu, SelectionCount, selectedFolders, shortWhen, TagBrowser, useOpenFolders} from '../Notes';
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  ChevronIcon,
  NotebookIcon,
  PanelIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SelectIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from '../Notes/icons';
import ns from '../Notes/styles.module.css';
import styles from './styles.module.css';

// --- URL state -------------------------------------------------------------------------------------

export function useNotebooksUrl() {
  const location = useLocation();
  const history = useHistory();
  const base = useBaseUrl('/notebooks');
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const href = useCallback(
    (changes, {keep = true} = {}) => {
      const next = new URLSearchParams(keep ? params : undefined);
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === false) next.delete(k);
        else next.set(k, v === true ? '' : v);
      }
      if ((changes.nb || changes.new) && !('trash' in changes)) next.delete('trash');
      const q = next.toString().replace(/=(&|$)/g, '$1');
      return `/notebooks${q ? `?${q}` : ''}`;
    },
    [params],
  );
  const go = useCallback((to, {replace} = {}) => history[replace ? 'replace' : 'push'](base + to.slice('/notebooks'.length)), [history, base]);
  return {
    href,
    go,
    nb: params.get('nb'),
    creating: params.has('new'),
    in: params.get('in') ?? '',
    starter: params.get('starter') ?? '', // ?new&starter=<name>: the new-notebook form with that starter picked
    view: params.get('view') || 'date',
    tag: params.get('tag'),
    folder: params.get('folder'),
    q: params.get('q') || '',
    sort: params.get('sort') === 'created' ? 'created' : 'updated',
    trash: params.has('trash'),
  };
}
const openHref = (url, path) => url.href({nb: path, new: null, in: null, trash: null});

// --- Downloads ---------------------------------------------------------------------------------------

async function download(res, fallbackName) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const name = decodeURIComponent((res.headers.get('content-disposition') ?? '').match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? fallbackName);
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), {href, download: name});
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// One notebook → its .ipynb; several → a .zip (keeping their folders)
export function useExport(base) {
  return useCallback(
    async (paths, name = 'notebooks') => {
      if (paths.length === 1) return download(await fetch(`${base}/notebooks/export?path=${encodeURIComponent(paths[0])}`), paths[0].split('/').pop());
      return download(
        await fetch(`${base}/notebooks/export`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({paths, name})}),
        `${name}.zip`,
      );
    },
    [base],
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function useSelection(list, exportPaths) {
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
  const chosen = list.notebooks.filter((n) => selected.has(n.path));
  const chosenFolders = selectedFolders(list.folders, selected);
  const run = async (paths, name) => {
    setState({busy: true});
    try {
      await exportPaths(paths, name);
      setState(null);
      return true;
    } catch (err) {
      setState({error: err.message});
      return false;
    }
  };
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
    setState(null);
  };
  const exportChosen = async () => {
    const folders = new Set(chosen.map((n) => n.folder));
    const folder = folders.size === 1 ? [...folders][0] : null;
    if (await run(chosen.map((n) => n.path), folder ? folder.split('/').pop() : `notebooks-${today()}`)) stop();
  };
  return {selecting, start: () => setSelecting(true), stop, selected, toggle, chosen, chosenFolders, run, exportChosen, state};
}

function useSearch(q, call) {
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

// --- Rows --------------------------------------------------------------------------------------------

function NotebookRow({nb, active, to, field, snippet, selecting, checked, onToggle}) {
  const content = (
    <>
      <span className={ns.rowTitle}>
        {nb.pinned && <PinIcon size={13} />}
        <Glyph icon={nb.icon} size={14} />
        {nb.errors > 0 && <span className={styles.errDot} title={`${nb.errors} cell(s) failed on the last run`} />}
        {nb.title}
        {nb.target !== 'local' && <span className={styles.envBadge}>{nb.target}</span>}
      </span>
      <span className={ns.rowMeta}>
        <span className={ns.metaItem}>
          {field === 'created' ? <CalendarIcon size={12} /> : <ClockIcon size={12} />}
          <time dateTime={nb[field]}>{shortWhen(nb[field])}</time>
        </span>
        {nb.folder && (
          <span className={ns.metaItem}>
            <FolderIcon size={12} />
            {nb.folder}
          </span>
        )}
        {nb.tags.length > 0 && (
          <span className={`${ns.metaItem} ${ns.rowTag}`}>
            <TagIcon size={12} />
            {nb.tags.slice(0, 3).join(', ')}
            {nb.tags.length > 3 && ` +${nb.tags.length - 3}`}
          </span>
        )}
      </span>
      {(snippet || nb.excerpt) && <span className={ns.rowExcerpt}>{snippet || nb.excerpt}</span>}
    </>
  );
  if (selecting)
    return (
      <li>
        <label className={`${ns.row} ${ns.rowSelectable} ${checked ? ns.rowChecked : ''}`}>
          <input type="checkbox" className={ns.check} checked={checked} onChange={(e) => onToggle([nb.path], e.target.checked)} />
          <span className={ns.rowContent}>{content}</span>
        </label>
      </li>
    );
  return (
    <li className={rowItemClass}>
      <Link to={to} className={`${ns.row} ${active ? ns.rowActive : ''}`} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
      <RowIconButton item={{path: nb.path, name: nb.title, icon: nb.icon, fallback: <NotebookIcon size={20} />}} />
    </li>
  );
}

function Groups({groups, url, field, snippets, selecting, selected, onToggle}) {
  if (!groups.length) return <p className={ns.empty}>No notebooks match.</p>;
  return groups.map(([label, nbs]) => (
    <section key={label} className={ns.group}>
      <h3 className={ns.groupTitle}>
        {selecting && <GroupCheck paths={nbs.map((n) => n.path)} selected={selected} onToggle={onToggle} label={label} />}
        {label} <span className={ns.groupCount}>{nbs.length}</span>
      </h3>
      <ul className={ns.rows}>
        {nbs.map((n) => (
          <NotebookRow
            key={n.path}
            nb={n}
            field={field}
            active={n.path === url.nb}
            to={openHref(url, n.path)}
            snippet={snippets?.get(n.path)}
            selecting={selecting}
            checked={selected.has(n.path)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </section>
  ));
}

// --- Folder tree (the "By folder" view): as on Notes, drag notebooks and folders onto folders to move them

const NB_TYPE = 'application/x-bluecore-notebook';
const FOLDER_TYPE = 'application/x-bluecore-notebook-folder';

function TreeNotebook({nb, depth, ctx}) {
  const {url, selecting, selected, onToggle, drag} = ctx;
  const active = nb.path === url.nb;
  const inner = (
    <>
      <Glyph icon={nb.icon} size={15} fallback={nb.pinned ? <PinIcon size={15} /> : <NotebookIcon size={15} />} />
      <span className={ns.treeLabel}>{nb.title}</span>
      {nb.errors > 0 && <span className={styles.errDot} title={`${nb.errors} cell(s) failed`} />}
    </>
  );
  return (
    <li className={rowItemClass}>
      {selecting ? (
        <label className={`${ns.treeRow} ${selected.has(nb.path) ? ns.rowChecked : ''}`} style={{'--depth': depth}}>
          <input type="checkbox" className={ns.check} checked={selected.has(nb.path)} onChange={(e) => onToggle([nb.path], e.target.checked)} />
          {inner}
        </label>
      ) : (
        <Link
          to={openHref(url, nb.path)}
          className={`${ns.treeRow} ${active ? ns.rowActive : ''} ${drag.dragging === nb.path ? ns.dragSource : ''}`}
          style={{'--depth': depth}}
          aria-current={active ? 'page' : undefined}
          title={`${nb.title} (drag onto a folder to move it)`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NB_TYPE, nb.path);
            e.dataTransfer.setData('text/plain', nb.title);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => drag.start(nb), 0); // Chrome cancels a drag whose source changes as it starts
          }}
          onDragEnd={drag.end}>
          {inner}
        </Link>
      )}
      {!selecting && <RowIconButton compact item={{path: nb.path, name: nb.title, icon: nb.icon, fallback: <NotebookIcon size={20} />}} />}
    </li>
  );
}

function useDropTarget(folder, ctx, onHoverOpen) {
  const {drag} = ctx;
  const timer = useRef(null);
  const canDrop = canDropInto(drag, folder);
  const accept = (e) => {
    if (!canDrop || !(e.dataTransfer.types.includes(NB_TYPE) || e.dataTransfer.types.includes(FOLDER_TYPE))) return;
    e.preventDefault();
    e.stopPropagation();
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
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        clearTimeout(timer.current);
        if (drag.over === folder) drag.setOver(null);
      },
      onDrop: (e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        const path = e.dataTransfer.getData(NB_TYPE) || e.dataTransfer.getData(FOLDER_TYPE);
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
  const dragging = drag.kind === 'folder' && (drag.dragging === node.path || node.path.startsWith(`${drag.dragging}/`));
  if (editing?.mode === 'rename' && editing.path === node.path)
    return (
      <li>
        <FolderNameInput initial={node.name} depth={depth} onSubmit={(name) => actions.renameFolder(node.path, name)} onCancel={() => setEditing(null)} />
      </li>
    );
  return (
    <li>
      <div
        className={`${ns.folderRow} ${drop.over ? ns.dropOver : ''} ${dragging ? ns.dragSource : ''}`}
        style={{'--depth': depth}}
        title={selecting ? undefined : 'Drag onto another folder to move it, with everything in it'}
        {...(selecting ? {} : folderDragProps(node, drag, FOLDER_TYPE))}
        {...drop.props}>
        {selecting && <GroupCheck paths={[...node.all, ...node.dirs]} selected={selected} onToggle={onToggle} label={node.name} />}
        <button type="button" className={ns.folderToggle} onClick={() => open.toggle(node.path)} aria-expanded={isOpen}>
          <FolderGlyph icon={ctx.icons[node.path]} open={isOpen} />
          <span className={ns.treeLabel}>{node.name}</span>
          <span className={ns.groupCount}>{node.all.length}</span>
        </button>
        {!selecting && (
          <span className={ns.folderActions}>
            <Menu
              label={`Add to ${node.name}`}
              icon={<PlusIcon size={14} />}
              className={ns.folderAction}
              items={[
                {label: 'New notebook here', icon: <NotebookIcon size={14} />, onClick: () => actions.newNotebook(node.path)},
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
            <button type="button" className={ns.folderAction} onClick={() => ctx.setPicking(node.path)} title="Set an icon" aria-label={`Set an icon for folder ${node.name}`}>
              <IconButtonGlyph size={14} />
            </button>
            <button type="button" className={ns.folderAction} onClick={() => setEditing({mode: 'rename', path: node.path})} title="Rename folder" aria-label={`Rename folder ${node.name}`}>
              <EditIcon size={14} />
            </button>
            {node.all.length > 0 && (
              <button
                type="button"
                className={ns.folderAction}
                onClick={() => onExport(node.all, node.name)}
                disabled={busy}
                title={node.all.length === 1 ? 'Export this notebook (.ipynb)' : `Export ${node.all.length} notebooks (.zip)`}
                aria-label={`Export folder ${node.name}`}>
                <DownloadIcon size={14} />
              </button>
            )}
            {empty && (
              <button type="button" className={`${ns.folderAction} ${ns.danger}`} onClick={() => actions.deleteFolder(node.path)} title="Delete this empty folder" aria-label={`Delete empty folder ${node.name}`}>
                <TrashIcon size={14} />
              </button>
            )}
          </span>
        )}
        <button type="button" className={ns.caret} onClick={() => open.toggle(node.path)} aria-label={`${isOpen ? 'Close' : 'Open'} folder ${node.name}`} tabIndex={-1}>
          <ChevronIcon size={14} />
        </button>
      </div>
      {isOpen && <TreeItems node={node} depth={depth + 1} ctx={ctx} />}
    </li>
  );
}

function TreeItems({node, depth, ctx}) {
  const {editing, setEditing, actions} = ctx;
  return (
    <ul className={ns.tree}>
      {editing?.mode === 'new' && editing.parent === node.path && (
        <li>
          <FolderNameInput depth={depth} onSubmit={(name) => actions.createFolder(node.path ? `${node.path}/${name}` : name)} onCancel={() => setEditing(null)} />
        </li>
      )}
      {node.folders.map((f) => (
        <TreeFolder key={f.path} node={f} depth={depth} ctx={ctx} />
      ))}
      {node.notes.map((n) => (
        <TreeNotebook key={n.path} nb={n} depth={depth} ctx={ctx} />
      ))}
    </ul>
  );
}

function TopLevelDrop({ctx}) {
  const drop = useDropTarget('', ctx);
  if (!ctx.drag.dragging || ctx.drag.from === '') return null;
  return (
    <div className={`${ns.topDrop} ${drop.over ? ns.dropOver : ''}`} {...drop.props}>
      <ArrowLeftIcon size={14} /> Drop here to move to the top level
    </div>
  );
}

function FolderTree({notebooks, list, url, call, filtered, ...props}) {
  const tree = useMemo(() => buildTree(notebooks, filtered ? [] : list.folders), [notebooks, list.folders, filtered]);
  const open = useOpenFolders(url.nb, filtered, 'notebooks-open-folders');
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [picking, setPicking] = useState(null); // the folder whose icon is being picked
  const icons = list.folderIcons ?? {};
  const post = (route, body) => call(route, {method: 'POST', body});

  const done = async (text) => {
    setEditing(null);
    await list.reload();
    setMessage(text ? {text} : null);
  };
  const fail = (err) => setMessage({error: err.message});
  const actions = {
    newNotebook: (folder) => url.go(url.href({new: true, in: folder || null, nb: null, trash: null})),
    createFolder: async (path) => {
      const {folder} = await post('/folder', {path});
      open.set(folder, true);
      await done();
    },
    renameFolder: async (path, name) => {
      const {folder} = await post('/folder/rename', {path, name});
      if (folder !== path) open.move(path, folder);
      if (url.nb?.startsWith(`${path}/`)) url.go(url.href({nb: folder + url.nb.slice(path.length)}), {replace: true});
      await done();
    },
    deleteFolder: (path) =>
      post('/folder/delete', {path})
        .then(() => done())
        .catch(fail),
  };
  const drag = {
    dragging: dragging?.path,
    from: dragging?.from,
    kind: dragging?.kind,
    over,
    setOver,
    start: (nb) => {
      setMessage(null);
      setDragging({path: nb.path, from: nb.folder, kind: 'notebook'});
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
          const moved = await post('/folder/move', {path, folder});
          open.move(path, moved.folder);
          if (folder) open.set(folder, true);
          if (url.nb?.startsWith(`${path}/`)) url.go(url.href({nb: moved.folder + url.nb.slice(path.length)}), {replace: true});
          return await done(`Moved the folder “${path.split('/').pop()}” to ${folder || 'the top level'}`);
        }
        const moved = await post('/move', {path, folder});
        if (url.nb === path) url.go(url.href({nb: moved.path}), {replace: true});
        if (folder) open.set(folder, true);
        await done(`Moved “${moved.title}” to ${folder || 'the top level'}`);
      } catch (err) {
        fail(err);
      }
    },
  };
  const ctx = {url, open, editing, setEditing, actions, drag, icons, setPicking, ...props};

  return (
    <nav aria-label="Notebooks by folder" className={ns.treeNav}>
      <IconPicker
        item={picking}
        current={picking ? icons[picking] : null}
        onPick={async (icon) => {
          await post('/folder/icon', {path: picking, icon});
          setPicking(null);
          await list.reload();
        }}
        onClose={() => setPicking(null)}
      />
      <div className={ns.treeHead}>
        <span>Folders</span>
        {!props.selecting && (
          <Menu
            label="Add a notebook or folder"
            icon={<PlusIcon size={15} />}
            className={ns.folderAction}
            items={[
              {label: 'New notebook', icon: <NotebookIcon size={14} />, onClick: () => actions.newNotebook('')},
              {label: 'New folder', icon: <FolderIcon size={14} />, onClick: () => setEditing({mode: 'new', parent: ''})},
            ]}
          />
        )}
      </div>
      {message && (
        <p className={message.error ? ns.treeError : ns.treeMessage} role={message.error ? 'alert' : 'status'}>
          {message.error || message.text}
          <button type="button" className={ns.tagRemove} onClick={() => setMessage(null)} aria-label="Dismiss">
            <XIcon size={12} />
          </button>
        </p>
      )}
      <TopLevelDrop ctx={ctx} />
      {!notebooks.length && !tree.folders.length && editing?.mode !== 'new' ? <p className={ns.empty}>No notebooks match.</p> : <TreeItems node={tree} depth={0} ctx={ctx} />}
    </nav>
  );
}

// --- The panel -----------------------------------------------------------------------------------------

// list: {notebooks, tags, folders, jupyter, stack, reload}; status: JupyterLab and the stack checkout
export default function NotebookList({list, url, call, exportPaths, onCollapse, onDeleteMany, trashCount, status, onIconChanged}) {
  const ex = useSelection(list, exportPaths);
  // The hover button on a notebook's row (RowIconButton): sets its icon, then the list (and an open editor) refresh
  const saveIcon = async (item, icon) => {
    await call('/meta', {method: 'POST', body: {path: item.path, icon}});
    await list.reload();
    onIconChanged?.(item.path);
  };
  const [query, setQuery] = useState(url.q);
  useEffect(() => setQuery(url.q), [url.q]);
  const hits = useSearch(url.q, call);
  const want = url.tag?.toLowerCase();
  const field = url.sort;
  const notebooks = useMemo(() => {
    let out = list.notebooks.filter(
      (n) =>
        (!want || n.tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`))) &&
        (url.folder == null || n.folder === url.folder || n.folder.startsWith(`${url.folder}/`)) &&
        (!hits || hits.has(n.path)),
    );
    if (hits) out = out.sort((a, b) => [...hits.keys()].indexOf(a.path) - [...hits.keys()].indexOf(b.path));
    else out = out.sort((a, b) => b[field].localeCompare(a[field]));
    return out;
  }, [list.notebooks, want, url.folder, hits, field]);

  const groups = useMemo(() => {
    if (hits) return notebooks.length ? [['Best matches', notebooks]] : [];
    const pinned = notebooks.filter((n) => n.pinned);
    const map = new Map();
    for (const n of notebooks.filter((x) => !x.pinned)) map.set(dateGroup(n[field]), [...(map.get(dateGroup(n[field])) ?? []), n]);
    return [...(pinned.length ? [['Pinned', pinned]] : []), ...map.entries()];
  }, [notebooks, hits, field]);

  const views = [
    ['date', 'By date', CalendarIcon],
    ['tags', 'By tag', TagIcon],
    ['folders', 'By folder', FolderIcon],
  ];

  return (
    <IconPickerHost save={saveIcon}>
    <aside className={ns.side} aria-label="Jupyter Notebooks">
      <div className={ns.sideHead}>
        <Link to={url.href({}, {keep: false})} className={ns.sideTitle}>
          Notebooks
        </Link>
        <div className={ns.sideActions}>
          <button type="button" className={ns.collapseButton} onClick={onCollapse} title="Hide the notebooks list" aria-label="Hide the notebooks list">
            <PanelIcon size={16} />
          </button>
          <button type="button" className={ns.textAction} onClick={ex.selecting ? ex.stop : ex.start} aria-pressed={ex.selecting} title="Select notebooks to export or delete">
            {ex.selecting ? <XIcon size={14} /> : <SelectIcon size={14} />}
            {ex.selecting ? 'Cancel' : 'Select'}
          </button>
          <Link to={url.href({new: true, in: url.folder || null, nb: null, trash: null})} className={`button button--primary button--sm ${ns.withIcon}`}>
            <PlusIcon size={14} /> New
          </Link>
        </div>
      </div>
      {status}
      {ex.selecting && (
        <div className={ns.selectBar} role="region" aria-label="Export or delete selected notebooks">
          <label className={ns.selectAll}>
            <GroupCheck paths={notebooks.map((n) => n.path)} selected={ex.selected} onToggle={ex.toggle} label="the list" />
            {ex.chosen.length || ex.chosenFolders.length ? <SelectionCount items={ex.chosen.length} folders={ex.chosenFolders.length} kind="notebook" /> : 'Select all'}
          </label>
          <button
            type="button"
            className={`${ns.iconOnly} ${ns.danger}`}
            onClick={async () => (await onDeleteMany({notebooks: ex.chosen, folders: ex.chosenFolders})) && ex.stop()}
            disabled={!(ex.chosen.length || ex.chosenFolders.length) || ex.state?.busy}
            title="Delete selected notebooks and folders"
            aria-label="Delete selected notebooks and folders">
            <TrashIcon />
          </button>
          <button type="button" className={`button button--primary button--sm ${ns.withIcon}`} onClick={ex.exportChosen} disabled={!ex.chosen.length || ex.state?.busy}>
            <DownloadIcon size={14} /> {ex.state?.busy ? 'Exporting…' : ex.chosen.length > 1 ? 'Export .zip' : ex.chosen.length ? 'Export .ipynb' : 'Export'}
          </button>
        </div>
      )}
      {ex.state?.error && (
        <p className={ns.sideError} role="alert">
          Export failed: {ex.state.error}
        </p>
      )}
      <form
        className={ns.search}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          url.go(url.href({q: query.trim() || null}), {replace: true});
        }}>
        <SearchIcon size={15} />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) url.go(url.href({q: null}), {replace: true});
          }}
          placeholder="Search notebooks (Enter)"
          aria-label="Search notebooks: titles, tags, code and outputs"
        />
      </form>
      <nav className={ns.views} aria-label="Organize notebooks">
        {views.map(([id, label, Icon]) => (
          <Link key={id} to={url.href({view: id === 'date' ? null : id})} className={`${ns.view} ${url.view === id ? ns.viewActive : ''}`} aria-current={url.view === id ? 'true' : undefined}>
            <Icon size={14} />
            {label}
          </Link>
        ))}
      </nav>
      {url.view === 'date' && !hits && (
        <div className={ns.sortRow}>
          {field === 'created' ? <CalendarIcon size={12} /> : <ClockIcon size={12} />} Sorted by{' '}
          <Link to={url.href({sort: null})} className={field === 'updated' ? ns.sortActive : undefined}>
            last change
          </Link>{' '}
          ·{' '}
          <Link to={url.href({sort: 'created'})} className={field === 'created' ? ns.sortActive : undefined}>
            created
          </Link>
        </div>
      )}
      {url.view === 'tags' && (
        <TagBrowser
          tags={list.tags}
          notes={list.notebooks}
          activeTag={url.tag}
          hrefFor={(tag) => url.href({tag})}
          onPick={(tag) => url.go(url.href({tag}), {replace: true})}
          limit={20}
        />
      )}
      {(url.tag || url.folder != null || url.q) && (
        <div className={ns.filters}>
          {url.tag && (
            <Link to={url.href({tag: null})} className={ns.filter} aria-label={`Remove filter: tag ${url.tag}`}>
              <TagIcon size={12} /> {url.tag} <XIcon size={12} />
            </Link>
          )}
          {url.folder != null && (
            <Link to={url.href({folder: null})} className={ns.filter} aria-label={`Remove filter: folder ${url.folder || 'top level'}`}>
              <FolderIcon size={12} /> {url.folder || 'Top level'} <XIcon size={12} />
            </Link>
          )}
          {url.q && (
            <Link to={url.href({q: null})} className={ns.filter} aria-label="Clear search">
              <SearchIcon size={12} /> “{url.q}” <XIcon size={12} />
            </Link>
          )}
        </div>
      )}
      <div className={ns.list}>
        {url.view === 'folders' && !hits ? (
          <FolderTree
            notebooks={notebooks}
            list={list}
            url={url}
            call={call}
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
      <div className={ns.sideFoot}>
        <Link
          to={url.href({trash: true, nb: null, new: null, in: null})}
          className={`${ns.footLink} ${url.trash ? ns.footLinkActive : ''}`}
          aria-current={url.trash ? 'page' : undefined}>
          <TrashIcon size={14} /> Trash
          {trashCount > 0 && <span className={ns.groupCount}>{trashCount}</span>}
        </Link>
      </div>
    </aside>
    </IconPickerHost>
  );
}

// What's left of the list while it's hidden
export function Rail({url, onExpand}) {
  return (
    <nav className={ns.rail} aria-label="Notebooks (list hidden)">
      <button type="button" className={ns.railButton} onClick={onExpand} title="Show the notebooks list" aria-label="Show the notebooks list">
        <PanelIcon size={18} />
      </button>
      <Link to={url.href({new: true, nb: null, trash: null})} className={ns.railButton} title="New notebook" aria-label="New notebook">
        <PlusIcon size={18} />
      </Link>
      <Link to={url.href({trash: true, nb: null, new: null})} className={`${ns.railButton} ${ns.railBottom} ${url.trash ? ns.railActive : ''}`} title="Trash" aria-label="Trash">
        <TrashIcon size={18} />
      </Link>
    </nav>
  );
}
