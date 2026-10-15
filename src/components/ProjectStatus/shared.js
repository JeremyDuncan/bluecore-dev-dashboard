// Shared pieces for the Project Status pages: live data loading, the Live/Snapshot badge, labels.
import React, {useCallback, useEffect, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useIsBrowser from '@docusaurus/useIsBrowser';
import styles from './styles.module.css';

const REFRESH_MS = 5 * 60 * 1000;

// Starts with the snapshot written by the last sync, then switches to live data from the
// MCP container (customFields.liveApiUrl) and refreshes it every 5 minutes. If the live API
// isn't reachable (e.g. on GitHub Pages), the snapshot stays. `refresh()` (the Refresh button) asks
// the live API to skip its cache and fetch from GitHub now.
export function useLiveData(snapshot, apiPath) {
  const {siteConfig} = useDocusaurusContext();
  const base = siteConfig.customFields?.liveApiUrl;
  const [state, setState] = useState({data: snapshot, live: false, error: null});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}${apiPath}${fresh ? '?refresh=1' : ''}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const data = await res.json();
        setState({data, live: true, error: null});
      } catch (err) {
        setState((s) => ({...s, live: false, error: err.message}));
      }
    },
    [base, apiPath],
  );

  useEffect(() => {
    if (!base || !apiPath) return undefined;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [base, apiPath, load]);

  const refresh = useCallback(async () => {
    if (!base || !apiPath) return;
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [base, apiPath, load]);

  return {...state, refresh: base && apiPath ? refresh : null, refreshing};
}

const DATE_TIME = {year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'};

// Formats a time with its zone ("10/15/2026, 10:49 AM EDT"). Pages are pre-rendered at build time,
// on GitHub's runner in UTC, and React keeps that text when the page loads, so the build writes
// UTC (labelled) and the browser re-renders in the viewer's own zone once it has loaded.
export function useTimeFormat(options = DATE_TIME) {
  const isBrowser = useIsBrowser();
  return useCallback(
    (iso) => new Date(iso).toLocaleString(undefined, {...options, timeZoneName: 'short', ...(isBrowser ? {} : {timeZone: 'UTC'})}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isBrowser],
  );
}

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function LiveBadge({live, error, fetchedAt, sourceUrl, sourceLabel, refresh, refreshing}) {
  // No live API on this site (the public GitHub Pages build): the data is from the last deploy,
  // which is expected, so say when it's from rather than flagging it as a fallback.
  const liveEnabled = Boolean(useDocusaurusContext().siteConfig.customFields?.liveApiUrl);
  const formatTime = useTimeFormat();
  // Re-render every minute so "x min ago" stays current
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={styles.statusBar}>
      <span
        className={`${styles.badge} ${live ? styles.badgeLive : liveEnabled ? styles.badgeSnapshot : ''}`}
        title={liveEnabled ? (error ?? undefined) : 'Refreshed from GitHub every hour'}
        suppressHydrationWarning
      >
        <span className={styles.dot} aria-hidden="true" />
        {live
          ? `Live · updated ${timeAgo(fetchedAt)}`
          : liveEnabled
            ? `Snapshot from the last sync · ${formatTime(fetchedAt)}`
            : `As of ${formatTime(fetchedAt)}`}
      </span>
      {refresh && (
        <button type="button" className={styles.refreshButton} onClick={refresh} disabled={refreshing} title="Fetch the latest data from GitHub now">
          <span className={refreshing ? styles.spinning : undefined} aria-hidden="true">
            ↻
          </span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
      <span className={styles.statusBarSpacer} />
      {sourceUrl && (
        <a className={styles.sourceLink} href={sourceUrl}>
          {sourceLabel} →
        </a>
      )}
    </div>
  );
}

// GitHub label colors, with readable text on top
export function Label({name, color}) {
  const hex = /^[0-9a-f]{6}$/i.test(color ?? '') ? color : 'c0c4c8';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
  return (
    <span className={styles.label} style={{backgroundColor: `#${hex}`, color: light ? '#1f2933' : '#ffffff'}}>
      {name}
    </span>
  );
}

export function Select({label, value, onChange, options}) {
  return (
    <label className={styles.filter}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function matchesText(text, query) {
  return !query || text.toLowerCase().includes(query.toLowerCase());
}
