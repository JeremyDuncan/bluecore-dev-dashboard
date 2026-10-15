// Adds a notice at the top of pages whose source hasn't changed in over a year, so stale
// docs stand out. The date comes from last_update (set by the sync) or the file's history.
import React from 'react';
import Content from '@theme-original/DocItem/Content';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import DocNotes from '@site/src/components/Notes/DocNotes';
import styles from './styles.module.css';

const STALE_AFTER_DAYS = 365;
// Docusaurus's stand-in date when it skips git history (dev mode): not a real date
const PLACEHOLDER_TIMESTAMP = 1539502055000;

export default function ContentWrapper(props) {
  const {metadata} = useDoc();
  const updated = metadata.lastUpdatedAt === PLACEHOLDER_TIMESTAMP ? null : metadata.lastUpdatedAt;
  const ageDays = updated ? (Date.now() - updated) / 86400000 : 0;
  return (
    <>
      {ageDays > STALE_AFTER_DAYS && (
        <p className={styles.stale} suppressHydrationWarning>
          <strong>Possibly out of date:</strong> last updated{' '}
          {new Date(updated).toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'})}
          {metadata.lastUpdatedBy ? ` by ${metadata.lastUpdatedBy}` : ''}, over {Math.floor(ageDays / 365)}{' '}
          {Math.floor(ageDays / 365) === 1 ? 'year' : 'years'} ago.
        </p>
      )}
      <Content {...props} />
      {/* Your notes that link to this page (local only: needs the notes API) */}
      <DocNotes title={metadata.title} />
    </>
  );
}
