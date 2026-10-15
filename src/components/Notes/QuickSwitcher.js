// ⌘P / Ctrl+P on the Notes page: jump to a note by typing part of its title (letters in order, as
// in Obsidian: "kre" finds "Keycloak realm export"). Enter opens it; no match offers a new note.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FolderIcon, NoteIcon, PlusIcon, SearchIcon} from './icons';
import styles from './styles.module.css';

// Higher is better; null when the letters aren't all there in order
function score(title, query) {
  const t = title.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 600 - at - t.length / 10;
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q.replace(/ /g, '')) {
    const found = t.indexOf(ch, i);
    if (found < 0) return null;
    if (last >= 0) gaps += found - last - 1;
    // A letter that starts a word counts for more
    if (found === 0 || /[\s\-_/]/.test(t[found - 1])) gaps -= 2;
    last = found;
    i = found + 1;
  }
  return 300 - gaps - t.length / 10;
}

export default function QuickSwitcher({open, notes, onOpen, onCreate, onClose}) {
  const ref = useRef(null);
  const listRef = useRef(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQ('');
      setActive(0);
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const matches = useMemo(() => {
    if (!q.trim()) return [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10); // recent first
    return notes
      .map((n) => ({n, s: Math.max(score(n.title, q) ?? -Infinity, ...(n.aliases ?? []).map((a) => (score(a, q) ?? -Infinity) - 5))}))
      .filter((x) => x.s > -Infinity)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.n);
  }, [notes, q]);
  const exact = matches.some((n) => n.title.toLowerCase() === q.trim().toLowerCase());
  const options = [...matches.map((note) => ({note})), ...(q.trim() && !exact ? [{create: q.trim()}] : [])];
  useEffect(() => {
    setActive(0);
  }, [q]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const choose = (opt) => {
    if (!opt) return;
    if (opt.create) onCreate(opt.create);
    else onOpen(opt.note.path);
  };

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles.switcher}`}
      aria-label="Jump to a note"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className={styles.switcherBody}>
          <div className={styles.switcherInputRow}>
            <SearchIcon size={16} />
            <input
              className={styles.switcherInput}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(options.length, 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(options[active]);
                }
              }}
              placeholder="Jump to a note…"
              aria-label="Note title"
              role="combobox"
              aria-expanded="true"
              aria-controls="switcher-options"
              aria-activedescendant={options.length ? `switcher-${active}` : undefined}
              autoFocus
            />
            <kbd className={styles.kbd}>Esc</kbd>
          </div>
          <ul ref={listRef} id="switcher-options" className={styles.switcherList} role="listbox">
            {options.map((opt, i) => (
              <li
                key={opt.note?.path ?? 'create'}
                id={`switcher-${i}`}
                role="option"
                aria-selected={i === active}
                className={`${styles.pickerOption} ${i === active ? styles.pickerActive : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {opt.create ? (
                  <>
                    <PlusIcon size={15} />
                    <span>
                      Create note “<strong>{opt.create}</strong>”
                    </span>
                  </>
                ) : (
                  <>
                    <NoteIcon size={15} />
                    <span className={styles.pickerTitle}>{opt.note.title}</span>
                    {opt.note.folder && (
                      <span className={styles.pickerFolder}>
                        <FolderIcon size={11} /> {opt.note.folder}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
            {!options.length && <li className={styles.pickerEmpty}>No notes yet</li>}
          </ul>
          <p className={styles.switcherHint}>
            <kbd className={styles.kbd}>↑</kbd> <kbd className={styles.kbd}>↓</kbd> to choose · <kbd className={styles.kbd}>Enter</kbd> to open
            {!q.trim() && ' · recent notes shown'}
          </p>
        </div>
      )}
    </dialog>
  );
}
