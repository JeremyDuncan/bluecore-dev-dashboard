// "Delete notes?" confirmation: names the notes, warns about links to them, and explains that they
// go to the vault's trash (restorable from the Trash page or Obsidian).
import React from 'react';
import ConfirmDialog from './ConfirmDialog';
import {useNotesApi} from './api';
import styles from './styles.module.css';

// notes: [{path, title, backlinks?}] to delete, or null when closed. onDeleted(paths) after success.
export default function ConfirmDelete({notes, onCancel, onDeleted}) {
  const {call} = useNotesApi();
  const open = Boolean(notes?.length);
  const one = notes?.length === 1 ? notes[0] : null;
  const linked = one?.backlinks?.length ?? 0;
  return (
    <ConfirmDialog
      open={open}
      title={one ? `Delete “${one.title}”?` : `Delete ${notes?.length} notes?`}
      confirmLabel={one ? 'Delete note' : `Delete ${notes?.length} notes`}
      busyLabel="Deleting…"
      onCancel={onCancel}
      onConfirm={async () => {
        const {deleted} = await call('/delete', {method: 'POST', body: {paths: notes.map((n) => n.path)}});
        onDeleted(deleted);
      }}
    >
      {open && !one && (
        <ul className={styles.dialogList}>
          {notes.slice(0, 5).map((n) => (
            <li key={n.path}>{n.title}</li>
          ))}
          {notes.length > 5 && <li>and {notes.length - 5} more</li>}
        </ul>
      )}
      {open && (
        <p>
          {one ? 'It moves' : 'They move'} to the trash, where you can restore {one ? 'it' : 'them'} (<strong>Trash</strong> at the bottom of the notes list, or Obsidian's
          Trash). Images {one ? 'it embeds' : 'they embed'} stay where they are.
        </p>
      )}
      {linked > 0 && (
        <p className={styles.warning}>
          {linked} {linked === 1 ? 'note links' : 'notes link'} to it. Those links will point to a missing note.
        </p>
      )}
    </ConfirmDialog>
  );
}
