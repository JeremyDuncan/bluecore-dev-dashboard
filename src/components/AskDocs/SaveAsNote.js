// "Save as note" under an answer: keeps the question and answer as a note in your notes vault
// (the Notes page, src/components/Notes). Only shown when the notes server is configured.
import React, {useState} from 'react';
import Link from '@docusaurus/Link';
import {useNotesApi} from '../Notes/api';
import styles from './styles.module.css';

export default function SaveAsNote({question = '', answer, by}) {
  const {enabled, call} = useNotesApi();
  const [state, setState] = useState({status: 'idle'});
  if (!enabled) return null;

  const save = async () => {
    setState({status: 'saving'});
    const title = question.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '').slice(0, 80) || 'Ask the docs answer';
    const quoted = question.trim().split('\n').map((l) => `> ${l}`).join('\n');
    try {
      const note = await call('/note', {
        method: 'POST',
        body: {
          title,
          folder: 'Ask the docs',
          tags: ['ask-the-docs'],
          author: `Ask the docs${by ? ` (${by})` : ''}`,
          body: `${quoted}\n\n${answer.trim()}\n`,
        },
      });
      setState({status: 'saved', path: note.path});
      window.dispatchEvent(new Event('notes-changed')); // an open Notes page shows it now
    } catch (err) {
      setState({status: 'error', error: err.message});
    }
  };

  return (
    <p className={styles.saveNote}>
      {state.status === 'saved' ? (
        <>
          ✓ Saved to your notes · <Link to={`/notes?note=${encodeURIComponent(state.path)}`}>Open note</Link>
        </>
      ) : (
        <button type="button" className={styles.textButton} onClick={save} disabled={state.status === 'saving'}>
          {state.status === 'saving' ? 'Saving…' : 'Save as note'}
        </button>
      )}
      {state.status === 'error' && <span className={styles.saveNoteError}> Couldn't save: {state.error}</span>}
    </p>
  );
}
