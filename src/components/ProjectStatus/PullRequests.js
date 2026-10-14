// Open pull requests across the org's repos: what's waiting for review, what's stuck, what's ready
// to merge. Oldest first. Live when the MCP container is reachable, otherwise the snapshot from the
// last sync (mcp/pulls.mjs builds the data).
import React, {useMemo, useState} from 'react';
import {Label, LiveBadge, Select, matchesText, unique, useLiveData} from './shared';
import styles from './styles.module.css';

const REVIEW_TONE = {approved: 'success', 'changes requested': 'failure', 'needs review': 'running', draft: 'cancelled'};
const CI_TONE = {passing: 'success', failing: 'failure', running: 'running'};
const days = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

function Pill({tone, children}) {
  return <span className={`${styles.pill} ${tone ? styles[`pill_${tone}`] ?? '' : ''}`}>{children}</span>;
}

export default function PullRequests({snapshot, apiPath}) {
  const {data, live, error, refresh, refreshing} = useLiveData(snapshot, apiPath);
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState('');
  const [author, setAuthor] = useState('');
  const [review, setReview] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);

  const filters = useMemo(() => ({repos: unique(data.pulls.map((p) => p.repo)), authors: unique(data.pulls.map((p) => p.author))}), [data]);
  const open = data.pulls.filter((p) => !p.draft);
  const counts = {
    waiting: open.filter((p) => p.review === 'needs review').length,
    changes: open.filter((p) => p.review === 'changes requested').length,
    ready: open.filter((p) => p.review === 'approved' && p.ci === 'passing' && !p.conflicts).length,
    stale: open.filter((p) => p.stale).length,
  };

  const list = data.pulls.filter(
    (p) =>
      (showDrafts || !p.draft || review === 'draft') &&
      (!staleOnly || p.stale) &&
      (!repo || p.repo === repo) &&
      (!author || p.author === author) &&
      (!review || p.review === review) &&
      matchesText(`${p.title} ${p.repo} ${p.author} ${p.branch}`, query),
  );

  return (
    <div className={styles.wrapper}>
      <LiveBadge live={live} error={error} refresh={refresh} refreshing={refreshing} fetchedAt={data.fetchedAt} sourceUrl={`https://github.com/pulls?q=is%3Aopen+is%3Apr+org%3A${data.org}`} sourceLabel="Open PRs in GitHub" />

      <ul className={styles.summary} aria-label="Pull requests by status">
        <li>
          <button type="button" className={styles.summaryButton} onClick={() => (setReview('needs review'), setStaleOnly(false))}>
            <strong>{counts.waiting}</strong> waiting for review
          </button>
        </li>
        <li>
          <button type="button" className={styles.summaryButton} onClick={() => (setReview('changes requested'), setStaleOnly(false))}>
            <strong>{counts.changes}</strong> changes requested
          </button>
        </li>
        <li>
          <button type="button" className={styles.summaryButton} onClick={() => (setReview('approved'), setStaleOnly(false))}>
            <strong>{counts.ready}</strong> ready to merge
          </button>
        </li>
        <li>
          <button type="button" className={styles.summaryButton} onClick={() => (setReview(''), setStaleOnly(true))}>
            <strong>{counts.stale}</strong> stale ({data.staleDays}+ days idle)
          </button>
        </li>
      </ul>

      <div className={styles.filters}>
        <label className={styles.filter}>
          <span>Search</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, repo, author, branch" />
        </label>
        <Select label="Repository" value={repo} onChange={setRepo} options={filters.repos} />
        <Select label="Author" value={author} onChange={setAuthor} options={filters.authors} />
        <Select label="Review" value={review} onChange={setReview} options={['needs review', 'changes requested', 'approved', 'draft']} />
        <label className={styles.toggle}>
          <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
          Stale only
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={showDrafts} onChange={(e) => setShowDrafts(e.target.checked)} />
          Show drafts ({data.pulls.length - open.length})
        </label>
      </div>

      <p className={styles.total}>
        {list.length} of {data.pulls.length} pull requests · oldest first
      </p>
      {list.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pull request</th>
                <th>Review</th>
                <th>CI</th>
                <th>Age</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={`${p.repo}#${p.number}`} className={p.stale ? styles.staleRow : undefined}>
                  <td>
                    <a href={p.url}>{p.title}</a>
                    <span className={styles.suiteKind}>
                      {p.repo}#{p.number} · @{p.author}
                      {p.conflicts && <strong className={styles.warnText}> · merge conflicts</strong>}
                    </span>
                    {p.labels.length > 0 && (
                      <span className={styles.labels}>
                        {p.labels.map((l) => (
                          <Label key={l.name} {...l} />
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <Pill tone={REVIEW_TONE[p.review]}>{p.review}</Pill>
                    {p.reviewers.length > 0 && <span className={styles.suiteKind}>waiting on {p.reviewers.map((r) => `@${r}`).join(', ')}</span>}
                  </td>
                  <td>{p.ci ? <Pill tone={CI_TONE[p.ci]}>{p.ci}</Pill> : '–'}</td>
                  <td>
                    {days(p.ageDays)}
                    <span className={styles.suiteKind}>
                      {p.stale ? <strong className={styles.warnText}>idle {days(p.idleDays)}</strong> : `updated ${p.idleDays ? `${days(p.idleDays)} ago` : 'today'}`}
                    </span>
                  </td>
                  <td>
                    <span className={styles.added}>+{p.size.additions}</span> <span className={styles.removed}>−{p.size.deletions}</span>
                    <span className={styles.suiteKind}>{p.size.files} files</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>No pull requests match these filters.</p>
      )}
    </div>
  );
}
