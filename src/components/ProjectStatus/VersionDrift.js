// Version drift: does the stack run the latest release of each service, and does each service use
// the latest shared library (bluecore-models)? One card per row, colored by status. Live when the MCP
// container is reachable, otherwise the snapshot from the last sync (mcp/drift.mjs builds the data).
import React from 'react';
import {LiveBadge, useLiveData} from './shared';
import styles from './styles.module.css';

const STATUS = {ok: ['success', 'current'], warning: ['warning', 'check'], behind: ['failure', 'behind'], unknown: ['cancelled', 'unknown']};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}) : '?');

function Status({status}) {
  const [tone, label] = STATUS[status] ?? STATUS.unknown;
  return <span className={`${styles.pill} ${styles[`pill_${tone}`] ?? ''}`}>{label}</span>;
}

function ServiceCard({s}) {
  // The service uses an older (or a different) bluecore-models than it should
  const modelDrift = s.libraries?.some((lib) => lib.behind || lib.mismatch);
  return (
    <li className={`${styles.driftCard} ${styles[`drift_${s.status}`] ?? ''}`}>
      <div className={styles.driftHead}>
        <strong className={styles.driftName}>{s.name}</strong>
        <span className={styles.driftTags}>
          {modelDrift && <span className={`${styles.pill} ${styles.pill_failure}`}>Model Drift</span>}
          <Status status={s.status} />
        </span>
      </div>
      <p className={styles.driftSummary}>{s.summary}</p>
      <p className={styles.driftFacts}>
        <span>
          Latest release: {s.release ? <a href={s.release.url}>{s.release.tag}</a> : 'none'}
          {s.release && <span suppressHydrationWarning> ({day(s.release.publishedAt)})</span>}
        </span>
        <span>
          Stack uses: <code>{s.image ?? '?'}</code>
        </span>
        <span suppressHydrationWarning>Image built: {day(s.imageBuiltAt)}</span>
        {s.publish && (
          <span>
            Last publish: <a href={s.publish.url}>{s.publish.conclusion ?? s.publish.status}</a>
          </span>
        )}
        {s.libraries?.map((lib) => (
          <span key={lib.name}>
            {lib.name}:{' '}
            <strong className={lib.mismatch || lib.behind ? styles.badText : undefined}>{lib.version ?? '?'}</strong>
            {lib.mismatch ? ' (differs from the other services)' : lib.behind ? ` (latest ${lib.latest})` : ''}
          </span>
        ))}
        {s.unreleased?.count > 0 && !s.imageTracksBranch && (
          <span>
            <a href={s.unreleased.url}>
              {s.unreleased.count} unreleased commit{s.unreleased.count === 1 ? '' : 's'} on {s.branch}
            </a>
          </span>
        )}
      </p>
      {s.unreleased?.count > 0 && !s.imageTracksBranch && (
        <ul className={styles.driftCommits}>
          {s.unreleased.commits.map((c) => (
            <li key={c.sha}>
              <code>{c.sha}</code> {c.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Joins React nodes: "a", "a and b", "a, b and c"
function joinNodes(nodes) {
  return nodes.flatMap((node, i) => [i === 0 ? '' : i === nodes.length - 1 ? ' and ' : ', ', node]);
}

// How a service appears on the models card: the image the stack runs and that image's release,
// e.g. `bluecore_api:latest (v0.35.2)`
function imageLabel(u, services) {
  const svc = services.find((x) => x.repo === u.repo);
  const image = svc?.image?.split('/').pop() ?? u.repo;
  return `${image}${u.releaseTag ? ` (${u.releaseTag})` : ''}`;
}

// Which version each service uses: "`a` and `b` are using 0.36.0", or per service when they differ:
// "`a` is using 0.36.0, `b` is using 0.35.2". Only the version is red.
function Usage({users, services}) {
  const known = users.filter((u) => u.version);
  const code = (u) => <code key={u.repo}>{imageLabel(u, services)}</code>;
  const version = (v) => <strong className={styles.badText}>{v}</strong>;
  if (new Set(known.map((u) => u.version)).size > 1) {
    return known.map((u, i) => (
      <React.Fragment key={u.repo}>
        {i > 0 && ', '}
        {code(u)} is using {version(u.version)}
      </React.Fragment>
    ));
  }
  return (
    <>
      {joinNodes(known.map(code))} {known.length === 1 ? 'is' : 'are'} using {version(known[0]?.version)}
    </>
  );
}

function LibraryCard({l, services}) {
  // Only when something is out of date: which version the services use
  const outdated = l.status !== 'ok' && l.users?.some((u) => u.version);
  return (
    <li className={`${styles.driftCard} ${styles[`drift_${l.status}`] ?? ''}`}>
      <div className={styles.driftHead}>
        <strong className={styles.driftName}>{l.name}</strong>
        <Status status={l.status} />
      </div>
      <p className={styles.driftSummary}>
        Latest release, {l.release ? <a href={l.release.url}>{l.release.tag}</a> : 'none yet'}
        {outdated && (
          <>
            <br />
            (<Usage users={l.users} services={services} />)
          </>
        )}
      </p>
      <p className={styles.driftFacts}>
        {l.release && <span suppressHydrationWarning>Released: {day(l.release.publishedAt)}</span>}
        {l.publish && (
          <span suppressHydrationWarning>
            Last publish: <a href={l.publish.url}>{l.publish.conclusion ?? l.publish.status}</a> ({day(l.publish.createdAt)})
          </span>
        )}
      </p>
    </li>
  );
}

export default function VersionDrift({snapshot, apiPath}) {
  const {data, live, error} = useLiveData(snapshot, apiPath);
  const rows = [...data.services, ...data.libraries];
  const off = rows.filter((r) => r.status !== 'ok').length;
  return (
    <div className={styles.wrapper}>
      <LiveBadge live={live} error={error} fetchedAt={data.fetchedAt} sourceUrl={`https://github.com/${data.org}/${data.stackRepo}`} sourceLabel={`${data.stackRepo} in GitHub`} />
      <p className={styles.total}>
        <strong>{off ? `${off} of ${rows.length} need attention` : `All ${rows.length} are current`}</strong>. When something works in its own repo but fails in the stack or the integration tests, check here first.
      </p>

      <p className={styles.sectionTitle}>Services in the stack</p>
      <ul className={styles.driftList}>
        {data.services.map((s) => (
          <ServiceCard key={`${s.repo}-${s.imageVar}`} s={s} />
        ))}
      </ul>

      {data.libraries.length > 0 && (
        <>
          <p className={styles.sectionTitle}>Shared libraries</p>
          <ul className={styles.driftList}>
            {data.libraries.map((l) => (
              <LibraryCard key={l.repo} l={l} services={data.services} />
            ))}
          </ul>
        </>
      )}
      <p className={styles.note}>
        The stack uses each service's <code>:latest</code> image unless an environment variable (e.g. <code>BLUECORE_API_IMAGE</code>) overrides it. Most images are rebuilt only when a release is published, so commits merged after the last release aren't in the stack yet.
      </p>
    </div>
  );
}
