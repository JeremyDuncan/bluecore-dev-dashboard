// The notebook editor on the Notebooks page: everything JupyterLab does for a notebook, in the dashboard.
// Edit code (CodeEditor) and Markdown cells, add, move, delete and retype cells, run one cell, all of
// them or from a restart, stop a run, clear outputs, rename, and switch the environment.
//
// Saving: edits save on their own a moment after you stop typing (and before every run), by sending
// the whole cell list (PUT {cells, baseMtime}; updateNotebook in mcp/notebooks.mjs). Each cell knows its
// index in the saved file ("from"), so the server keeps outputs of cells that only moved or changed.
// baseMtime refuses a save over a change made elsewhere (JupyterLab, an agent). While cells run, the
// notebook is read-only, so the outputs land on the cells they came from.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ProviderIcon} from '../AskDocs/CliPicker';
import {TagInput} from '../Notes';
import {copyText} from '../Notes/api';
import ns from '../Notes/styles.module.css';
import {writer} from '../Notes/authors';
import {CopyIcon, DownloadIcon, DuplicateIcon, FolderIcon, NotebookIcon, PinIcon} from '../Notes/icons';
import {Glyph, IconButtonGlyph, IconPicker} from '../FolderIcons';
import CodeEditor from './CodeEditor';
import Output, {joined, Markdown} from './Output';
import styles from './styles.module.css';

const SAVE_DELAY_MS = 800;
const FOLD_LINES = 18; // longer code cells start folded, so outputs stay in view

export const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'});
};

let nextKey = 0;
const newKey = () => `c${++nextKey}`;
const fromServer = (nb) =>
  nb.cellsList.map((c, i) => ({key: newKey(), from: i, type: c.type, source: c.source, outputs: c.outputs ?? [], executionCount: c.executionCount ?? null}));

