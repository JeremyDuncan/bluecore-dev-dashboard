// Tests overview: one row per test suite (the integration suite, then each repo's own tests) with its
// latest result, pass rate, latest test counts and run time. `suites` is _data/tests.json, written by
// the sync (scripts/sync/project-status.mjs); each suite's own page has the live details.
import React from 'react';
import Link from '@docusaurus/Link';
import {formatDuration} from '@site/mcp/ci-metrics.mjs';
import styles from './styles.module.css';

const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
const rateTone = (v) => (v === null || v === undefined ? undefined : v < 70 ? 'var(--bc-error)' : v < 90 ? 'var(--bc-warning)' : 'var(--bc-ok)');
const day = (iso) => new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});

export default function TestsOverview({suites}) {
  const failing = suites.filter((s) => s.latest?.conclusion === 'failure');
  const asOf = suites.map((s) => s.fetchedAt).sort()[0];
  return (
    <div className={styles.wrapper}>
      <p className={styles.total}>
        {suites.length} test suites · <strong>{failing.length ? `${failing.length} failing on their latest run` : 'all passing on their latest run'}</strong>
        {asOf && (
          <span suppressHydrationWarning>
            {' '}
            · as of {new Date(asOf).toLocaleString()}
          </span>
        )}
      </p>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.testsTable}`}>
          <thead>
            <tr>
              <th>Suite</th>
              <th>Latest run</th>
              <th>Pass rate</th>
              <th>Tests (latest results)</th>
              <th>Median run time</th>
              <th>Failing tests</th>
            </tr>
          </thead>
          <tbody>
            {suites.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={s.href}>
                    <strong>{s.title}</strong>
                  </Link>
                  <span className={styles.suiteKind}>{s.kind === 'integration' ? `Integration suite · ${s.repo}` : s.workflow}</span>
                </td>
                <td>
                  {s.latest ? (
                    <a href={s.latest.url}>
                      <span className={`${styles.pill} ${styles[`pill_${s.latest.conclusion}`] ?? ''}`}>{s.latest.conclusion === 'success' ? 'passed' : 'failed'}</span>
                    </a>
                  ) : (
                    '–'
                  )}
                  {s.latest && (
                    <span className={styles.suiteKind} suppressHydrationWarning>
                      #{s.latest.number} · {day(s.latest.createdAt)}
                    </span>
                  )}
                </td>
                <td>
                  <strong style={{color: rateTone(s.passRate)}}>{pct(s.passRate)}</strong>
                  <span className={styles.suiteKind}>last {s.runs} runs · 7 days {pct(s.last7Days)}</span>
                </td>
                <td>
                  {s.tests ? (
                    <>
                      {s.tests.passed} passed
                      <span className={styles.suiteKind}>
                        {s.tests.failed} failed · {s.tests.skipped} skipped
                      </span>
                    </>
                  ) : (
                    <span className={styles.suiteKind}>No test output read</span>
                  )}
                </td>
                <td>{formatDuration(s.medianSec)}</td>
                <td>{s.failingNow ? <strong style={{color: 'var(--bc-error)'}}>{s.failingNow} failing now</strong> : 'None'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>Open a suite for its run chart, where failures happen (lint, type check, tests, …), the most-failing tests and recent runs.</p>
    </div>
  );
}
