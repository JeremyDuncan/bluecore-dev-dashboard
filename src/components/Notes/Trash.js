// Trash (?trash on the Notes page): deleted notes, with where they came from. Restore puts one back;
// Delete forever erases it (after a confirmation). Obsidian shows the same .trash folder.
import React, {useCallback, useEffect, useState} from 'react';
import Link from '@docusaurus/Link';
import ConfirmDialog from './ConfirmDialog';
import {useNotesApi} from './api';
import {ArrowLeftIcon, FolderIcon, NoteIcon, TrashIcon} from './icons';
import styles from './styles.module.css';

// `refreshKey`: reloads when it changes (e.g. the number of notes, after a delete)
export function useTrash(refreshKey) {
  const {call} = useNotesApi();
  const [items, setItems] = useState(null);
  const reload = useCallback(() => call('/trash').then((d) => setItems(d.items), () => setItems([])), [call]);
  useEffect(() => {
    reload();
    window.addEventListener('notes-changed', reload);
    return () => window.removeEventListener('notes-changed', reload);
  }, [reload, refreshKey]);
  return {items, reload};
}

export default function Trash({url, list, flash}) {
  const {call} = useNotesApi();
  const {items, reload} = useTrash();
  const [purging, setPurging] = useState(null);
  const [error, setError] = useState(null);

  const restore = async (item) => {
    setError(null);
    try {
      const {restored} = await call('/trash/restore', {method: 'POST', body: {name: item.name}});
      await Promise.all([reload(), list.reload()]);
      flash(
        <>
          Restored “{item.title}” to {restored.includes('/') ? restored.slice(0, restored.lastIndexOf('/')) : 'the top level'}.{' '}
          {item.note && <Link to={url.href({note: restored, trash: null}, {keep: false})}>Open it</Link>}
        </>,
      );
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className={styles.trash}>
      <h1 className={styles.withIcon}>
        <TrashIcon size={28} /> Trash
      </h1>
      <p className={styles.lead}>
        Notes you deleted, newest first. <strong>Restore</strong> puts one back where it was. This is the vault's <code>.trash</code> folder, which Obsidian shows
        too.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {items == null ? (
        <p className={styles.empty}>Loading…</p>
      ) : !items.length ? (
        <p className={styles.empty}>The trash is empty.</p>
      ) : (
        <ul className={styles.trashList}>
          {items.map((item) => (
            <li key={item.name} className={styles.trashItem}>
              <NoteIcon size={18} />
              <div className={styles.trashText}>
                <strong>{item.title}</strong>
                <span className={styles.rowMeta}>
                  <span className={styles.metaItem}>
                    <FolderIcon size={12} />
                    {item.from ? (item.from.includes('/') ? item.from.slice(0, item.from.lastIndexOf('/')) : 'Top level') : 'Unknown (restores to the top level)'}
                  </span>
                  <span className={styles.metaItem}>
                    <TrashIcon size={12} />
                    {new Date(item.deleted).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}
                  </span>
                </span>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => restore(item)}>
                <ArrowLeftIcon /> Restore
              </button>
              <button type="button" className={`${styles.iconButton} ${styles.danger}`} onClick={() => setPurging(item)} aria-label={`Delete ${item.title} forever`}>
                <TrashIcon />
                <span className={styles.iconButtonLabel}>Delete forever</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(purging)}
        title={`Delete “${purging?.title}” forever?`}
        confirmLabel="Delete forever"
        busyLabel="Deleting…"
        onCancel={() => setPurging(null)}
        onConfirm={async () => {
          await call('/trash/purge', {method: 'POST', body: {name: purging.name}});
          setPurging(null);
          await reload();
        }}
      >
        <p>This erases the file from the vault. It can't be undone here or in Obsidian.</p>
      </ConfirmDialog>
    </div>
  );
}
