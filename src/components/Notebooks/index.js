// The Notebooks page (/notebooks): Jupyter notebooks for debugging and troubleshooting the Bluecore
// stack. Lists, shows and runs the notebooks in ./notebooks through the MCP server's notebooks API
// (mcp/notebooks-api.mjs), which runs cells in the local JupyterLab container. The notebook itself is
// edited and run in Editor.js, so nothing needs JupyterLab's own interface.
// Each notebook runs against an environment (its "target"): the local stack, or a deployed one (dev,
// stage) that the kernel's helper only reads.
import React, {useCallback, useEffect, useState} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {ProviderIcon} from '../AskDocs/CliPicker';
import ConfirmDialog from '../Notes/ConfirmDialog';
import {Glyph} from '../FolderIcons';
import {relWhen, shortWhen} from '../Notes';
import {writer} from '../Notes/authors';
import {ArrowLeftIcon, ClockIcon, FolderIcon, HelpIcon, NotebookIcon, PinIcon, PlusIcon, SparkleIcon, TagIcon, TrashIcon, XIcon} from '../Notes/icons';
import PageHero from '../PageHero';
import ns from '../Notes/styles.module.css';
import NotebookEditor from './Editor';
import NotebookList, {Rail, useExport, useNotebooksUrl} from './Sidebar';
import styles from './styles.module.css';

