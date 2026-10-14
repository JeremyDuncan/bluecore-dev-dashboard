// Test health for a GitHub Actions workflow (the integration suite, or a repo's own tests with
// kind="repo"): headline numbers, a run chart, where failures happen, what triggers runs, the
// most-failing tests and recent runs.
// Live when the MCP container is reachable, otherwise the snapshot from the last sync.
import React, {useMemo, useState} from 'react';
import {ciMetrics, failureStage, formatDuration, triggerName} from '@site/mcp/ci-metrics.mjs';
import {LiveBadge, useLiveData} from './shared';
import styles from './styles.module.css';

const OUTCOME = {success: 'var(--bc-ok)', failure: 'var(--bc-error)', cancelled: 'var(--bc-stone)'};
const when = (iso) => new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);

function Kpi({label, value, sub, tone}) {
  return (
    <div className={`${styles.kpi} ${tone ? styles[`kpi_${tone}`] : ''}`}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

function Pill({conclusion, status}) {
  const label = status !== 'completed' ? status.replace('_', ' ') : conclusion;
  return <span className={`${styles.pill} ${styles[`pill_${status !== 'completed' ? 'running' : conclusion}`] ?? ''}`}>{label}</span>;
}

// One bar per run (oldest → newest): height = duration, color = result
function RunChart({runs}) {
  const list = [...runs].reverse();
  const W = 760;
  const H = 150;
  const max = Math.max(60, ...list.map((r) => r.durationSec ?? 0));
  const bw = W / Math.max(list.length, 1);
  return (
    <figure className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Duration and result of the last ${list.length} runs`}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1="0" x2={W} y1={H - f * H} y2={H - f * H} className={styles.gridLine} />
            <text x="2" y={H - f * H - 3} className={styles.axisText}>
              {formatDuration(Math.round(f * max))}
            </text>
          </g>
        ))}
        {list.map((r, i) => {
          const h = r.durationSec ? Math.max(3, (r.durationSec / max) * H) : 3;
          return (
            <a key={r.id} href={r.url}>
              <rect x={i * bw + 1} y={H - h} width={Math.max(bw - 2, 1)} height={h} rx="1.5" fill={OUTCOME[r.conclusion] ?? 'var(--bc-accent-blue)'}>
                <title>
                  {`#${r.number} ${r.status === 'completed' ? r.conclusion : r.status} · ${when(r.createdAt)} · ${formatDuration(r.durationSec)} · ${triggerName(r)}` +
                    (r.pr ? ` · ${r.pr.repo} #${r.pr.number}${r.pr.title ? ` ${r.pr.title}` : ''}` : '') +
                    (r.tests ? ` · tests ${r.tests.passed}✓ ${r.tests.failed}✗` : '') +
                    (r.conclusion === 'failure' ? ` · failed in ${failureStage(r)}` : '')}
                </title>
              </rect>
            </a>
          );
        })}
        <text x="0" y={H + 14} className={styles.axisText}>
          {list[0] && when(list[0].createdAt)}
        </text>
        <text x={W} y={H + 14} textAnchor="end" className={styles.axisText}>
          {list.length > 0 && when(list[list.length - 1].createdAt)}
        </text>
      </svg>
      <figcaption className={styles.legend}>
        <span>
          <i style={{background: OUTCOME.success}} /> passed
        </span>
        <span>
          <i style={{background: OUTCOME.failure}} /> failed
        </span>
        <span>
          <i style={{background: OUTCOME.cancelled}} /> cancelled
        </span>
        <span>Bar height = run time. Hover for details, click to open the run.</span>
      </figcaption>
    </figure>
  );
}

