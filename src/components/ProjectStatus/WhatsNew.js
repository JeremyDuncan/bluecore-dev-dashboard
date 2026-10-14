// "What's New": the latest release of each repo as Updates cards (the Figma product page's
// Updates box), then a timeline of releases. Live when the MCP container is reachable.
import React, {useMemo, useState} from 'react';
import Markdown from '@site/src/components/AskDocs/Markdown';
import {LiveBadge, Select, useLiveData} from './shared';
import styles from './styles.module.css';

const PAGE = 25;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
// "Fix X by @someone in https://…/pull/12" → "Fix X (#12)"
const tidy = (h) => h.replace(/\s+by @\S+ in (https:\/\/\S+\/pull\/(\d+))\s*$/, ' (#$2)').replace(/\s+by @\S+\s*$/, '');

export default function WhatsNew({snapshot, apiPath}) {
  const {data, live, error, refresh, refreshing} = useLiveData(snapshot, apiPath);
  const [repo, setRepo] = useState('');
  const [shown, setShown] = useState(PAGE);

  const latest = useMemo(() => {
    const seen = new Map();
    for (const r of data.releases) if (!r.prerelease && !seen.has(r.repo)) seen.set(r.repo, r);
    return [...seen.values()];
  }, [data]);

  const timeline = data.releases.filter((r) => !repo || r.repo === repo);

  return (
    <div className={styles.wrapper}>
      <LiveBadge live={live} error={error} refresh={refresh} refreshing={refreshing} fetchedAt={data.fetchedAt} />

      <p className={styles.sectionTitle}>Latest versions</p>
      <div className={styles.updatesGrid}>
        {latest.map((r) => (
          <article key={r.repo} className={styles.updates}>
            <p className={styles.updatesRepo}>{r.repo}</p>
            <p className={styles.updatesVersion} suppressHydrationWarning>
              {r.name} · {day(r.publishedAt)}
            </p>
            {r.highlights.length > 0 && (
              <ul>
                {r.highlights.map((h, i) => (
                  <li key={i}>
                    <Markdown text={tidy(h)} />
                  </li>
                ))}
              </ul>
            )}
            <a href={r.url} className={styles.updatesLink}>
              View full release notes
            </a>
          </article>
        ))}
      </div>

      <p className={styles.sectionTitle}>Release timeline</p>
      <div className={styles.filters}>
        <Select label="Repository" value={repo} onChange={(v) => (setRepo(v), setShown(PAGE))} options={latest.map((r) => r.repo).sort()} />
      </div>
      <ol className={styles.timeline}>
        {timeline.slice(0, shown).map((r) => (
          <li key={`${r.repo}-${r.tag}`} className={styles.release}>
            <div className={styles.releaseDate} suppressHydrationWarning>
              {day(r.publishedAt)}
            </div>
            <div className={styles.releaseMain}>
              <div className={styles.releaseHead}>
                <span className={styles.releaseRepo}>{r.repo}</span>
                <a href={r.url} className={styles.releaseName}>
                  {r.name}
                </a>
                {r.prerelease && <span className={styles.kind}>pre-release</span>}
                {r.author && <span className={styles.releaseAuthor}>by @{r.author}</span>}
              </div>
              {r.body && (
                <details className={styles.releaseNotes}>
                  <summary>Release notes</summary>
                  <Markdown text={r.body} />
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      {shown < timeline.length && (
        <button type="button" className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, timeline.length - shown)} more of {timeline.length - shown}
        </button>
      )}
    </div>
  );
}
