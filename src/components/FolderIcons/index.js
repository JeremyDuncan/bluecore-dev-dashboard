// Icons for folders, notes and notebooks on the Notes and Notebooks pages: Glyph draws one (FolderGlyph
// for a folder) and IconPicker sets it (a modal with a searchable grid of line icons and an emoji tab).
// An icon is "line:<name>" or "emoji:<emoji>". Folders keep theirs in <folder>/.dashboard/folder-icons.json
// (mcp/folder-icons.mjs, /folder/icon); a note in its `icon` property, a notebook in metadata.bluecore.icon.
import React, {createContext, useContext, useEffect, useId, useMemo, useRef, useState} from 'react';
import {FolderIcon, FolderOpenIcon, XIcon} from '../Notes/icons';
import ns from '../Notes/styles.module.css';
import {EMOJI, LINE_ICON, LINE_ICONS, LineIcon} from './icons';
import styles from './styles.module.css';

// An icon, or `fallback` (default: nothing) when there's none
export function Glyph({icon, size = 15, fallback = null}) {
  if (icon?.startsWith('line:') && LINE_ICON[icon.slice(5)]) return <LineIcon name={icon.slice(5)} size={size} />;
  if (icon?.startsWith('emoji:'))
    return (
      <span className={styles.emoji} style={{fontSize: size, width: size, height: size}} aria-hidden="true">
        {icon.slice(6)}
      </span>
    );
  return fallback;
}

// A folder's icon: its own, else the open or closed folder
export function FolderGlyph({icon, open, size = 15}) {
  return <Glyph icon={icon} size={size} fallback={open ? <FolderOpenIcon size={size} /> : <FolderIcon size={size} />} />;
}

// A smiley in a square: the "set an icon" button in a folder's row
export const IconButtonGlyph = ({size = 14}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M8.5 14.5s1.25 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 9.5h.01M15 9.5h.01" />
  </svg>
);

// One emoji typed or pasted (the server checks it too)
const oneEmoji = (text) => {
  const t = text.trim();
  return t && t.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t) && !/[\p{L}\p{N}\s]/u.test(t.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}/gu, '')) ? t : null;
};

