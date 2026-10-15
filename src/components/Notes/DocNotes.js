// On a docs page: your notes that link to it, and a way to start one about it. Only when the notes
// API answers (the site running locally), so the public site shows nothing.
import React, {useEffect, useState} from 'react';
import Link from '@docusaurus/Link';
import {useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useNotesApi} from './api';
import {NoteIcon, PlusIcon} from './icons';
import styles from './styles.module.css';

export default function DocNotes({title}) {
  const {enabled, call} = useNotesApi();
  const {pathname} = useLocation();
  const base = useBaseUrl('/');
  const sitePath = `/${pathname.slice(base.length)}`.replace(/\/+$/, '') || '/';
  const [notes, setNotes] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    call(`/doc-links?path=${encodeURIComponent(sitePath)}`).then(
      (d) => !cancelled && setNotes(d.notes),
      () => !cancelled && setNotes(null),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, call, sitePath]);
  if (!notes) return null;
  const about = new URLSearchParams({title: `Notes on ${title}`, link: sitePath, linkTitle: title});
  return (
    <aside className={styles.docNotes} aria-label="Your notes about this page">
      <p className={styles.docNotesTitle}>
        <NoteIcon size={15} /> {notes.length ? `Your notes about this page (${notes.length})` : 'Your notes'}
        <Link to={`/notes?new&${about}`} className={styles.docNotesAdd}>
          <PlusIcon size={13} /> Note about this page
        </Link>
      </p>
      {notes.length > 0 && (
        <ul>
          {notes.map((n) => (
            <li key={n.path}>
              <Link to={`/notes?note=${encodeURIComponent(n.path)}`}>{n.title}</Link>
              {n.excerpt && <span className={styles.docNotesExcerpt}> · {n.excerpt.slice(0, 100)}</span>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