// --- Small icons (stroke, currentColor) ---------------------------------------------------------------
const PATHS = {
  play: 'M7 5l11 7-11 7z',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5 9-10',
};
const Icon = ({name, size = 15}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

// --- Header pieces --------------------------------------------------------------------------------------
function Byline({nb}) {
  const by = writer(nb.author && nb.author !== 'starter' ? nb.author : 'you', nb.model);
  const run = nb.lastRun && writer(nb.lastRun.by === 'you' ? 'you' : nb.lastRun.by, nb.lastRun.model);
  return (
    <div className={styles.byline}>
      <span className={styles.metaItem}>
        {by.provider && <ProviderIcon icon={by.provider} size={14} />}
        {nb.author === 'starter' ? 'Starter notebook' : by.ai ? `Written by ${by.name}${by.model ? ` · ${by.model}` : ''}` : 'Yours'}
        {nb.editedBy && ` · edited by ${writer(nb.editedBy, nb.editedModel).name}`}
      </span>
      {run && (
        <span className={styles.metaItem}>
          {run.provider && <ProviderIcon icon={run.provider} size={14} />}
          Last run {when(nb.lastRun.at)} by {run.ai ? run.name : 'you'}
        </span>
      )}
    </div>
  );
}

// Which environment the notebook runs against
function TargetPicker({environments, value, disabled, onChange}) {
  if (!environments?.length || environments.length < 2) return null;
  const current = environments.find((e) => e.name === value);
  return (
    <div className={styles.target}>
      <span className={styles.targetLabel} id="nb-target">
        Runs against
      </span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby="nb-target">
        {environments.map((e) => (
          <button
            key={e.name}
            type="button"
            role="radio"
            aria-checked={e.name === value}
            className={e.name === value ? styles.segOn : undefined}
            disabled={disabled}
            title={e.deployed ? `${e.url} (deployed: read-only)` : 'Your local Bluecore stack'}
            onClick={() => e.name !== value && onChange(e.name)}>
            {e.name}
          </button>
        ))}
      </div>
      {current?.deployed && (
        <span className={styles.targetNote}>
          <a href={current.url} target="_blank" rel="noopener noreferrer">
            {current.url.replace(/^https?:\/\//, '')}
          </a>{' '}
          · shared, read-only
        </span>
      )}
    </div>
  );
}

// icon: the notebook's own icon, shown before the title (click it to change it)
function Title({title, icon, disabled, onRename, onIcon}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const done = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== title) onRename(value.trim());
    else setValue(title);
  };
  if (editing)
    return (
      <input
        className={styles.titleInput}
        value={value}
        autoFocus
        aria-label="Notebook title"
        onChange={(e) => setValue(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(title);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <h2 className={styles.title}>
      {icon && (
        <button type="button" className={ns.titleIcon} onClick={onIcon} title="Change icon" aria-label="Change this notebook's icon">
          <Glyph icon={icon} size={24} />
        </button>
      )}
      <button type="button" className={styles.titleButton} disabled={disabled} onClick={() => setEditing(true)} title="Rename">
        {title}
        <span className={styles.titleEdit} aria-hidden="true">
          <Icon name="edit" size={14} />
        </span>
      </button>
    </h2>
  );
}

function SaveState({state, onRetry}) {
  if (state === 'error')
    return (
      <span className={`${styles.saveState} ${styles.saveError}`}>
        Couldn't save ·{' '}
        <button type="button" className={styles.linkButton} onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  const text = {saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes'}[state];
  return (
    <span className={styles.saveState} aria-live="polite">
      {state === 'saved' && <Icon name="check" size={13} />}
      {text}
    </span>
  );
}

// --- Copying an output ------------------------------------------------------------------------------------

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function outputText(o) {
  if (o.output_type === 'stream') return joined(o.text);
  if (o.output_type === 'error') return `${o.ename}: ${o.evalue}\n${(o.traceback ?? []).join('\n')}`.replace(ANSI, '');
  const data = o.data ?? {};
  return joined(data['text/plain'] ?? data['text/markdown'] ?? '');
}

// Tables (pandas) go to the clipboard as HTML and as tab-separated text, so they paste as a table into
// a spreadsheet or a doc; other output as plain text; a chart alone as an image.
async function copyOutputs(outputs) {
  const tables = outputs
    .map((o) => o.data?.['text/html'])
    .filter(Boolean)
    .flatMap((h) => [...new DOMParser().parseFromString(joined(h), 'text/html').querySelectorAll('table')]);
  const text = outputs.map(outputText).filter(Boolean).join('\n').trimEnd();
  const png = outputs.map((o) => o.data?.['image/png']).find(Boolean);
  if (tables.length && window.ClipboardItem) {
    const tsv = tables.map((t) => [...t.rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join('\t')).join('\n')).join('\n\n');
    const html = tables.map((t) => t.outerHTML).join('<br>');
    await navigator.clipboard.write([new ClipboardItem({'text/plain': new Blob([tsv], {type: 'text/plain'}), 'text/html': new Blob([html], {type: 'text/html'})})]);
    return 'table';
  }
  if (!text.trim() && png && window.ClipboardItem) {
    const blob = await (await fetch(`data:image/png;base64,${joined(png).replace(/\s/g, '')}`)).blob();
    await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
    return 'image';
  }
  await copyText(text);
  return 'text';
}

function CopyOutput({outputs}) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!state) return undefined;
    const t = setTimeout(() => setState(null), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={styles.copyOut}
      onClick={() => copyOutputs(outputs).then((kind) => setState(kind === 'table' ? 'Copied table' : kind === 'image' ? 'Copied image' : 'Copied'), () => setState('Couldn\'t copy'))}
      title="Copy this output (tables paste into spreadsheets)">
      <CopyIcon size={13} /> {state ?? 'Copy'}
    </button>
  );
}

// --- One cell ------------------------------------------------------------------------------------------
function CellTools({cell, index, count, locked, canRun, onRun, onMove, onType, onDelete, onEdit}) {
  return (
    <div className={styles.cellTools} role="toolbar" aria-label={`Cell ${index + 1}`}>
      {cell.type === 'code' && (
        <button type="button" onClick={onRun} disabled={locked || !canRun} title="Run this cell (Shift+Enter)" aria-label="Run this cell">
          <Icon name="play" size={13} />
        </button>
      )}
      {cell.type === 'markdown' && onEdit && (
        <button type="button" onClick={onEdit} disabled={locked} title="Edit (double-click)" aria-label="Edit this cell">
          <Icon name="edit" size={14} />
        </button>
      )}
      <select value={cell.type} disabled={locked} onChange={(e) => onType(e.target.value)} aria-label="Cell type" title="Cell type">
        <option value="code">Code</option>
        <option value="markdown">Markdown</option>
      </select>
      <button type="button" onClick={() => onMove(-1)} disabled={locked || index === 0} title="Move up" aria-label="Move up">
        <Icon name="up" />
      </button>
      <button type="button" onClick={() => onMove(1)} disabled={locked || index === count - 1} title="Move down" aria-label="Move down">
        <Icon name="down" />
      </button>
      <button type="button" className={styles.toolDanger} onClick={onDelete} disabled={locked} title="Delete cell" aria-label="Delete cell">
        <Icon name="trash" />
      </button>
    </div>
  );
}

function Cell({cell, index, count, running, locked, canRun, focus, onChange, onRun, onRunNext, onMove, onType, onDelete, onSave}) {
  const lines = cell.source.split('\n').length;
  const [open, setOpen] = useState(false);
  const [editingMd, setEditingMd] = useState(focus && cell.type === 'markdown');
  const keys = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (cell.type === 'markdown') setEditingMd(false);
      onRunNext();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (cell.type === 'markdown') setEditingMd(false);
      else onRun();
    } else if (e.key === 'Escape' && cell.type === 'markdown') {
      setEditingMd(false);
    }
  };
  const tools = (
    <CellTools
      cell={cell}
      index={index}
      count={count}
      locked={locked}
      canRun={canRun}
      onRun={onRun}
      onMove={onMove}
      onType={onType}
      onDelete={onDelete}
      onEdit={cell.type === 'markdown' && !editingMd ? () => setEditingMd(true) : null}
    />
  );

  if (cell.type !== 'code') {
    return (
      <div className={`${styles.mdCell} ${editingMd ? styles.mdEditing : ''}`}>
        {tools}
        {editingMd ? (
          <div className={styles.mdEditor}>
            <CodeEditor
              value={cell.source}
              language="markdown"
              autoFocus
              label={`Markdown cell ${index + 1}`}
              placeholder="Write Markdown… (Shift+Enter or Esc to finish)"
              onChange={onChange}
              onKeyDown={keys}
            />
            <div className={styles.mdHint}>Markdown · Shift+Enter or Esc to finish</div>
          </div>
        ) : (
          <div
            className={styles.mdView}
            onDoubleClick={() => !locked && setEditingMd(true)}
            title={locked ? undefined : 'Double-click to edit'}>
            {cell.source.trim() ? <Markdown text={cell.source} /> : <p className={styles.muted}>Empty Markdown cell. Double-click to write.</p>}
          </div>
        )}
      </div>
    );
  }

  const failed = cell.outputs.some((o) => o.output_type === 'error');
  const n = running ? '*' : cell.executionCount ?? ' ';
  const state = running ? 'Running…' : failed ? 'Error' : cell.executionCount != null ? 'Ran' : 'Not run';
  const folded = lines > FOLD_LINES && !open;
  // Two blocks, like Jupyter: the code ("In", an editor panel) and below it its output ("Out")
  return (
    <div className={`${styles.codeCell} ${running ? styles.running : ''} ${failed ? styles.failed : ''}`}>
      <div className={styles.gutter}>
        <span className={styles.inPrompt}>In [{n}]</span>
        <button type="button" className={styles.runCell} onClick={onRun} disabled={locked || !canRun} title="Run this cell (Shift+Enter)" aria-label={`Run cell ${index + 1}`}>
          {running ? <span className={styles.spinner} aria-hidden="true" /> : <span className={styles.playIcon} aria-hidden="true" />}
        </button>
      </div>
      <div className={styles.input}>
        <div className={styles.inHead}>
          <span className={styles.lang}>
            <span className={styles.codeIcon} aria-hidden="true">
              {'</>'}
            </span>
            Python
          </span>
          <span className={`${styles.state} ${failed ? styles.stateErr : running ? styles.stateRun : cell.executionCount != null ? styles.stateOk : ''}`}>{state}</span>
          {tools}
        </div>
        <div className={`${styles.codeWrap} ${folded ? styles.folded : ''}`}>
          <CodeEditor
            value={cell.source}
            readOnly={locked}
            autoFocus={focus}
            label={`Code cell ${index + 1}`}
            placeholder="# Python. Shift+Enter runs this cell"
            onChange={onChange}
            onKeyDown={keys}
            onFocus={() => setOpen(true)}
          />
        </div>
        {lines > FOLD_LINES && (
          <button type="button" className={styles.fold} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Show less' : `Show all ${lines} lines`}
          </button>
        )}
      </div>
      {cell.outputs.length > 0 && (
        <>
          <div className={styles.gutterOut}>
            <span className={styles.outPrompt}>Out [{n}]</span>
          </div>
          <section className={styles.output} aria-label={`Output of cell ${index + 1}`}>
            <div className={styles.outHead}>
              <span>{failed ? 'Output · error' : 'Output'}</span>
              <CopyOutput outputs={cell.outputs} />
            </div>
            <div className={styles.outBody}>
              {cell.outputs.map((o, i) => (
                <Output key={i} o={o} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Between cells: add a code or Markdown cell here
function AddCell({onAdd, disabled, always}) {
  return (
    <div className={`${styles.addCell} ${always ? styles.addAlways : ''}`}>
      <button type="button" disabled={disabled} onClick={() => onAdd('code')}>
        <Icon name="plus" size={13} /> Code
      </button>
      <button type="button" disabled={disabled} onClick={() => onAdd('markdown')}>
        <Icon name="plus" size={13} /> Markdown
      </button>
    </div>
  );
}

// --- The notebook ---------------------------------------------------------------------------------------
export default function NotebookEditor({nb: loaded, call, jupyterRunning, environments, knownTags = [], folders = [], onChanged, onOpen, onExport, onFlash, onDelete, onError}) {
  const [meta, setMeta] = useState(loaded);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [cells, setCells] = useState(() => fromServer(loaded));
  const [saveState, setSaveState] = useState('saved');
  const [running, setRunning] = useState(null); // null, 'all' or a cell key
  const [focusReq, setFocusReq] = useState(null); // {key, n}: put the caret in that cell
  const focusN = useRef(0);
  const setFocusKey = (key) => setFocusReq({key, n: ++focusN.current});
  const [undo, setUndo] = useState(null); // {cell, index}: the last deleted cell

  // Refs for the save loop, which runs outside React's render cycle
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const mtime = useRef(loaded.mtime);
  const version = useRef(0); // bumped on every edit
  const savedVersion = useRef(0);
  const inFlight = useRef(null);
  const timer = useRef(null);

  // A newer copy from the page (reloaded when you come back to the tab, e.g. after an agent changed
  // it): take it if it's newer than what this editor last saved, and there are no local edits or runs
  const lastLoaded = useRef(loaded.mtime);
  const runningRef = useRef(false);
  runningRef.current = running != null;
  useEffect(() => {
    if (loaded.mtime === lastLoaded.current) return;
    lastLoaded.current = loaded.mtime;
    if (loaded.mtime <= mtime.current || version.current !== savedVersion.current || runningRef.current) return;
    mtime.current = loaded.mtime;
    setMeta(loaded);
    setCells(fromServer(loaded));
  }, [loaded]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    if (version.current === savedVersion.current) return true;
    const snapshot = cellsRef.current;
    const v = version.current;
    setSaveState('saving');
    const work = (async () => {
      try {
        const n = await call(`/notebook?path=${encodeURIComponent(loaded.path)}`, {
          method: 'PUT',
          body: {cells: snapshot.map((c) => ({from: c.from, type: c.type, source: c.source})), baseMtime: mtime.current},
        });
        mtime.current = n.mtime;
        savedVersion.current = v;
        const pos = new Map(snapshot.map((c, i) => [c.key, i]));
        setCells((cs) => cs.map((c) => ({...c, from: pos.has(c.key) ? pos.get(c.key) : null})));
        setMeta(n);
        setSaveState(version.current === v ? 'saved' : 'unsaved');
        return true;
      } catch (e) {
        setSaveState('error');
        onError(e.status === 409 ? 'This notebook was changed elsewhere (JupyterLab or an agent) since you opened it. Reload the page to get the latest, then redo your edit.' : `Couldn't save: ${e.message}`);
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = work;
    const ok = await work;
    if (ok && version.current !== savedVersion.current) timer.current = setTimeout(save, SAVE_DELAY_MS);
    return ok;
  }, [call, loaded.path, onError]);

  // Every edit goes through here: local change now, save shortly after
  const change = useCallback(
    (fn) => {
      setCells((cs) => fn(cs));
      version.current += 1;
      setSaveState('unsaved');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY_MS);
    },
    [save],
  );

  // Don't lose edits: save when leaving the notebook, warn when closing the tab with unsaved edits
  useEffect(() => {
    const warn = (e) => {
      if (version.current !== savedVersion.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (version.current !== savedVersion.current) save();
    };
  }, [save]);

  const flush = async () => {
    clearTimeout(timer.current);
    return save();
  };

  const run = async (keys, {restart = false} = {}) => {
    if (!(await flush())) return;
    setRunning(keys?.length === 1 ? keys[0] : 'all');
    onError(null);
    try {
      const indexes = keys?.map((k) => cellsRef.current.findIndex((c) => c.key === k)).filter((i) => i >= 0);
      const n = await call('/run', {method: 'POST', body: {path: loaded.path, cells: indexes, restart}});
      mtime.current = n.mtime;
      setMeta(n);
      setCells((cs) => cs.map((c, i) => ({...c, from: i, outputs: n.cellsList[i]?.outputs ?? c.outputs, executionCount: n.cellsList[i]?.executionCount ?? c.executionCount})));
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setRunning(null);
    }
  };

  const post = async (route) => {
    try {
      await call(route, {method: 'POST', body: {path: loaded.path}});
    } catch (e) {
      onError(e.message);
    }
  };

  // Other saves through the API (title, environment, clearing outputs) after any pending edits
  const put = async (body, {reset = false} = {}) => {
    if (!(await flush())) return;
    try {
      const n = await call(`/notebook?path=${encodeURIComponent(loaded.path)}`, {method: 'PUT', body: {...body, baseMtime: mtime.current}});
      mtime.current = n.mtime;
      setMeta(n);
      if (reset) setCells(fromServer(n));
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  };

  // Tags and pin (metadata only), a copy, a move: after any pending edits, so nothing is overwritten
  const organize = async (route, body, then) => {
    if (!(await flush())) return;
    try {
      const n = await call(route, {method: 'POST', body: {path: loaded.path, ...body}});
      if (route === '/meta') {
        mtime.current = n.mtime;
        setMeta(n);
        onChanged();
      }
      then?.(n);
    } catch (e) {
      onError(e.message);
    }
  };
  const closeMenu = (e) => (e.currentTarget.closest('details').open = false);

  const add = (at, type) => {
    const cell = {key: newKey(), from: null, type, source: '', outputs: [], executionCount: null};
    change((cs) => [...cs.slice(0, at), cell, ...cs.slice(at)]);
    setFocusKey(cell.key);
  };
  const edit = (key, source) => change((cs) => cs.map((c) => (c.key === key ? {...c, source} : c)));
  const move = (key, dir) =>
    change((cs) => {
      const i = cs.findIndex((c) => c.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const retype = (key, type) => change((cs) => cs.map((c) => (c.key === key ? {...c, type, outputs: type === 'code' ? c.outputs : [], executionCount: type === 'code' ? c.executionCount : null} : c)));
  const remove = (key) => {
    const index = cellsRef.current.findIndex((c) => c.key === key);
    setUndo({cell: cellsRef.current[index], index});
    change((cs) => cs.filter((c) => c.key !== key));
  };
  const restore = () => {
    if (!undo) return;
    // It's no longer in the saved file, so it comes back as a new cell, without the outputs it had
    const cell = {...undo.cell, key: newKey(), from: null, outputs: [], executionCount: null};
    change((cs) => [...cs.slice(0, undo.index), cell, ...cs.slice(undo.index)]);
    setUndo(null);
  };
  useEffect(() => {
    if (!undo) return undefined;
    const t = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(t);
  }, [undo]);

  // Shift+Enter: run a code cell (or finish a Markdown one), then go to the next cell, adding one at the end
  const runNext = async (key) => {
    const i = cellsRef.current.findIndex((c) => c.key === key);
    const next = cellsRef.current[i + 1];
    if (next) setFocusKey(next.key);
    else add(i + 1, 'code');
    if (cellsRef.current[i]?.type === 'code' && jupyterRunning) await run([key]);
  };

  const locked = running != null;
  const codeCount = cells.filter((c) => c.type === 'code').length;
  const errors = cells.filter((c) => c.outputs.some((o) => o.output_type === 'error')).length;

  return (
    <>
      <header className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.path}>{meta.path}</span>
          <Title title={meta.title} icon={meta.icon} disabled={locked} onRename={(title) => put({title})} onIcon={() => setPickingIcon(true)} />
          <IconPicker
            item={pickingIcon ? meta.path : null}
            name={meta.title}
            fallback={<NotebookIcon size={20} />}
            current={meta.icon}
            onPick={async (icon) => {
              await organize('/meta', {icon});
              setPickingIcon(false);
            }}
            onClose={() => setPickingIcon(false)}
          />
          <Byline nb={meta} />
          <div className={styles.tagsRow}>
            <TagInput tags={meta.tags ?? []} known={knownTags} onChange={(tags) => organize('/meta', {tags})} />
          </div>
          <TargetPicker environments={environments} value={meta.target} disabled={locked} onChange={(target) => put({target}, {reset: true})} />
        </div>
        <div className={styles.actionsCol}>
          <div className={styles.actions}>
            {locked ? (
              <button type="button" className={styles.stop} onClick={() => post('/interrupt')} title="Stop the running cell (interrupt the kernel)">
                <Icon name="stop" size={13} /> Stop
              </button>
            ) : (
              <button type="button" className={styles.primary} onClick={() => run()} disabled={!jupyterRunning || !codeCount}>
                <Icon name="play" size={13} /> Run all
              </button>
            )}
            <button type="button" className={styles.ghost} onClick={() => run(undefined, {restart: true})} disabled={locked || !jupyterRunning || !codeCount} title="Restart the kernel (clears variables), then run every cell">
              Restart & run all
            </button>
            <button
              type="button"
              className={`${styles.ghost} ${styles.iconButton} ${meta.pinned ? styles.pinned : ''}`}
              onClick={() => organize('/meta', {pinned: !meta.pinned})}
              aria-pressed={Boolean(meta.pinned)}
              title={meta.pinned ? 'Unpin (pinned notebooks come first in the list)' : 'Pin to the top of the list'}
              aria-label={meta.pinned ? 'Unpin' : 'Pin'}>
              <PinIcon size={15} />
            </button>
            <details className={styles.menu}>
              <summary className={styles.ghost} aria-label="More actions">
                More ▾
              </summary>
              <div className={styles.menuList}>
                <button type="button" disabled={locked} onClick={(e) => (closeMenu(e), organize('/duplicate', {}, (n) => (onFlash(`Made a copy: “${n.title}”`), onOpen(n.path))))}>
                  <DuplicateIcon size={14} /> Make a copy
                </button>
                <button type="button" onClick={(e) => (closeMenu(e), flush().then(() => onExport([loaded.path])))}>
                  <DownloadIcon size={14} /> Export (.ipynb)
                </button>
                <button type="button" onClick={(e) => (closeMenu(e), setPickingIcon(true))}>
                  <IconButtonGlyph size={14} /> {meta.icon ? 'Change icon…' : 'Set an icon…'}
                </button>
                <label className={styles.menuMove}>
                  <FolderIcon size={14} /> Move to
                  <select
                    value={meta.folder}
                    disabled={locked}
                    onChange={(e) => {
                      const folder = e.target.value;
                      e.currentTarget.closest('details').open = false;
                      organize('/move', {folder}, (n) => (onFlash(`Moved to ${folder || 'the top level'}`), onOpen(n.path)));
                    }}>
                    <option value="">Top level</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <hr />
                <button type="button" disabled={locked} onClick={(e) => (closeMenu(e), put({ops: [{op: 'clear_outputs'}]}, {reset: true}))}>
                  Clear all outputs
                </button>
                <button type="button" disabled={locked || !jupyterRunning} onClick={(e) => (closeMenu(e), post('/restart').then(onChanged))}>
                  Restart kernel
                </button>
                <a href={meta.labUrl} target="_blank" rel="noopener noreferrer">
                  Open in JupyterLab ↗
                </a>
                <hr />
                <button type="button" className={styles.menuDanger} disabled={locked} onClick={(e) => (closeMenu(e), flush().then(onDelete))}>
                  Delete notebook…
                </button>
              </div>
            </details>
          </div>
          <div className={styles.headStatus}>
            <SaveState state={saveState} onRetry={flush} />
            <span>
              {codeCount} code cells{errors ? <b className={styles.errCount}> · {errors} failed</b> : null}
            </span>
          </div>
        </div>
      </header>

      {!jupyterRunning && <p className={styles.jlNotice}>JupyterLab isn't running, so cells can't run. You can still edit; start it with <code>make up</code>.</p>}

      <div className={styles.cells}>
        {cells.map((c, i) => (
          <React.Fragment key={c.key}>
            <AddCell onAdd={(type) => add(i, type)} disabled={locked} />
            <Cell
              cell={c}
              index={i}
              count={cells.length}
              running={running === 'all' ? c.type === 'code' : running === c.key}
              locked={locked}
              canRun={jupyterRunning}
              focus={focusReq?.key === c.key ? focusReq.n : 0}
              onChange={(source) => edit(c.key, source)}
              onRun={() => run([c.key])}
              onRunNext={() => runNext(c.key)}
              onMove={(dir) => move(c.key, dir)}
              onType={(type) => retype(c.key, type)}
              onDelete={() => remove(c.key)}
              onSave={flush}
            />
          </React.Fragment>
        ))}
        <AddCell onAdd={(type) => add(cells.length, type)} disabled={locked} always />
        <p className={styles.keys}>
          <kbd>Shift</kbd>+<kbd>Enter</kbd> runs a cell and moves on · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs it in place · <kbd>Tab</kbd> indents · edits save on their own
        </p>
      </div>

      {undo && (
        <div className={styles.toast} role="status">
          Cell deleted
          <button type="button" onClick={restore}>
            Undo
          </button>
        </div>
      )}
    </>
  );
}
