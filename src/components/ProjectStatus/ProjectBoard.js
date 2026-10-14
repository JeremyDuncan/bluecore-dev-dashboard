// GitHub Projects (v2) board: one column per Status, with filters. Live when the MCP container
// is reachable, otherwise the snapshot from the last sync.
import React, {useMemo, useState} from 'react';
import {Label, LiveBadge, Select, matchesText, unique, useLiveData} from './shared';
import styles from './styles.module.css';

const DONE_LIMIT = 30;

function Card({item}) {
  const ref = item.repo && item.number ? `${item.repo} #${item.number}` : item.kind === 'draft' ? 'Draft' : '';
  return (
    <li className={styles.card}>
      <div className={styles.cardMeta}>
        {item.kind === 'pr' && <span className={styles.kind}>PR</span>}
        {ref}
      </div>
      {item.url ? (
        <a className={styles.cardTitle} href={item.url}>
          {item.title}
        </a>
      ) : (
        <span className={styles.cardTitle}>{item.title}</span>
      )}
      {item.labels.length > 0 && (
        <div className={styles.labels}>
          {item.labels.map((l) => (
            <Label key={l.name} {...l} />
          ))}
        </div>
      )}
      {(item.assignees.length > 0 || item.subIssues || item.milestone) && (
        <div className={styles.cardFooter}>
          {item.assignees.length > 0 && <span>{item.assignees.map((a) => `@${a}`).join(', ')}</span>}
          {item.subIssues && (
            <span title="Sub-issues done">
              ☑ {item.subIssues.completed}/{item.subIssues.total}
            </span>
          )}
          {item.milestone && <span>⚑ {item.milestone}</span>}
        </div>
      )}
    </li>
  );
}

function Column({name, items, collapsible}) {
  const [showAll, setShowAll] = useState(false);
  const shown = collapsible && !showAll ? items.slice(0, DONE_LIMIT) : items;
  return (
    <section className={styles.column} aria-label={`${name}: ${items.length} items`}>
      <header className={styles.columnHeader}>
        <span>{name}</span>
        <span className={styles.count}>{items.length}</span>
      </header>
      <ul className={styles.cards}>
        {shown.map((item, i) => (
          <Card key={item.url ?? `${item.title}-${i}`} item={item} />
        ))}
      </ul>
      {shown.length < items.length && (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          Show {items.length - shown.length} older items
        </button>
      )}
      {items.length === 0 && <p className={styles.empty}>Nothing here</p>}
    </section>
  );
}

export default function ProjectBoard({snapshot, apiPath}) {
  const {data, live, error} = useLiveData(snapshot, apiPath);
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState('');
  const [assignee, setAssignee] = useState('');
  const [label, setLabel] = useState('');
  const [showDone, setShowDone] = useState(false);

  const filters = useMemo(
    () => ({
      repos: unique(data.items.map((i) => i.repo)),
      assignees: unique(data.items.flatMap((i) => i.assignees)),
      labels: unique(data.items.flatMap((i) => i.labels.map((l) => l.name))),
    }),
    [data],
  );

  const items = data.items.filter(
    (i) =>
      matchesText(`${i.title} ${i.repo ?? ''} ${i.number ?? ''}`, query) &&
      (!repo || i.repo === repo) &&
      (!assignee || i.assignees.includes(assignee)) &&
      (!label || i.labels.some((l) => l.name === label)),
  );

  const columns = [...data.statuses.map((s) => s.name), null]
    .map((name) => {
      let colItems = items.filter((i) => i.status === name);
      if (name === 'Done') {
        colItems = colItems.sort((a, b) => (b.closedAt ?? b.updatedAt ?? '').localeCompare(a.closedAt ?? a.updatedAt ?? ''));
      }
      return {name: name ?? 'No status', items: colItems};
    })
    .filter((c) => c.name !== 'No status' || c.items.length > 0);

  const visible = columns.filter((c) => showDone || c.name !== 'Done');
  const doneCount = columns.find((c) => c.name === 'Done')?.items.length ?? 0;

  return (
    <div className={styles.wrapper}>
      <LiveBadge live={live} error={error} fetchedAt={data.fetchedAt} sourceUrl={data.url} sourceLabel="Open the board in GitHub" />

      <ul className={styles.summary} aria-label="Items per status">
        {columns.map((c) => (
          <li key={c.name}>
            <strong>{c.items.length}</strong> {c.name}
          </li>
        ))}
      </ul>

      <div className={styles.filters}>
        <label className={styles.filter}>
          <span>Search</span>
          <input type="search" value={query} placeholder="Title, repo or #" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Select label="Repository" value={repo} onChange={setRepo} options={filters.repos} />
        <Select label="Assignee" value={assignee} onChange={setAssignee} options={filters.assignees} />
        <Select label="Label" value={label} onChange={setLabel} options={filters.labels} />
        <label className={styles.toggle}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show Done ({doneCount})
        </label>
      </div>

      <div className={styles.board}>
        {visible.map((c) => (
          <Column key={c.name} name={c.name} items={c.items} collapsible={c.name === 'Done'} />
        ))}
      </div>
    </div>
  );
}
