// Shared pieces for the Project Status pages: live data loading, the Live/Snapshot badge, labels.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useIsBrowser from '@docusaurus/useIsBrowser';
import styles from './styles.module.css';

const REFRESH_MS = 5 * 60 * 1000;
const RECHECK_MS = 2 * 60 * 1000; // live data older than this was served from the server's cache while it refreshes
const RECHECK_DELAY_MS = 15 * 1000;

// When the data was fetched from GitHub (the oldest row's time for a list such as the Tests overview)
export function dataTime(data) {
  if (Array.isArray(data)) return data.map((d) => d?.fetchedAt).filter(Boolean).sort()[0] ?? null;
  return data?.fetchedAt ?? null;
}
const ageOf = (data) => {
  const t = dataTime(data);
  return t ? Date.now() - new Date(t).getTime() : Infinity;
};

// "Refresh everything": the time the server started refetching every page's data, shared with
// the other pages (localStorage, so pages opened later see it) and the other open tabs (a broadcast)
const REFRESH_KEY = 'bluecore-live:refreshedAt';
const REFRESH_CHANNEL = 'bluecore-live-refresh';
const RECENT_REFRESH_MS = 15 * 60 * 1000;
function lastRefreshAll() {
  try {
    const at = Number(localStorage.getItem(REFRESH_KEY)) || 0;
    return Date.now() - at < RECENT_REFRESH_MS ? at : 0;
  } catch {
    return 0;
  }
}
function announceRefreshAll(at) {
  try {
    localStorage.setItem(REFRESH_KEY, String(at));
  } catch {
    // storage blocked: other tabs still get the broadcast
  }
  try {
    const channel = new BroadcastChannel(REFRESH_CHANNEL);
    channel.postMessage({since: at});
    channel.close();
  } catch {
    // no BroadcastChannel: other pages catch up on their next refresh
  }
}

// Starts with the snapshot written by the last sync, then switches to live data from the
// MCP container (customFields.liveApiUrl) and refreshes it every 5 minutes, and again whenever the
// tab comes back into view after that long (a tab left open for days, a laptop waking from sleep).
// While it waits for live data over an outdated snapshot, `updating` makes the badge say so and dims
// the page instead of passing old data off as current. If the live API isn't reachable (e.g. on
// GitHub Pages), the snapshot stays.
//
// `refresh()` (the Refresh button) refreshes everything: it asks the server to refetch every page's
// data, loads this page's fresh, and tells every other page, in this tab and the others, to load
// data fetched after that moment.
export function useLiveData(snapshot, apiPath) {
  const {siteConfig} = useDocusaurusContext();
  const base = siteConfig.customFields?.liveApiUrl?.replace(/\/$/, '');
  const [state, setState] = useState({data: snapshot, live: false, error: null, pending: base && apiPath ? 'load' : null});
  const [refreshing, setRefreshing] = useState(false);
  const lastLoad = useRef(0);
  const recheck = useRef(null);

  // opts.fresh: skip the server's cache; opts.since: wait for data fetched after that time
  const load = useCallback(
    async ({fresh = false, since = 0} = {}) => {
      lastLoad.current = Date.now();
      clearTimeout(recheck.current);
      const query = fresh ? '?refresh=1' : since ? `?since=${since}` : '';
      try {
        const res = await fetch(`${base}${apiPath}${query}`, {cache: 'no-store'});
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const data = await res.json();
        setState({data, live: true, error: null, pending: null});
        // Served from the server's cache while it refreshes: pick up the refreshed data shortly
        if (!fresh && !since && ageOf(data) > RECHECK_MS) recheck.current = setTimeout(() => load(), RECHECK_DELAY_MS);
      } catch (err) {
        setState((s) => ({...s, live: false, error: err.message, pending: null}));
      }
    },
    [base, apiPath],
  );

  useEffect(() => {
    if (!base || !apiPath) return undefined;
    load({since: lastRefreshAll()});
    const timer = setInterval(() => load(), REFRESH_MS);
    // Timers are throttled in background tabs and stop while the computer sleeps
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > REFRESH_MS) {
        setState((s) => ({...s, pending: 'load'}));
        load();
      }
    };
    // Refresh pressed on another page or in another tab
    let channel = null;
    try {
      channel = new BroadcastChannel(REFRESH_CHANNEL);
      channel.onmessage = (event) => {
        setState((s) => ({...s, pending: 'refresh'}));
        load({since: event.data?.since});
      };
    } catch {
      // no BroadcastChannel
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      clearTimeout(recheck.current);
      channel?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [base, apiPath, load]);

  const refresh = useCallback(async () => {
    if (!base || !apiPath) return;
    setRefreshing(true);
    try {
      // Every apiPath is /github/<kind>/<org>/...
      const res = await fetch(`${base}/github/refresh/${apiPath.split('/')[3]}`, {cache: 'no-store'});
      if (res.ok) announceRefreshAll((await res.json()).startedAt);
    } catch {
      // the server can't refresh everything: still refresh this page
    }
    await load({fresh: true});
    setRefreshing(false);
  }, [base, apiPath, load]);

  // Outdated: a Refresh elsewhere is being fetched, or what's on screen is older than the refresh interval
  const updating = state.pending === 'refresh' || (state.pending === 'load' && ageOf(state.data) > REFRESH_MS);
  return {data: state.data, live: state.live, error: state.error, updating, refresh: base && apiPath ? refresh : null, refreshing};
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

export function LiveBadge({live, error, fetchedAt, sourceUrl, sourceLabel, refresh, refreshing, updating}) {
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
        className={`${styles.badge} ${updating ? styles.badgeUpdating : live ? styles.badgeLive : liveEnabled ? styles.badgeSnapshot : ''}`}
        title={liveEnabled ? (error ?? undefined) : 'Refreshed from GitHub every hour'}
        role="status"
        suppressHydrationWarning
      >
        <span className={styles.dot} aria-hidden="true" />
        {updating
          ? `Updating… showing data from ${fetchedAt ? timeAgo(fetchedAt) : 'the last sync'}`
          : live
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