// item: what gets the icon, e.g. a folder's or note's path (null = closed); name: what the title calls it
// (default: the last part of the path); fallback: its icon when it has none (default: a folder);
// current: its icon; onPick(icon | null): async, saves it
export function IconPicker({item, name, fallback, current, onPick, onClose}) {
  const folder = item;
  const ref = useRef(null);
  const titleId = useId();
  const [tab, setTab] = useState('line');
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [state, setState] = useState(null); // {busy} | {error}

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (folder != null && !dialog.open) {
      setTab(current?.startsWith('emoji:') ? 'emoji' : 'line');
      setQuery('');
      setTyped('');
      setState(null);
      dialog.showModal();
    } else if (folder == null && dialog.open) dialog.close();
  }, [folder, current]);

  const icons = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? LINE_ICONS.filter((i) => `${i.name} ${i.label} ${i.words}`.toLowerCase().includes(q)) : LINE_ICONS;
  }, [query]);
  // The emoji tab's box searches by name; an emoji typed or pasted into it can be used as it is
  const emojis = useMemo(() => {
    const q = typed.trim().toLowerCase();
    if (!q || oneEmoji(typed)) return EMOJI;
    return EMOJI.filter(([, words]) => words.includes(q));
  }, [typed]);

  const pick = async (icon) => {
    setState({busy: true});
    try {
      await onPick(icon);
      setState(null);
    } catch (err) {
      setState({error: err.message});
    }
  };
  const close = () => !state?.busy && onClose();
  const label = name ?? folder?.split('/').pop()?.replace(/\.(md|ipynb)$/, '');
  const emoji = oneEmoji(typed);

  return (
    <dialog
      ref={ref}
      className={`${ns.dialog} ${styles.picker}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === ref.current && close()}>
      {folder != null && (
        <div className={styles.body}>
          <div className={styles.head}>
            <h2 id={titleId} className={styles.title}>
              <span className={styles.preview}>{fallback ? <Glyph icon={current} size={20} fallback={fallback} /> : <FolderGlyph icon={current} size={20} />}</span>
              Icon for “{label}”
            </h2>
            <button type="button" className={styles.close} onClick={close} aria-label="Close">
              <XIcon size={16} />
            </button>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Kind of icon">
            {[
              ['line', 'Icons'],
              ['emoji', 'Emoji'],
            ].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${styles.tab} ${tab === id ? styles.tabOn : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'line' ? (
            <>
              <input className={styles.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons (e.g. bug, docs, team)" aria-label="Search icons" autoFocus />
              <div className={styles.grid} role="listbox" aria-label="Icons">
                {icons.map((i) => (
                  <button
                    key={i.name}
                    type="button"
                    role="option"
                    aria-selected={current === `line:${i.name}`}
                    className={`${styles.cell} ${current === `line:${i.name}` ? styles.cellOn : ''}`}
                    onClick={() => pick(`line:${i.name}`)}
                    disabled={state?.busy}
                    title={i.label}
                    aria-label={i.label}>
                    <LineIcon name={i.name} size={20} />
                  </button>
                ))}
                {!icons.length && <p className={styles.none}>No icon matches “{query}”. Try the Emoji tab.</p>}
              </div>
            </>
          ) : (
            <>
              <div className={styles.typed}>
                <input
                  type="search"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Search emoji (e.g. rocket, bug), or paste one"
                  aria-label="Search emoji, or paste one"
                  autoFocus
                />
                {emoji && (
                  <button type="button" className="button button--primary button--sm" onClick={() => pick(`emoji:${emoji}`)} disabled={state?.busy}>
                    Use {emoji}
                  </button>
                )}
              </div>
              <div className={styles.grid} role="listbox" aria-label="Emoji">
                {emojis.map(([e, words]) => (
                  <button
                    key={e}
                    type="button"
                    role="option"
                    aria-selected={current === `emoji:${e}`}
                    className={`${styles.cell} ${styles.emojiCell} ${current === `emoji:${e}` ? styles.cellOn : ''}`}
                    onClick={() => pick(`emoji:${e}`)}
                    disabled={state?.busy}
                    title={words.split(' ')[0]}
                    aria-label={`${e} ${words.split(' ')[0]}`}>
                    {e}
                  </button>
                ))}
                {!emojis.length && <p className={styles.none}>No emoji matches “{typed.trim()}”. Paste any emoji to use it.</p>}
              </div>
            </>
          )}

          {state?.error && (
            <p className={ns.error} role="alert">
              {state.error}
            </p>
          )}
          <div className={styles.foot}>
            {current ? (
              <button type="button" className="button button--secondary button--sm" onClick={() => pick(null)} disabled={state?.busy}>
                Remove icon
              </button>
            ) : (
              <span className={styles.hint}>Shown next to its name in the lists.</span>
            )}
            <button type="button" className="button button--secondary button--sm" onClick={close} disabled={state?.busy}>
              {state?.busy ? 'Saving…' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// --- Changing an icon from the left panel ----------------------------------------------------------
// IconPickerHost wraps a panel and holds one picker; RowIconButton, in a row of that panel, opens it for
// the row's note or notebook. The button sits next to the row's link (not inside it), shows on hover or
// keyboard focus, and the row's <li> takes `rowItemClass` so it can place it.

const PickContext = createContext(null);
export const rowItemClass = styles.rowItem;

// save(item, icon | null): async, stores the icon (and reloads the list)
export function IconPickerHost({save, children}) {
  const [item, setItem] = useState(null); // {path, name, icon, fallback}
  return (
    <PickContext.Provider value={setItem}>
      {children}
      <IconPicker
        item={item?.path ?? null}
        name={item?.name}
        fallback={item?.fallback}
        current={item?.icon}
        onPick={async (icon) => {
          await save(item, icon);
          setItem(null);
        }}
        onClose={() => setItem(null)}
      />
    </PickContext.Provider>
  );
}

// item: {path, name, icon, fallback}; `compact`: a one-line row (the folder tree)
export function RowIconButton({item, compact = false}) {
  const pick = useContext(PickContext);
  if (!pick) return null;
  return (
    <button
      type="button"
      className={`${styles.rowIconButton} ${compact ? styles.rowIconCompact : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pick(item);
      }}
      title={item.icon ? 'Change icon' : 'Set an icon'}
      aria-label={`${item.icon ? 'Change the icon of' : 'Set an icon for'} ${item.name}`}>
      <IconButtonGlyph size={14} />
    </button>
  );
}