// Horizontal bars: label, count, share
function Bars({rows, color}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={styles.bars}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className={styles.barLabel}>{r.label}</span>
          <span className={styles.barTrack}>
            <span className={styles.barFill} style={{width: `${(r.value / max) * 100}%`, background: r.color ?? color}} />
          </span>
          <span className={styles.barValue}>{r.text ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default function IntegrationTests({snapshot, apiPath, kind = 'integration'}) {
  const {data, live, error, refresh, refreshing} = useLiveData(snapshot, apiPath);
  const m = useMemo(() => ciMetrics(data), [data]);
  const [showAll, setShowAll] = useState(false);

  // Pass rate per trigger (which upstream repo's change started the run)
  const byTrigger = useMemo(() => {
    const t = new Map();
    for (const r of data.runs) {
      if (r.conclusion !== 'success' && r.conclusion !== 'failure') continue;
      const k = triggerName(r);
      const v = t.get(k) ?? {runs: 0, ok: 0};
      v.runs++;
      if (r.conclusion === 'success') v.ok++;
      t.set(k, v);
    }
    return [...t].map(([label, v]) => ({label, value: v.runs, rate: Math.round((v.ok / v.runs) * 100)})).sort((a, b) => b.value - a.value);
  }, [data]);

  const latest = m.latest;
  const trend = m.duration.recentMedianSec && m.duration.earlierMedianSec ? m.duration.recentMedianSec - m.duration.earlierMedianSec : null;
  const tests = showAll ? m.topFailingTests : m.topFailingTests.slice(0, 8);

  return (
    <div className={styles.wrapper}>
      <LiveBadge live={live} error={error} refresh={refresh} refreshing={refreshing} fetchedAt={data.fetchedAt} sourceUrl={`https://github.com/${data.org}/${data.repo}/actions/workflows/${data.workflow}`} sourceLabel="Open in GitHub Actions" />

      <div className={styles.kpis}>
        {latest && (
          <Kpi
            label="Latest run"
            tone={latest.conclusion === 'success' ? 'ok' : latest.conclusion === 'failure' ? 'bad' : undefined}
            value={
              <a href={latest.url}>
                #{latest.number} {latest.status === 'completed' ? latest.conclusion : latest.status.replace('_', ' ')}
              </a>
            }
            sub={`${when(latest.createdAt)} · ${formatDuration(latest.durationSec)}`}
          />
        )}
        <Kpi label="Pass rate" value={pct(m.passRate.window)} sub={`last 7 days ${pct(m.passRate.last7Days)} · last 20 runs ${pct(m.passRate.last20Runs)}`} />
        <Kpi
          label={m.streak.kind === 'success' ? 'Passing streak' : 'Failing streak'}
          tone={m.streak.kind === 'success' ? 'ok' : 'bad'}
          value={`${m.streak.runs} runs`}
          sub={`${m.runsPerDay} runs a day`}
        />
        <Kpi
          label="Median run time"
          value={formatDuration(m.duration.medianSec)}
          sub={`p90 ${formatDuration(m.duration.p90Sec)}${trend !== null ? ` · ${trend <= 0 ? '↓' : '↑'} ${formatDuration(Math.abs(trend))} vs earlier` : ''}`}
        />
        {m.latestTests && (
          <Kpi
            label="Tests (latest results)"
            tone={m.latestTests.failed + m.latestTests.errors ? 'bad' : 'ok'}
            value={`${m.latestTests.passed} passed`}
            sub={`${m.latestTests.failed} failed · ${m.latestTests.skipped} skipped · ${formatDuration(m.latestTests.durationSec)}`}
          />
        )}
        <Kpi label="Time to fix" value={m.recoveryMinutes.median !== null ? `${m.recoveryMinutes.median} min` : '–'} sub={`median, failure → next pass (${m.recoveryMinutes.count})`} />
      </div>

      <p className={styles.sectionTitle}>Last {data.runs.length} runs</p>
      <p className={styles.total}>
        {m.counts.success} passed · {m.counts.failure} failed · {m.counts.cancelled} cancelled{m.counts.inProgress ? ` · ${m.counts.inProgress} running` : ''} — since{' '}
        <span suppressHydrationWarning>{m.window.since && when(m.window.since)}</span> ({m.window.totalRuns} runs in total)
      </p>
      <RunChart runs={data.runs} />

      <div className={styles.twoCol}>
        <section>
          <p className={styles.sectionTitle}>Where failures happen</p>
          {Object.keys(m.failureStages).length ? (
            <Bars
              color="var(--bc-error)"
              rows={Object.entries(m.failureStages)
                .sort((a, b) => b[1] - a[1])
                .map(([label, value]) => ({label, value}))}
            />
          ) : (
            <p className={styles.empty}>No failures.</p>
          )}
          <p className={styles.note}>
            {kind === 'integration'
              ? '“Image build” means a service image (API, Sinopia, …) didn\'t build; “Tests” means the stack ran and tests failed.'
              : '“Lint” and “Type check” fail before any test runs; “Tests” means tests ran and failed; “Setup” means installing dependencies failed.'}
          </p>
        </section>
        <section>
          <p className={styles.sectionTitle}>By trigger</p>
          <Bars
            color="var(--bc-core-blue)"
            rows={byTrigger.map((t) => ({...t, text: `${t.value} runs · ${t.rate}% pass`, color: t.rate < 70 ? 'var(--bc-error)' : t.rate < 90 ? 'var(--bc-warning)' : 'var(--bc-ok)'}))}
          />
          <p className={styles.note}>
            {kind === 'integration'
              ? 'Runs started by a change in another repo (e.g. “sinopia-integration”), by a push, or by hand.'
              : 'What started each run: a push, a pull request, a schedule or a manual run.'}
          </p>
        </section>
      </div>

      <p className={styles.sectionTitle}>Most-failing tests</p>
      <p className={styles.total}>
        From the logs of {m.testsReadFrom} runs · {m.distinctFailingTests} different tests failed · <strong>{m.failingNow} failing now</strong>
      </p>
      {m.topFailingTests.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Test</th>
                <th>Failed</th>
                <th>Status</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.test}>
                  <td>
                    <span className={styles.testArea}>{t.area}</span>
                    <code>{t.test.includes('::') ? t.test.split('::').slice(1).join('::') : t.test}</code>
                  </td>
                  <td>{t.failures}×</td>
                  <td>
                    {t.failingNow ? (
                      <span className={`${styles.pill} ${styles.pill_failure}`}>still failing</span>
                    ) : (
                      <span className={`${styles.pill} ${styles.pill_success}`} suppressHydrationWarning>
                        passing since {t.passedSince ? new Date(t.passedSince).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : '?'}
                      </span>
                    )}
                  </td>
                  <td className={styles.errorCell} title={t.lastMessage}>
                    {t.lastMessage || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>No failing tests in the runs read.</p>
      )}
      {m.topFailingTests.length > 8 && (
        <button type="button" className={styles.more} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${m.topFailingTests.length}`}
        </button>
      )}

      <p className={styles.sectionTitle}>Recent runs</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Run</th>
              <th>Result</th>
              <th>Started</th>
              <th>Time</th>
              <th>Trigger</th>
              <th>Pull request</th>
              <th>Tests</th>
              <th>Failed in</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.slice(0, 15).map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={r.url}>#{r.number}</a>
                </td>
                <td>
                  <Pill conclusion={r.conclusion} status={r.status} />
                </td>
                <td suppressHydrationWarning>{when(r.createdAt)}</td>
                <td>{formatDuration(r.durationSec)}</td>
                <td>{triggerName(r)}</td>
                <td>
                  {r.pr ? (
                    <a href={r.pr.url} title={r.pr.title ?? undefined} className={styles.prCell}>
                      {r.pr.repo} #{r.pr.number}
                      {r.pr.title && <span className={styles.prTitle}>{r.pr.title}</span>}
                    </a>
                  ) : (
                    '–'
                  )}
                </td>
                <td>{r.tests ? `${r.tests.passed}✓ ${r.tests.failed ? `${r.tests.failed}✗` : ''}` : '–'}</td>
                <td>{r.conclusion === 'failure' ? `${failureStage(r)}${r.failedSteps?.length ? `: ${r.failedSteps.join(', ')}` : ''}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
