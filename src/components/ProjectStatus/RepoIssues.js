// Open issues across the org's repos, grouped by repo, with filters. Live when the MCP container
// is reachable, otherwise the snapshot from the last sync.
import React, {useMemo, useState} from 'react';
import {Label, LiveBadge, Select, matchesText, unique, useLiveData} from './shared';
import styles from './styles.module.css';

const day = (iso) => new Date(iso).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});

export default function RepoIssues({snapshot, apiPath}) {
  const {data, live, error, refresh, refreshing} = useLiveData(snapshot, apiPath);
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState('');
  const [label, setLabel] = useState('');
  const [assignee, setAssignee] = useState('');

  const filters = useMemo(
    () => ({
      repos: data.repos.filter((r) => r.issues.length).map((r) => r.name),
      labels: unique(data.repos.flatMap((r) => r.issues.flatMap((i) => i.labels.map((l) => l.name)))),
      assignees: unique(data.repos.flatMap((r) => r.issues.flatMap((i) => i.assignees))),
    }),
    [data],
  );

  const repos = data.repos
    .filter((r) => !repo || r.name === repo)
    .map((r) => ({
      ...r,
      issues: r.issues.filter(
        (i) =>
          matchesText(`${i.title} #${i.number}`, query) &&
          (!label || i.labels.some((l) => l.name === label)) &&
          (!assignee || i.assignees.includes(assignee)),
      ),
    }))
    .filter((r) => r.issues.length > 0);
  const total = repos.reduce((n, r) => n + r.issues.length, 0);

  return (
    <div className={styles.wrapper}>
      <LiveBadge
        live={live}
        error={error}
        refresh={refresh}
        refreshing={refreshing}
        fetchedAt={data.fetchedAt}
        sourceUrl={`https://github.com/orgs/${data.org}/repositories`}
        sourceLabel="Repositories in GitHub"
      />

      <div className={styles.filters}>
        <label className={styles.filter}>
          <span>Search</span>
          <input type="search" value={query} placeholder="Title or #" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Select label="Repository" value={repo} onChange={setRepo} options={filters.repos} />
        <Select label="Label" value={label} onChange={setLabel} options={filters.labels} />
        <Select label="Assignee" value={assignee} onChange={setAssignee} options={filters.assignees} />
      </div>

      <p className={styles.total}>
        <strong>{total}</strong> open {total === 1 ? 'issue' : 'issues'} in <strong>{repos.length}</strong>{' '}
        {repos.length === 1 ? 'repository' : 'repositories'}
      </p>

      {repos.map((r) => (
        <section key={r.name} className={styles.repo}>
          <header className={styles.repoHeader}>
            <a href={`${r.url}/issues`} className={styles.repoName}>
              {r.name}
            </a>
            <span className={styles.count}>{r.issues.length}</span>
          </header>
          <ul className={styles.issues}>
            {r.issues.map((i) => (
              <li key={i.number} className={styles.issue}>
                <div className={styles.issueMain}>
                  <a href={i.url} className={styles.issueTitle}>
                    {i.title}
                  </a>
                  {i.labels.map((l) => (
                    <Label key={l.name} {...l} />
                  ))}
                </div>
                <div className={styles.issueMeta} suppressHydrationWarning>
                  #{i.number} · updated {day(i.updatedAt)}
                  {i.assignees.length > 0 && ` · ${i.assignees.map((a) => `@${a}`).join(', ')}`}
                  {i.milestone && ` · ⚑ ${i.milestone}`}
                  {i.comments > 0 && ` · 💬 ${i.comments}`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {total === 0 && <p className={styles.empty}>No open issues match these filters.</p>}
    </div>
  );
}