function useApi() {
  const {liveApiUrl: base, notebooks} = useDocusaurusContext().siteConfig.customFields ?? {};
  const call = useCallback(
    async (path, {method = 'GET', body} = {}) => {
      const res = await fetch(`${base}/notebooks${path}`, {method, headers: body ? {'content-type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {status: res.status});
      return data;
    },
    [base],
  );
  // turnedOff: the local site without JUPYTER_NOTEBOOK=true in .env (notebooks are off by default)
  return {enabled: Boolean(base && notebooks), turnedOff: Boolean(base) && !notebooks, call, base};
}

// A new notebook: title, folder, and optionally a starter to begin from
function NewNotebook({starters, folders, folder, picked = '', onCreate, onCancel}) {
  const [title, setTitle] = useState('');
  const [starter, setStarter] = useState(starters.some((s) => s.name === picked) ? picked : '');
  const [into, setInto] = useState(folder);
  return (
    <form
      className={styles.newPage}
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({title: title.trim() || undefined, starter: starter || undefined, folder: into || undefined});
      }}>
      <h1 className={ns.withIcon}>
        <NotebookIcon size={28} /> New notebook
      </h1>
      <label htmlFor="nb-title">Title</label>
      <input id="nb-title" value={title} autoFocus placeholder={starter ? starters.find((s) => s.name === starter)?.title : 'e.g. Why does export to catalog fail?'} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="nb-folder">Folder</label>
      <select id="nb-folder" value={into} onChange={(e) => setInto(e.target.value)}>
        <option value="">Top level</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <label htmlFor="nb-starter">Start from</label>
      <select id="nb-starter" value={starter} onChange={(e) => setStarter(e.target.value)}>
        <option value="">A blank notebook</option>
        {starters.map((s) => (
          <option key={s.name} value={s.name}>
            {s.title}
          </option>
        ))}
      </select>
      <div className={styles.formButtons}>
        <button type="submit" className={styles.primary} disabled={!title.trim() && !starter}>
          Create
        </button>
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Deleted notebooks (?trash): Restore puts one back where it was
// The trash: Restore puts a notebook back; Delete forever erases it, after a confirmation
function TrashView({call, items, onRestored, onPurged}) {
  const [error, setError] = useState(null);
  const [purging, setPurging] = useState(null);
  const restore = async (item) => {
    setError(null);
    try {
      const {restored} = await call('/trash/restore', {method: 'POST', body: {name: item.name}});
      onRestored(restored, item);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className={ns.trash}>
      <h1 className={ns.withIcon}>
        <TrashIcon size={28} /> Trash
      </h1>
      <p className={ns.lead}>
        Notebooks you deleted, newest first. <strong>Restore</strong> puts one back where it was. Ones deleted in JupyterLab show here too.
      </p>
      {error && (
        <p className={ns.error} role="alert">
          {error}
        </p>
      )}
      {items == null ? (
        <p className={ns.empty}>Loading…</p>
      ) : items.length ? (
        <ul className={styles.trashList}>
          {items.map((item) => (
            <li key={item.name}>
              <span className={styles.trashTitle}>
                <NotebookIcon size={15} /> {item.title}
              </span>
              <span className={styles.trashMeta}>
                <FolderIcon size={12} /> {item.from.includes('/') ? item.from.slice(0, item.from.lastIndexOf('/')) : 'Top level'} · deleted {relWhen(item.deleted)}
                {item.via && ` in ${item.via}`}
              </span>
              <span className={styles.trashActions}>
                <button type="button" className={styles.ghost} onClick={() => restore(item)}>
                  <ArrowLeftIcon size={14} /> Restore
                </button>
                <button type="button" className={`${styles.ghost} ${styles.ghostDanger}`} onClick={() => setPurging(item)} aria-label={`Delete ${item.title} forever`}>
                  <TrashIcon size={14} /> Delete forever
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={ns.empty}>The trash is empty.</p>
      )}
      <ConfirmDialog
        open={Boolean(purging)}
        title={`Delete “${purging?.title}” forever?`}
        confirmLabel="Delete forever"
        busyLabel="Deleting…"
        onCancel={() => setPurging(null)}
        onConfirm={async () => {
          await call('/trash/purge', {method: 'POST', body: {name: purging.name}});
          const gone = purging;
          setPurging(null);
          onPurged(gone);
        }}>
        <p>This erases the notebook file, outputs included. It can't be undone{purging?.via ? `, here or in ${purging.via}` : ''}.</p>
      </ConfirmDialog>
    </div>
  );
}

// A notebook as a card (as notes are on the Notes page)
function NotebookCard({nb, to}) {
  const ai = writer(nb.author, nb.model);
  return (
    <Link to={to} className={ns.card}>
      <span className={ns.cardTitle}>
        {nb.pinned && <PinIcon size={14} />}
        <Glyph icon={nb.icon} size={15} />
        {nb.title}
      </span>
      <span className={ns.rowMeta}>
        <span className={ns.metaItem}>
          <ClockIcon size={12} />
          <time dateTime={nb.updated}>{shortWhen(nb.updated)}</time>
        </span>
        {nb.folder && (
          <span className={ns.metaItem}>
            <FolderIcon size={12} />
            {nb.folder}
          </span>
        )}
        {ai.ai && (
          <span className={ns.metaItem}>
            {ai.provider ? <ProviderIcon icon={ai.provider} size={12} /> : <SparkleIcon size={12} />}
            {ai.model ?? ai.name}
          </span>
        )}
        {nb.target !== 'local' && <span className={styles.envBadge}>{nb.target}</span>}
        {nb.errors > 0 && <span className={styles.errCount}>{nb.errors} failed</span>}
      </span>
      {nb.excerpt && <span className={ns.cardExcerpt}>{nb.excerpt}</span>}
      {nb.tags.length > 0 && (
        <span className={ns.cardTags}>
          {nb.tags.slice(0, 3).map((t) => (
            <span key={t} className={ns.cardTag}>
              #{t}
            </span>
          ))}
          {nb.tags.length > 3 && <span className={ns.cardTag}>+{nb.tags.length - 3}</span>}
        </span>
      )}
    </Link>
  );
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

// The page with no notebook open: the header, numbers, pinned and recent notebooks, the starters
function Overview({list, url, onCreate, onAddStarters}) {
  const nbs = list.notebooks;
  const week = nbs.filter((n) => Date.now() - new Date(n.updated).getTime() < WEEK).length;
  const failing = nbs.filter((n) => n.errors > 0);
  const pinned = nbs.filter((n) => n.pinned);
  const recent = nbs.filter((n) => !n.pinned).slice(0, pinned.length ? 3 : 6);
  const deployed = (list.environments ?? []).filter((e) => e.deployed).map((e) => e.name);
  const to = (n) => url.href({nb: n.path, new: null, trash: null});
  // Starters by group (in file order), and how many aren't in the Starters folder yet
  const starters = list.starters ?? [];
  const groups = [...starters.reduce((m, s) => m.set(s.group, [...(m.get(s.group) ?? []), s]), new Map())];
  const copied = new Set(nbs.filter((n) => n.folder === 'Starters').map((n) => n.title));
  const missing = starters.filter((s) => !copied.has(s.title)).length;
  return (
    <div className={ns.overview}>
      <PageHero
        eyebrow="Workspace · Jupyter Notebooks"
        title="Your notebooks"
        lead={
          <>
            Python notebooks for debugging Bluecore, run in JupyterLab against your local stack{deployed.length ? <> or {deployed.join(' / ')} (read-only)</> : null}. Edit and run them here, or ask an AI agent to write one.
          </>
        }
        actions={[
          {label: 'New notebook', to: url.href({new: true, nb: null, trash: null}), icon: <PlusIcon size={16} />, primary: true},
          list.jupyter?.running && {label: 'Open JupyterLab', href: list.jupyter.labUrl, icon: <NotebookIcon size={16} />},
          {label: 'How notebooks work', to: '/guides/notebooks', icon: <HelpIcon size={16} />},
        ]}
        stats={[
          {icon: <NotebookIcon size={18} />, value: nbs.length, label: nbs.length === 1 ? 'notebook' : 'notebooks'},
          {icon: <ClockIcon size={18} />, value: week, label: 'changed this week'},
          {icon: <TagIcon size={18} />, value: list.tags?.length ?? 0, label: list.tags?.length === 1 ? 'tag' : 'tags', to: url.href({view: 'tags'})},
          {icon: <XIcon size={18} />, value: failing.length, label: failing.length === 1 ? 'with failing cells' : 'with failing cells', tone: failing.length ? 'bad' : undefined},
        ]}
      />

      {pinned.length > 0 && (
        <section>
          <h2 className={ns.sectionTitle}>
            <PinIcon size={18} /> Pinned
          </h2>
          <div className={ns.cards}>
            {pinned.map((n) => (
              <NotebookCard key={n.path} nb={n} to={to(n)} />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className={ns.sectionTitle}>
            <ClockIcon size={18} /> Recently changed
          </h2>
          <div className={ns.cards}>
            {recent.map((n) => (
              <NotebookCard key={n.path} nb={n} to={to(n)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className={ns.sectionTitle}>
          <SparkleIcon size={18} /> Starters
          {missing > 0 && (
            <button type="button" className={`${ns.sectionLink} ${styles.linkLike}`} onClick={onAddStarters}>
              <PlusIcon size={14} /> {missing === starters.length ? 'Add all to a Starters folder' : `Add the ${missing} new to the Starters folder`}
            </button>
          )}
        </h2>
        {groups.map(([group, items]) => (
          <React.Fragment key={group}>
            {group && <h3 className={styles.starterGroup}>{group}</h3>}
            <ul className={styles.starters}>
              {items.map((s) => (
                <li key={s.name}>
                  <button type="button" onClick={() => onCreate({starter: s.name})}>
                    <strong>{s.title}</strong>
                    <span>{s.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </React.Fragment>
        ))}
        <p className={ns.hint}>
          Or ask in Ask the docs: <em>“Create a notebook that checks why the export to catalog fails, and run it.”</em>
        </p>
      </section>
    </div>
  );
}

const COLLAPSED_KEY = 'notebooks-panel-collapsed';
function useCollapsedPanel() {
  const [collapsed, setState] = useState(() => {
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
  const set = (next) => {
    setState(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // storage blocked: just not remembered
    }
  };
  return {collapsed: collapsed && wide, set};
}

// "Delete notebooks?": selected notebooks go to the trash; selected folders are removed once empty
function DeleteNotebooks({deleting, onCancel, onConfirm}) {
  const nbs = deleting?.notebooks ?? [];
  const dirs = deleting?.folders ?? [];
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const what = [nbs.length && count(nbs.length, 'notebook'), dirs.length && count(dirs.length, 'folder')].filter(Boolean).join(' and ');
  const title = nbs.length === 1 && !dirs.length ? `Delete “${nbs[0].title}”?` : !nbs.length && dirs.length === 1 ? `Delete the folder “${dirs[0].split('/').pop()}”?` : `Delete ${what}?`;
  return (
    <ConfirmDialog
      open={Boolean(nbs.length || dirs.length)}
      title={title}
      confirmLabel={nbs.length === 1 && !dirs.length ? 'Delete notebook' : !nbs.length && dirs.length === 1 ? 'Delete folder' : `Delete ${what}`} busyLabel="Deleting…" onCancel={onCancel} onConfirm={onConfirm}>
      {nbs.length > 0 && (
        <p>
          {nbs.length === 1 ? 'It moves' : 'They move'} to the trash, where you can restore {nbs.length === 1 ? 'it' : 'them'} (<strong>Trash</strong> at the bottom of the list).
        </p>
      )}
      {dirs.length > 0 && <p>{dirs.length === 1 ? 'The folder is' : 'The folders are'} removed once empty; a folder that still holds anything you didn't select is kept.</p>}
    </ConfirmDialog>
  );
}

export default function Notebooks() {
  const api = useApi();
  const {call, base} = api; // stable; the api object itself is new on every render
  const url = useNotebooksUrl();
  const panel = useCollapsedPanel();
  const exportPaths = useExport(base);
  const [list, setList] = useState(null);
  const [nb, setNb] = useState(null);
  const [trash, setTrash] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [deleting, setDeleting] = useState(null); // {notebooks, folders} to confirm deleting

  const loadList = useCallback(() => call('').then(setList, (e) => setError(e.message)), [call]);
  const loadTrash = useCallback(() => call('/trash').then((d) => setTrash(d.items), () => setTrash([])), [call]);
  const loadNb = useCallback(
    (path) =>
      path
        ? call(`/notebook?path=${encodeURIComponent(path)}`).then(
            (n) => (setNb(n), setError(null)),
            (e) => (setNb(null), setError(e.message)),
          )
        : setNb(null),
    [call],
  );
  const reload = useCallback(() => Promise.all([loadList(), loadTrash()]), [loadList, loadTrash]);

  useEffect(() => {
    if (api.enabled) reload();
  }, [api.enabled, reload]);
  useEffect(() => {
    if (api.enabled) loadNb(url.nb);
  }, [api.enabled, url.nb, loadNb]);
  // Notebooks change in JupyterLab and through agents: refresh when you come back to the tab
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return; // the editor keeps local edits and runs
      reload();
      if (url.nb) loadNb(url.nb);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [reload, loadNb, url.nb]);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  const open = (path, {replace} = {}) => url.go(url.href({nb: path, new: null, in: null, starter: null, trash: null}), {replace});

  const create = async (body) => {
    try {
      const n = await call('/notebook', {method: 'POST', body});
      await loadList();
      open(n.path, {replace: true});
    } catch (e) {
      setError(e.message);
    }
  };

  const addStarters = async () => {
    try {
      const {added} = await call('/starters', {method: 'POST', body: {}});
      await loadList();
      if (added[0]) open(added[0]);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!api.enabled)
    return (
      <main className={styles.page}>
        <div className={styles.notice}>
          <h1>Jupyter Notebooks</h1>
          {api.turnedOff ? (
            <p>
              Notebooks are off. To use them, set <code>JUPYTER_NOTEBOOK=true</code> in this site&apos;s <code>.env</code> and run <code>make up</code>, which also starts JupyterLab.
            </p>
          ) : (
            <p>Jupyter notebooks run in a JupyterLab container next to the local site. Run the site with <code>make up</code> to use them.</p>
          )}
        </div>
      </main>
    );
  if (!list) return <p className={ns.empty}>{error ?? 'Loading notebooks…'}</p>;

  const jupyter = list.jupyter;
  const listApi = {...list, reload};
  const selected = url.creating || url.nb || url.trash;
  const status = (
    <div className={styles.sideStatus}>
      <div className={`${styles.status} ${jupyter?.running ? styles.statusOk : styles.statusOff}`}>
        <span className={styles.dot} aria-hidden="true" />
        {jupyter?.running ? (
          <>
            JupyterLab is running
            <a href={jupyter.labUrl} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </>
        ) : (
          <span>
            JupyterLab isn't running. Start it with <code>make up</code>.
          </span>
        )}
      </div>
      {list.stack && (
        <p className={styles.stack} title={list.stack.path ?? undefined}>
          {list.stack.configured ? (
            <>
              Local stack: <code>{list.stack.path.split('/').filter(Boolean).pop()}</code>
              {list.stack.branch && <> on {list.stack.branch}</>}
              {list.stack.uncommitted > 0 && <> · {list.stack.uncommitted} uncommitted</>}
            </>
          ) : (
            <>
              Set <code>BLUECORE_STACK_DIR</code> in <code>.env</code> to your bluecore-stack checkout.
            </>
          )}
        </p>
      )}
    </div>
  );

  return (
    <div className={`${ns.layout} ${selected ? ns.hasSelection : ''} ${panel.collapsed ? ns.collapsed : ''}`}>
      {panel.collapsed ? (
        <Rail url={url} onExpand={() => panel.set(false)} />
      ) : (
        <NotebookList
          list={listApi}
          url={url}
          call={call}
          exportPaths={exportPaths}
          onCollapse={() => panel.set(true)}
          onDeleteMany={async (chosen) => {
            setDeleting(chosen);
            return false;
          }}
          trashCount={trash?.length ?? 0}
          status={status}
          onIconChanged={(path) => path === url.nb && loadNb(path)}
        />
      )}
      <main className={ns.main}>
        {selected && (
          <Link to={url.href({nb: null, new: null, in: null, trash: null})} className={ns.back}>
            <ArrowLeftIcon size={14} /> All notebooks
          </Link>
        )}
        {flash && (
          <p className={ns.flash} role="status">
            <span>{flash}</span>
            <button type="button" className={ns.tagRemove} onClick={() => setFlash(null)} aria-label="Dismiss">
              <XIcon size={14} />
            </button>
          </p>
        )}
        {error && (
          <div className={styles.alert} role="alert">
            {error}
          </div>
        )}
        {url.creating ? (
          <NewNotebook
            key={url.starter}
            starters={list.starters ?? []}
            folders={list.folders ?? []}
            folder={url.in}
            picked={url.starter}
            onCreate={create}
            onCancel={() => url.go(url.href({new: null, in: null, starter: null}))}
          />
        ) : url.trash ? (
          <TrashView
            call={call}
            items={trash}
            onRestored={async (restored, item) => {
              await reload();
              setFlash(
                <>
                  Restored “{item.title}”. <Link to={url.href({nb: restored, trash: null}, {keep: false})}>Open it</Link>
                </>,
              );
            }}
            onPurged={async (item) => {
              await reload();
              setFlash(`Deleted “${item.title}” forever.`);
            }}
          />
        ) : nb && nb.path === url.nb ? (
          <NotebookEditor
            key={nb.path}
            nb={nb}
            call={call}
            jupyterRunning={Boolean(jupyter?.running)}
            environments={list.environments}
            knownTags={list.tags ?? []}
            folders={list.folders ?? []}
            onChanged={loadList}
            onOpen={(path) => (loadList(), open(path, {replace: true}))}
            onExport={(paths) => exportPaths(paths).catch((e) => setError(`Export failed: ${e.message}`))}
            onFlash={setFlash}
            onDelete={() => setDeleting({notebooks: [nb], folders: []})}
            onError={setError}
          />
        ) : url.nb ? (
          <p className={ns.empty}>Loading…</p>
        ) : (
          <Overview list={list} url={url} onCreate={create} onAddStarters={addStarters} />
        )}
      </main>
      <DeleteNotebooks
        deleting={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const {deleted, foldersDeleted = [], foldersKept = []} = await call('/delete', {
            method: 'POST',
            body: {paths: deleting.notebooks.map((n) => n.path), folders: deleting.folders},
          });
          setDeleting(null);
          await reload();
          if (deleted.includes(url.nb)) url.go(url.href({nb: null}), {replace: true});
          const parts = [deleted.length && `moved ${deleted.length === 1 ? '1 notebook' : `${deleted.length} notebooks`} to the trash`, foldersDeleted.length && `deleted ${foldersDeleted.length === 1 ? '1 folder' : `${foldersDeleted.length} folders`}`].filter(Boolean);
          const keptNote = foldersKept.length ? ` Kept ${foldersKept.length === 1 ? `“${foldersKept[0].folder}”` : `${foldersKept.length} folders`}: still holding things you didn't select.` : '';
          setFlash(`${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())}.${keptNote}`);
        }}
      />
    </div>
  );
}
