// "Delete notes?" confirmation: names the notes (and selected folders), warns about links to them, and
// explains that notes go to the vault's trash (restorable from the Trash page or Obsidian).
import React from 'react';
import ConfirmDialog from './ConfirmDialog';
import {useNotesApi} from './api';
import styles from './styles.module.css';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// notes: [{path, title, backlinks?}] to delete, or null when closed; folders: folder paths selected with
// them, deleted once empty. onDeleted(paths, keptFolders) after success.
export default function ConfirmDelete({notes, folders = [], onCancel, onDeleted}) {
  const {call} = useNotesApi();
  const list = notes ?? [];
  const dirs = folders ?? [];
  const open = Boolean(list.length || dirs.length);
  const one = list.length === 1 && !dirs.length ? list[0] : null;
  const oneFolder = !list.length && dirs.length === 1 ? dirs[0] : null;
  // The warning follows the one selected note, also when folders are selected with it (`one` is only for the labels)
  const linked = list.length === 1 ? (list[0].backlinks?.length ?? 0) : 0;
  const what = [list.length && count(list.length, 'note'), dirs.length && count(dirs.length, 'folder')].filter(Boolean).join(' and ');
  return (
    <ConfirmDialog
      open={open}
      title={one ? `Delete “${one.title}”?` : oneFolder ? `Delete the folder “${oneFolder.split('/').pop()}”?` : `Delete ${what}?`}
      confirmLabel={one ? 'Delete note' : oneFolder ? 'Delete folder' : `Delete ${what}`}
      busyLabel="Deleting…"
      onCancel={onCancel}
      onConfirm={async () => {
        const {deleted, foldersKept} = await call('/delete', {method: 'POST', body: {paths: list.map((n) => n.path), folders: dirs}});
        onDeleted(deleted, foldersKept);
      }}
    >
      {open && !one && !oneFolder && (
        <ul className={styles.dialogList}>
          {[...dirs.map((f) => `${f}/`), ...list.map((n) => n.title)].slice(0, 5).map((t) => (
            <li key={t}>{t}</li>
          ))}
          {list.length + dirs.length > 5 && <li>and {list.length + dirs.length - 5} more</li>}
        </ul>
      )}
      {open && list.length > 0 && (
        <p>
          {one ? 'It moves' : 'The notes move'} to the trash, where you can restore {one ? 'it' : 'them'} (<strong>Trash</strong> at the bottom of the notes list, or
          Obsidian's Trash). Images {one ? 'it embeds' : 'they embed'} stay where they are.
        </p>
      )}
      {open && dirs.length > 0 && <p>{dirs.length === 1 ? 'The folder is' : 'The folders are'} removed once empty; a folder that still holds anything you didn't select is kept.</p>}
      {linked > 0 && (
        <p className={styles.warning}>
          {linked} {linked === 1 ? 'note links' : 'notes link'} to {one ? 'it' : `“${list[0].title}”`}. Those links will point to a missing note.
        </p>
      )}
    </ConfirmDialog>
  );
}
