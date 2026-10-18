// The Local Stack pages (/local-stack and its sections, src/pages/local-stack/): your bluecore-stack checkout
// as a control panel, split into sections like Project Status (same icon navigation and overview cards,
// from ProjectStatus/StatusNav): Services, Logs, Tests, Data, Set up, Jobs and Troubleshoot. The
// checkout's own dev scripts run as jobs with live output; each section shows the scripts that belong to it. It talks to the MCP server's
// /api/stack (mcp/stack-api.mjs), which passes everything to the helper on this machine
// (chat/stack-runner.mjs) that runs the scripts. The stack_* MCP tools use the same jobs, so what an
// agent ran shows up here too.
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useHistory, useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import ConfirmDialog from '../Notes/ConfirmDialog';
import {relWhen} from '../Notes';
import {CheckIcon, ClockIcon, CopyIcon, SearchIcon, SparkleIcon, TrashIcon, XIcon} from '../Notes/icons';
import PageHero from '../PageHero';
import Link from '@docusaurus/Link';
import StatusNav, {StatusIcon, StatusOverview} from '../ProjectStatus/StatusNav';
import Ansi, {stripAnsi} from './Ansi';
import styles from './styles.module.css';

// The sections, each its own page. `groups`: the scripts (chat/stack-runner.mjs ACTIONS, by group) it shows.
const SECTIONS = [
  {id: 'overview', icon: 'overview', label: 'Overview', title: 'Local Stack', path: '', lead: "Your Bluecore stack on this machine, run with your bluecore-stack checkout's own scripts. Pick a section below, or use the icons at the top of any Local Stack page to switch between them."},
  {id: 'services', icon: 'services', label: 'Services', title: 'Services', path: '/services', groups: ['Run'], lead: 'Every container of the stack with its state and health, the stack\'s pages, and the scripts that start, stop and reset it.'},
  {id: 'logs', icon: 'logs', label: 'Logs', title: 'Logs', path: '/logs', lead: "One service's logs, followed live, filtered by time or text, with errors and warnings highlighted."},
  {id: 'tests', icon: 'tests', label: 'Tests', title: 'Tests', path: '/tests', groups: ['Tests'], lead: "Run the stack's integration tests (all of them, a folder, a file or one test) and the CI workflow with act."},
  {id: 'data', icon: 'data', label: 'Data', title: 'Data', path: '/data', groups: ['Data'], lead: 'Load Bibframe data and Sinopia profiles into your local stack, or clear them out.'},
  {id: 'setup', icon: 'setup', label: 'Set up', title: 'Set up', path: '/setup', groups: ['Set up', 'Keycloak'], lead: 'Install the sibling repos and their .env files, keep them up to date, and export or import the Keycloak realm.'},
  {id: 'jobs', icon: 'jobs', label: 'Jobs', title: 'Jobs', path: '/jobs', lead: 'Every script run, from these pages or by an AI agent, with its live output and exit code.'},
  {id: 'troubleshoot', icon: 'troubleshoot', label: 'Troubleshoot', title: 'Troubleshoot', path: '/troubleshoot', groups: ['Debug'], lead: "A check of Docker, your checkouts, every service and its recent errors, with a fix for each problem it finds."},
];
const sectionOf = (action) => SECTIONS.find((s) => s.groups?.includes(action.group))?.id ?? 'services';

function useApi() {
  const {liveApiUrl: base, chatApiUrl, notebooks, localStack} = useDocusaurusContext().siteConfig.customFields ?? {};
  const call = useCallback(
    async (path, {method = 'GET', body} = {}) => {
      const res = await fetch(`${base}/stack${path}`, {method, headers: body ? {'content-type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {status: res.status, helperDown: data.helperDown});
      return data;
    },
    [base],
  );
  // turnedOff: the local site without LOCAL_STACK=true in .env (the Local Stack pages are off by default)
  return {call, enabled: Boolean(base && localStack), turnedOff: Boolean(base) && !localStack, chat: Boolean(chatApiUrl), notebooks: Boolean(notebooks)};
}

// Runs fn now and every `ms` while the tab is visible (and `on`)
function usePoll(fn, ms, on = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const tick = async () => {
      if (document.visibilityState === 'visible') await saved.current();
      timer = setTimeout(tick, ms);
    };
    tick();
    return () => clearTimeout(timer);
  }, [ms, on]);
}

// The query string, and go(section, params) to open a section (or change this one's params)
function useNav() {
  const location = useLocation();
  const history = useHistory();
  const base = useBaseUrl('/local-stack');
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const go = useCallback(
    (section, query = {}) => {
      const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''));
      history.push(`${base}${SECTIONS.find((s) => s.id === section)?.path ?? ''}${q.toString() ? `?${q}` : ''}`);
    },
    [base, history],
  );
  return {params, go, base};
}

const ask = (question, display) => window.dispatchEvent(new CustomEvent('ask-docs:ask', {detail: {question, display, fresh: true}}));

function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// ---------- Small pieces

function Dot({c}) {
  const tone = c.state !== 'running' ? (c.state === 'exited' && c.exitCode === 0 ? 'done' : 'down') : c.health === 'unhealthy' ? 'down' : c.health === 'starting' ? 'starting' : 'up';
  return <span className={`${styles.dot} ${styles[`dot-${tone}`]}`} title={tone} aria-hidden="true" />;
}

const STATUS_LABEL = {running: 'Running', succeeded: 'Done', failed: 'Failed', stopped: 'Stopped', ended: 'Ended'};
function JobBadge({job}) {
  return <span className={`${styles.badge} ${styles[`badge-${job.status}`]}`}>{STATUS_LABEL[job.status] ?? job.status}</span>;
}

function HelperDown({error}) {
  return (
    <div className={styles.notice} role="alert">
      <h2>The helper on this machine isn&apos;t reachable</h2>
      <p>{error}</p>
      <p>
        The scripts run through the dashboard&apos;s helper on your Mac (the one behind Ask the docs). It starts with <code>make up</code> or{' '}
        <code>make prod</code>, or alone with <code>make chat</code>. If it&apos;s running but older than this page, restart it.
      </p>
    </div>
  );
}

// ---------- Services

function Services({status, onLogs, onRun}) {
  const {containers, links} = status;
  if (!containers.length)
    return (
      <div className={styles.empty}>
        <p>
          <strong>The stack isn&apos;t running.</strong> Start it with your checkout&apos;s <code>scripts/dev/run</code>.
        </p>
        <button type="button" className={styles.primary} onClick={() => onRun('start')}>
          Start the stack…
        </button>
      </div>
    );
  return (
    <>
      {links.length > 0 && (
        <nav className={styles.links} aria-label="The stack's pages">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className={styles.chip}>
              {l.label} ↗
            </a>
          ))}
        </nav>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Service</th>
              <th>State</th>
              <th className={styles.hideNarrow}>Ports</th>
              <th className={styles.hideNarrow}>Image</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => (
              <tr key={c.name}>
                <td>
                  <span className={styles.service}>
                    <Dot c={c} /> {c.service}
                  </span>
                </td>
                <td className={styles.muted}>{c.status}</td>
                <td className={`${styles.muted} ${styles.hideNarrow} ${styles.mono}`}>{c.ports.replace(/, \[::\]:\d+->\d+\/tcp/g, '') || '—'}</td>
                <td className={`${styles.muted} ${styles.hideNarrow} ${styles.mono}`}>{c.image}</td>
                <td className={styles.rowActions}>
                  <button type="button" className={styles.ghost} onClick={() => onLogs(c.service)}>
                    Logs
                  </button>
                  <button type="button" className={styles.ghost} onClick={() => onRun('restart_service', {service: c.service})}>
                    Restart
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Logs

const ERR = /\b(ERROR|CRITICAL|FATAL|Traceback|Exception|panic)\b|level=error/i;
const WARN = /\b(WARN|WARNING)\b|level=warn/i;

function Logs({call, status, service, setService, chat}) {
  const services = status.containers.map((c) => c.service);
  const current = services.includes(service) ? service : services.includes('bc_api') ? 'bc_api' : services[0];
  const [tail, setTail] = useState(300);
  const [since, setSince] = useState('');
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const d = await call(`/logs?container=${encodeURIComponent(current)}&tail=${tail}${since ? `&since=${since}` : ''}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [call, current, tail, since]);
  useEffect(() => {
    setData(null);
    atBottom.current = true;
  }, [current]);
  usePoll(load, 3000, follow);
  useEffect(() => {
    if (!follow) load();
  }, [follow, load]);
  useEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [data]);

  if (!services.length) return <p className={styles.empty}>No services yet: start the stack first.</p>;
  const q = filter.trim().toLowerCase();
  const lines = (data?.lines ?? []).filter((l) => (!errorsOnly || ERR.test(l.text)) && (!q || stripAnsi(l.text).toLowerCase().includes(q)));
  const errors = (data?.lines ?? []).filter((l) => ERR.test(l.text)).length;

  return (
    <div className={styles.logs}>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Service</span>
          <select value={current} onChange={(e) => setService(e.target.value)}>
            {status.containers.map((c) => (
              <option key={c.name} value={c.service}>
                {c.service}
                {c.state !== 'running' ? ` (${c.state})` : c.health === 'unhealthy' ? ' (unhealthy)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Lines</span>
          <select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {[100, 300, 1000, 3000].map((n) => (
              <option key={n} value={n}>
                last {n}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>From</span>
          <select value={since} onChange={(e) => setSince(e.target.value)}>
            <option value="">any time</option>
            <option value="15m">last 15 minutes</option>
            <option value="1h">last hour</option>
            <option value="6h">last 6 hours</option>
            <option value="24h">last day</option>
          </select>
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Filter</span>
          <span className={styles.search}>
            <SearchIcon size={14} />
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Text in the line" />
          </span>
        </label>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.check}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only{errors ? ` (${errors})` : ''}
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap lines
        </label>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={() => copy(lines.map((l) => `${l.ts} ${stripAnsi(l.text)}`).join('\n'))}>
          <CopyIcon size={14} /> Copy
        </button>
        {chat && (
          <button
            type="button"
            className={styles.ghost}
            onClick={() =>
              ask(
                `Look at the logs of the ${current} service in my local Bluecore stack (stack_logs service "${current}"${since ? `, since "${since}"` : ''}). ` +
                  'Tell me whether anything is wrong, what the errors mean and how to fix them. Use stack_status and the docs if they help. Don\'t run any stack_run action without asking me.',
                `What's wrong in the ${current} logs?`,
              )
            }>
            <SparkleIcon size={14} /> Ask AI about these logs
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div
        ref={box}
        className={`${styles.console} ${wrap ? styles.wrap : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        tabIndex={0}
        aria-label={`${current} logs`}>
        {data == null ? (
          <span className={styles.ansiDim}>Loading…</span>
        ) : lines.length ? (
          lines.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={`${styles.line} ${ERR.test(l.text) ? styles.lineErr : WARN.test(l.text) ? styles.lineWarn : ''}`}>
              <span className={styles.ts}>{l.ts ? new Date(l.ts).toLocaleTimeString([], {hour12: false}) : ''}</span>
              <Ansi text={l.text} />
            </div>
          ))
        ) : (
          <span className={styles.ansiDim}>No lines{q || errorsOnly ? ' match' : ''}.</span>
        )}
      </div>
    </div>
  );
}

// ---------- Scripts (actions)

// Which tests to run: a folder, a file, or one test of a file, from the checkout's tests/ (status.tests).
// The value is what pytest takes: "tests/integration/api", "…/test_health.py" or "…/test_health.py::test_x".
function TestPicker({id, label, catalog, value, onChange}) {
  const file = value?.includes('::') ? value.slice(0, value.indexOf('::')) : value;
  const picked = catalog.find((f) => f.path === file);
  const areas = [...new Set(catalog.map((f) => f.folder.split('/').slice(0, 2).join('/')))];
  const short = (p) => p.replace(/^tests\//, '');
  return (
    <>
      <label className={styles.field} htmlFor={id}>
        <span>{label}</span>
        <select id={id} value={file ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Everything the script runs by default</option>
          {areas.map((area) => {
            const files = catalog.filter((f) => f.folder === area || f.folder.startsWith(`${area}/`));
            const folders = [...new Set(files.map((f) => f.folder))].filter((f) => f !== area);
            const count = files.reduce((n, f) => n + f.tests.length, 0);
            return (
              <optgroup key={area} label={short(area)}>
                <option value={area}>
                  All of {short(area)} ({count} tests)
                </option>
                {folders.map((folder) => (
                  <React.Fragment key={folder}>
                    {folders.length > 1 && (
                      <option value={folder}>
                        {short(folder)}/ ({files.filter((f) => f.folder === folder).reduce((n, f) => n + f.tests.length, 0)} tests)
                      </option>
                    )}
                    {files
                      .filter((f) => f.folder === folder)
                      .map((f) => (
                        <option key={f.path} value={f.path}>
                          {'\u00a0\u00a0'}
                          {short(f.path)} ({f.tests.length})
                        </option>
                      ))}
                  </React.Fragment>
                ))}
                {files
                  .filter((f) => f.folder === area)
                  .map((f) => (
                    <option key={f.path} value={f.path}>
                      {short(f.path)} ({f.tests.length})
                    </option>
                  ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      {picked && (
        <label className={styles.field} htmlFor={`${id}-one`}>
          <span>Test</span>
          <select id={`${id}-one`} value={value.includes('::') ? value : ''} onChange={(e) => onChange(e.target.value || picked.path)}>
            <option value="">All {picked.tests.length} tests in this file</option>
            {picked.tests.map((t) => (
              <option key={t} value={`${picked.path}::${t}`}>
                {t.replace(/::/g, ' › ')}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function OptionField({opt, value, onChange, services, tests}) {
  const id = `opt-${opt.name}`;
  if (opt.type === 'tests' && tests?.length) return <TestPicker id={id} label={opt.label} catalog={tests} value={value} onChange={onChange} />;
  if (opt.type === 'boolean')
    return (
      <label className={styles.check}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> {opt.label}
      </label>
    );
  if (opt.type === 'multi')
    return (
      <fieldset className={styles.multi}>
        <legend>{opt.label}</legend>
        {opt.choices.map((c) => (
          <label key={c} className={styles.check}>
            <input type="checkbox" checked={(value ?? []).includes(c)} onChange={(e) => onChange(e.target.checked ? [...(value ?? []), c] : (value ?? []).filter((x) => x !== c))} /> {c}
          </label>
        ))}
      </fieldset>
    );
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{opt.label}</span>
      {opt.type === 'choice' || opt.type === 'service' ? (
        <select id={id} value={value ?? opt.default ?? ''} onChange={(e) => onChange(e.target.value)}>
          {opt.type === 'service' && <option value="">Pick a service</option>}
          {(opt.type === 'service' ? services : opt.choices).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} value={value ?? ''} placeholder={opt.placeholder ?? (opt.type === 'ref' ? 'branch or tag' : '')} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function ActionCard({action, services, tests, preset, onStart, runningJob, onOpenJob}) {
  const [values, setValues] = useState(preset ?? {});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const card = useRef(null);
  useEffect(() => {
    if (preset) {
      setValues(preset);
      card.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
    }
  }, [preset]);
  const options = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== false && !(Array.isArray(v) && !v.length)));
  const dangerous = action.danger && !(action.id === 'update' && values.dry_run);
  const start = async (confirm) => {
    setBusy(true);
    setError(null);
    try {
      await onStart(action.id, options, confirm);
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section ref={card} className={`${styles.action} ${preset ? styles.actionPicked : ''}`} aria-labelledby={`a-${action.id}`}>
      <h3 id={`a-${action.id}`}>
        {action.title}
        {action.long && <span className={styles.tag}>keeps running</span>}
        {dangerous && <span className={`${styles.tag} ${styles.tagDanger}`}>asks first</span>}
      </h3>
      <code className={styles.script}>{action.script}</code>
      <p>{action.description}</p>
      {action.options.length > 0 && (
        <div className={styles.options}>
          {action.options
            .filter((opt) => opt.type !== 'ref')
            .map((opt) => (
              <OptionField key={opt.name} opt={opt} value={values[opt.name]} services={services} tests={tests} onChange={(v) => setValues((s) => ({...s, [opt.name]: v}))} />
            ))}
          {/* Branches to build from: rarely needed, so folded away (open when one is set) */}
          {action.options.some((opt) => opt.type === 'ref') && (
            <details className={styles.more} open={action.options.some((opt) => opt.type === 'ref' && values[opt.name])}>
              <summary>Build from other branches</summary>
              <div className={styles.options}>
                {action.options
                  .filter((opt) => opt.type === 'ref')
                  .map((opt) => (
                    <OptionField key={opt.name} opt={opt} value={values[opt.name]} services={services} onChange={(v) => setValues((s) => ({...s, [opt.name]: v}))} />
                  ))}
              </div>
            </details>
          )}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.cardButtons}>
        {runningJob ? (
          <button type="button" className={styles.ghost} onClick={() => onOpenJob(runningJob.id)}>
            <ClockIcon size={14} /> Running: show output
          </button>
        ) : (
          <button type="button" className={dangerous ? styles.danger : styles.primary} disabled={busy} onClick={() => (dangerous ? setConfirming(true) : start(false).catch(() => {}))}>
            {busy ? 'Starting…' : dangerous ? 'Run…' : 'Run'}
          </button>
        )}
      </div>
      <ConfirmDialog open={confirming} title={`${action.title}?`} confirmLabel="Run it" busyLabel="Starting…" onCancel={() => setConfirming(false)} onConfirm={async () => {
        await start(true);
        setConfirming(false);
      }}>
        <p>{action.dangerText}</p>
        <p>
          It runs <code>{action.script}</code> in your bluecore-stack checkout.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function Actions({status, groups, pick, onStart, onOpenJob}) {
  const services = status.containers.map((c) => c.service);
  const running = status.jobs.filter((j) => j.status === 'running');
  return groups.map((group) => {
    const list = status.actions.filter((a) => a.group === group);
    if (!list.length) return null;
    return (
      <div key={group} className={styles.group}>
        <h2>{{Run: 'Start, stop and reset', 'Set up': 'Your checkouts', Keycloak: 'Keycloak realm', Data: 'Load and clear', Tests: 'Run tests', Debug: 'Watch the database'}[group] ?? group}</h2>
        <div className={styles.cards}>
          {list.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              services={services}
              tests={status.tests}
              preset={pick?.action === a.id ? pick.options : undefined}
              runningJob={a.id === 'restart_service' ? null : running.find((j) => j.action === a.id)}
              onStart={onStart}
              onOpenJob={onOpenJob}
            />
          ))}
        </div>
      </div>
    );
  });
}

// ---------- Jobs

function JobView({call, id, chat, onStopped, onRemove}) {
  const [job, setJob] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const offset = useRef(0);
  const box = useRef(null);
  const atBottom = useRef(true);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    offset.current = 0;
    setText('');
    setJob(null);
    atBottom.current = true;
  }, [id]);
  const load = useCallback(async () => {
    try {
      const d = await call(`/job?id=${encodeURIComponent(id)}&offset=${offset.current}`);
      setJob(d.job);
      setText((t) => {
        const next = d.reset ? d.text : t + d.text;
        return next.length > 1_500_000 ? next.slice(-1_000_000) : next;
      });
      offset.current = d.offset;
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [call, id]);
  usePoll(load, 1500, !job || job.status === 'running');
  useEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  if (error && !job) return <p className={styles.error}>{error}</p>;
  if (!job) return <p className={styles.muted}>Loading…</p>;
  return (
    <div className={styles.jobView}>
      <div className={styles.jobHead}>
        <div>
          <h2>
            {job.title} <JobBadge job={job} />
          </h2>
          <code className={styles.script}>{job.command}</code>
          <p className={styles.muted}>
            Started {relWhen(job.startedAt)} by {job.by}
            {job.endedAt && ` · ended ${relWhen(job.endedAt)}`}
            {job.exitCode != null && ` · exit code ${job.exitCode}`}
          </p>
        </div>
        <div className={styles.cardButtons}>
          {job.status === 'running' && (
            <button
              type="button"
              className={styles.ghost}
              disabled={stopping || job.stopRequested}
              onClick={async () => {
                setStopping(true);
                try {
                  await call('/stop', {method: 'POST', body: {id}});
                  onStopped?.();
                } catch (e) {
                  setError(e.message);
                }
                setStopping(false);
              }}>
              <XIcon size={14} /> {job.stopRequested || stopping ? 'Stopping…' : job.action === 'start' ? 'Stop (Ctrl+C)' : 'Stop'}
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={() => copy(stripAnsi(text))}>
            <CopyIcon size={14} /> Copy output
          </button>
          {job.status !== 'running' && (
            <button type="button" className={`${styles.ghost} ${styles.ghostDanger}`} onClick={() => onRemove(job)}>
              <TrashIcon size={14} /> Remove
            </button>
          )}
          {chat && job.status !== 'running' && job.status !== 'succeeded' && (
            <button
              type="button"
              className={styles.ghost}
              onClick={() =>
                ask(
                  `The "${job.title}" job on my local Bluecore stack ${job.status === 'failed' ? `failed with exit code ${job.exitCode}` : `ended (${job.status})`}. ` +
                    `Read its output with stack_job id "${job.id}" (it ran \`${job.command}\`). Explain what went wrong and how to fix it; ` +
                    'check stack_status, stack_logs and the docs if they help. Don\'t run any stack_run action without asking me.',
                  `Why did “${job.title}” ${job.status === 'failed' ? 'fail' : 'stop'}?`,
                )
              }>
              <SparkleIcon size={14} /> Ask AI why
            </button>
          )}
        </div>
      </div>
      {job.action === 'start' && job.status === 'running' && (
        <p className={styles.hint}>This job runs for as long as the stack is up and shows every service&apos;s output. Stopping it is like Ctrl+C: Docker Compose stops the containers.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <pre
        ref={box}
        className={`${styles.console} ${styles.wrap}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        tabIndex={0}>
        {text ? <Ansi text={text} /> : <span className={styles.ansiDim}>{job.status === 'running' ? 'Waiting for output…' : 'No output.'}</span>}
      </pre>
    </div>
  );
}

function Jobs({call, status, id, setId, chat, refresh}) {
  const jobs = status.jobs;
  const current = jobs.some((j) => j.id === id) ? id : jobs[0]?.id;
  const finished = jobs.filter((j) => j.status !== 'running');
  const [clearing, setClearing] = useState(null); // {jobs} to remove, waiting for the confirmation
  if (!jobs.length) return <p className={styles.empty}>No jobs yet. Run a script from Services, Tests, Data, Set up or Troubleshoot; jobs AI agents start show up here too.</p>;
  const remove = async (list) => {
    await call('/jobs/clear', {method: 'POST', body: {ids: list.map((j) => j.id)}});
    await refresh();
    if (list.some((j) => j.id === current)) setId(null);
  };
  return (
    <div className={styles.jobs}>
      <div className={styles.jobSide}>
        <div className={styles.jobListHead}>
          <span className={styles.muted}>
            {jobs.length} job{jobs.length === 1 ? '' : 's'}
            {jobs.length > finished.length ? `, ${jobs.length - finished.length} running` : ''}
          </span>
          <button type="button" className={`${styles.ghost} ${styles.small}`} disabled={!finished.length} onClick={() => setClearing(finished)} title="Remove every job that isn't running, with its output">
            <TrashIcon size={13} /> Clear finished
          </button>
        </div>
        <ul className={styles.jobList}>
          {jobs.map((j) => (
            <li key={j.id}>
              <button type="button" className={`${styles.jobItem} ${j.id === current ? styles.jobItemOn : ''}`} onClick={() => setId(j.id)} aria-current={j.id === current}>
                <span className={styles.jobTitle}>
                  {j.title}
                  {j.options?.service ? `: ${j.options.service}` : ''}
                </span>
                <span className={styles.jobMeta}>
                  <JobBadge job={j} /> {relWhen(j.startedAt)}
                  {j.by !== 'Local Stack page' && j.by !== 'page' ? ` · ${j.by}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current && <JobView key={current} call={call} id={current} chat={chat} onStopped={refresh} onRemove={(job) => remove([job]).catch(() => {})} />}
      <ConfirmDialog
        open={Boolean(clearing)}
        title={`Remove ${clearing?.length === 1 ? 'the finished job' : `${clearing?.length} finished jobs`}?`}
        confirmLabel="Remove"
        busyLabel="Removing…"
        onCancel={() => setClearing(null)}
        onConfirm={async () => {
          await remove(clearing);
          setClearing(null);
        }}>
        <p>Their output goes too. Running jobs stay. This only tidies the list: it doesn&apos;t undo anything the jobs did.</p>
      </ConfirmDialog>
    </div>
  );
}

// ---------- Troubleshoot

const LEVEL = {error: 'Problem', warn: 'Warning', info: 'Note', ok: 'OK'};

function Checks({call, chat, onFix, onLogs}) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await call('/diagnose'));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }, [call]);
  useEffect(() => {
    run();
  }, [run]);
  const problems = report?.findings.filter((f) => f.level === 'error' || f.level === 'warn') ?? [];
  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.primary} onClick={run} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
        {chat && (
          <button
            type="button"
            className={styles.ghost}
            onClick={() =>
              ask(
                'Troubleshoot my local Bluecore stack. Start with stack_diagnose, then look at stack_status and the logs of anything that looks wrong (stack_logs), and the docs for known fixes. ' +
                  'Tell me what is wrong, why, and the steps to fix it, most important first. Suggest stack_run actions but don\'t run any without asking me.',
                'Troubleshoot my local stack',
              )
            }>
            <SparkleIcon size={14} /> Ask AI to troubleshoot
          </button>
        )}
        {report && (
          <span className={styles.muted}>
            {problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'No problems found'} · checked {relWhen(report.checkedAt)}
          </span>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {report == null && busy && <p className={styles.muted}>Checking Docker, the checkout, every service and its logs…</p>}
      <ul className={styles.findings}>
        {report?.findings.map((f, i) => (
          <li key={i} className={`${styles.finding} ${styles[`finding-${f.level}`]}`}>
            <span className={styles.findingIcon} aria-hidden="true">
              {f.level === 'ok' ? <CheckIcon size={16} /> : f.level === 'info' ? 'i' : '!'}
            </span>
            <div className={styles.findingBody}>
              <strong>
                <span className={styles.srOnly}>{LEVEL[f.level]}: </span>
                {f.title}
              </strong>
              {f.detail && <p>{f.detail}</p>}
              {f.logs?.length > 0 && (
                <pre className={`${styles.console} ${styles.wrap} ${styles.consoleSmall}`}>
                  {f.logs.map((l, j) => (
                    <div key={j}>
                      <Ansi text={l} />
                    </div>
                  ))}
                </pre>
              )}
              {(f.fix || f.service) && (
                <div className={styles.cardButtons}>
                  {f.fix && (
                    <button type="button" className={styles.primary} onClick={() => onFix(f.fix.action, f.fix.options)}>
                      {f.fix.label}…
                    </button>
                  )}
                  {f.service && (
                    <button type="button" className={styles.ghost} onClick={() => onLogs(f.service)}>
                      {f.service} logs
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Recent runs of a section's scripts

function RecentJobs({jobs, onOpen}) {
  if (!jobs.length) return null;
  return (
    <div className={styles.group}>
      <h2>Recent runs</h2>
      <ul className={styles.recent}>
        {jobs.slice(0, 6).map((j) => (
          <li key={j.id}>
            <button type="button" className={styles.recentItem} onClick={() => onOpen(j.id)}>
              <JobBadge job={j} />
              <span className={styles.jobTitle}>
                {j.title}
                {j.options?.tests ? `: ${j.options.tests.replace(/^tests\//, '')}` : j.options?.service ? `: ${j.options.service}` : ''}
              </span>
              <span className={styles.muted}>
                {relWhen(j.startedAt)}
                {j.by !== 'Local Stack page' && j.by !== 'page' ? ` · ${j.by}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- The left sidebar: like the Guides and Project Status sidebars (a link back to the docs, a header,
// then each section with its icon), with live counts, and the other Workspace pages at the bottom. Hidden
// on narrow screens, where the icon row under the header does the job.

function Sidebar({pages, current, status, notebooks}) {
  const badge = (id) => {
    if (!status) return null;
    if (id === 'services' && status.containers.length) {
      const bad = status.containers.filter((c) => c.health === 'unhealthy' || c.state === 'restarting' || (c.state === 'exited' && c.exitCode !== 0)).length;
      return {text: `${status.containers.filter((c) => c.state === 'running').length}/${status.containers.length}`, bad: bad > 0, title: bad ? `${bad} need attention` : 'running'};
    }
    if (id === 'jobs') {
      const n = status.jobs.filter((j) => j.status === 'running').length;
      return n ? {text: String(n), title: `${n} running`} : null;
    }
    if (id === 'tests') {
      const j = status.jobs.find((x) => ['integration_tests', 'workflow_tests'].includes(x.action));
      return j && j.status !== 'running' ? {text: j.status === 'succeeded' ? 'passed' : j.status, bad: j.status === 'failed', title: `Last run: ${j.title}`} : null;
    }
    return null;
  };
  return (
    <aside className={styles.side} aria-label="Local Stack sections">
      <nav className="menu thin-scrollbar">
        <ul className="menu__list">
          <li className="menu__list-item section-sidebar-back">
            <Link className="menu__link" to="/">
              Back to the docs
            </Link>
          </li>
          <li className="menu__list-item section-sidebar-head">
            <span className="section-sidebar-title">Local Stack</span>
            <span className="section-sidebar-text">Your Bluecore stack on this machine: services, logs, tests, data and set up, with its own scripts.</span>
          </li>
          {pages.map((p) => {
            const b = badge(p.id);
            return (
              <li key={p.id} className="menu__list-item">
                <Link className={`menu__link ${styles.sideLink} ${p.id === current ? 'menu__link--active' : ''}`} to={p.href} aria-current={p.id === current ? 'page' : undefined}>
                  <StatusIcon name={p.icon} size={18} />
                  <span className={styles.sideLabel}>{p.label}</span>
                  {b && (
                    <span className={`${styles.sideBadge} ${b.bad ? styles.sideBadgeBad : ''}`} title={b.title}>
                      {b.text}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className={styles.sideGroup}>Workspace</p>
        <ul className="menu__list">
          <li className="menu__list-item sidebar-icon sidebar-icon--notes">
            <Link className="menu__link" to="/notes">
              Notes
            </Link>
          </li>
          {notebooks && (
            <li className="menu__list-item sidebar-icon sidebar-icon--notebook">
              <Link className="menu__link" to="/notebooks">
                Jupyter Notebooks
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </aside>
  );
}

// ---------- The pages

// What each section's card and nav tooltip say, from the live status
function describe(section, status) {
  const {containers, jobs, tests, actions} = status;
  const running = containers.filter((c) => c.state === 'running').length;
  const bad = containers.filter((c) => c.health === 'unhealthy' || c.state === 'restarting' || (c.state === 'exited' && c.exitCode !== 0)).length;
  const last = (ids) => jobs.find((j) => ids.includes(j.action));
  const lastText = (ids) => {
    const j = last(ids);
    return j ? ` Last run: ${j.title.toLowerCase()}, ${j.status === 'running' ? 'running now' : `${(STATUS_LABEL[j.status] ?? j.status).toLowerCase()} ${relWhen(j.endedAt ?? j.startedAt)}`}.` : '';
  };
  const ids = (s) => actions.filter((a) => s.groups?.includes(a.group)).map((a) => a.id);
  const count = (area) => tests.filter((t) => t.folder.startsWith(`tests/${area}`)).reduce((n, t) => n + t.tests.length, 0);
  switch (section.id) {
    case 'services':
      return containers.length ? `${running} of ${containers.length} services running${bad ? `, ${bad} need attention` : ''}. Start, stop, restart and reset.` : "The stack isn't running. Start it here.";
    case 'logs':
      return `Follow any service's logs live${containers.length ? ` (${containers.length} services)` : ''}, with errors highlighted and an AI to explain them.`;
    case 'tests':
      return `${count('integration')} integration and ${count('ui')} UI tests in ${tests.length} files, plus the CI workflow with act.${lastText(ids(section))}`;
    case 'data':
      return `Load the dev dataset or any JSON-LD, copy Sinopia profiles from a deployed Blue Core, or clear it all.${lastText(ids(section))}`;
    case 'setup':
      return `Install missing repos and .env files, check for and pull updates, and export or import the Keycloak realm.${lastText(ids(section))}`;
    case 'jobs': {
      const now = jobs.filter((j) => j.status === 'running').length;
      return `${now ? `${now} running now. ` : ''}${jobs.length ? `${jobs.length} recent runs with their output.` : 'No runs yet.'}`;
    }
    case 'troubleshoot':
      return 'Find what is wrong with the stack, with evidence from its logs and a fix for each problem. Ask AI to dig in.';
    default:
      return section.lead;
  }
}

export default function LocalStack({section: sectionId = 'overview'}) {
  const {call, enabled, turnedOff, chat, notebooks} = useApi();
  const {params, go} = useNav();
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [stopping, setStopping] = useState(false); // the Stop confirmation

  const refresh = useCallback(async () => {
    try {
      setStatus(await call(''));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [call]);
  usePoll(refresh, 5000, enabled);

  const openJob = (id) => go('jobs', {job: id});
  const startAction = async (action, options, confirm) => {
    const {job} = await call('/run', {method: 'POST', body: {action, options, confirm}});
    await refresh();
    openJob(job.id);
  };
  // A button elsewhere (a service row, a fix): run simple ones at once, open the rest in their section to fill in or confirm
  const quick = (action, options = {}) => {
    if (action === 'stop') return setStopping(true);
    const a = status?.actions.find((x) => x.id === action);
    if (a && !a.danger && (action === 'restart_service' || !a.options.length)) startAction(action, options, false).catch((e) => setError(e));
    else go(a ? sectionOf(a) : 'services', {pick: action, opts: Object.keys(options).length ? JSON.stringify(options) : null});
  };
  const pick = useMemo(() => {
    if (!params.get('pick')) return null;
    try {
      return {action: params.get('pick'), options: JSON.parse(params.get('opts') || '{}')};
    } catch {
      return {action: params.get('pick'), options: {}};
    }
  }, [params]);

  if (!enabled)
    return (
      <main className={styles.page}>
        <div className={styles.notice}>
          <h1>Local Stack</h1>
          {turnedOff ? (
            <p>
              The Local Stack pages are off. To use them, set <code>LOCAL_STACK=true</code> in this site&apos;s <code>.env</code> (and <code>BLUECORE_STACK_DIR</code> to your bluecore-stack checkout), then run{' '}
              <code>make up</code>.
            </p>
          ) : (
            <p>The Local Stack pages control the stack on your machine, so they only exist on the local site. Run it with <code>make up</code>.</p>
          )}
        </div>
      </main>
    );

  const pages = SECTIONS.map((s) => ({...s, href: `/local-stack${s.path}`, description: status ? describe(s, status) : s.lead}));
  const running = status?.containers.filter((c) => c.state === 'running') ?? [];
  const unhealthy = status?.containers.filter((c) => c.health === 'unhealthy' || c.state === 'restarting' || (c.state === 'exited' && c.exitCode !== 0)) ?? [];
  const jobsRunning = status?.jobs.filter((j) => j.status === 'running') ?? [];
  const stackJob = jobsRunning.find((j) => j.action === 'start');
  const sectionJobs = section.groups && status ? status.jobs.filter((j) => section.groups.includes(status.actions.find((a) => a.id === j.action)?.group)) : [];
  const ready = status?.stack.configured;
  const overview = section.id === 'overview';

  return (
    <div className={styles.layout}>
      <Sidebar pages={pages} current={section.id} status={status} notebooks={notebooks} />
      <main className={styles.page}>
        <PageHero
          eyebrow={overview ? 'Workspace · your machine' : 'Local Stack · your machine'}
          title={section.title}
          lead={section.lead}
          stats={
            ready && (overview || section.id === 'services')
              ? [
                  {icon: <span className={`${styles.dot} ${styles[running.length ? 'dot-up' : 'dot-down']}`} />, value: `${running.length}/${status.containers.length}`, label: 'services running'},
                  {icon: <span className={`${styles.dot} ${styles[unhealthy.length ? 'dot-down' : 'dot-up']}`} />, value: unhealthy.length, label: unhealthy.length === 1 ? 'needs attention' : 'need attention', tone: unhealthy.length ? 'bad' : undefined},
                  {icon: <ClockIcon size={18} />, value: jobsRunning.length, label: jobsRunning.length === 1 ? 'job running' : 'jobs running', to: '/local-stack/jobs'},
                ]
              : []
          }>
          {ready && (overview || section.id === 'services') && (
            <>
              <p className={styles.meta}>
                <code>{status.stack.path}</code> · branch <strong>{status.stack.branch ?? '?'}</strong> ·{' '}
                {status.docker.running ? `Docker ${status.docker.version} (${(status.docker.memory / 1024 ** 3).toFixed(1)} GB)` : <strong className={styles.bad}>Docker isn&apos;t running</strong>}
              </p>
              <div className={styles.heroButtons}>
                {running.length ? (
                  <button type="button" className={styles.ghost} onClick={() => quick('stop')}>
                    Stop the stack
                  </button>
                ) : (
                  <button type="button" className={styles.primary} onClick={() => quick('start')}>
                    Start the stack…
                  </button>
                )}
                {stackJob && (
                  <button type="button" className={styles.ghost} onClick={() => openJob(stackJob.id)}>
                    Stack output
                  </button>
                )}
                {overview && (
                  <button type="button" className={styles.ghost} onClick={() => go('troubleshoot')}>
                    Troubleshoot
                  </button>
                )}
              </div>
            </>
          )}
        </PageHero>

        <StatusNav pages={pages} current={section.id} hero={false} label="Local Stack pages" />

        {error?.helperDown && <HelperDown error={error.message} />}
        {error && !error.helperDown && (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}
        {status && !ready && (
          <div className={styles.notice}>
            <h2>Point the dashboard at your stack checkout</h2>
            <p>
              Set <code>BLUECORE_STACK_DIR</code> in the dashboard&apos;s <code>.env</code> to your bluecore-stack checkout (now: {status.stack.path ?? 'not set'}), then reload.
            </p>
          </div>
        )}
        {!status && !error && <p className={styles.muted}>Loading your stack…</p>}

        {ready && (
          <div className={styles.section}>
            {overview && <StatusOverview pages={pages} />}
            {section.id === 'services' && <Services status={status} onLogs={(s) => go('logs', {service: s})} onRun={quick} />}
            {section.id === 'logs' && <Logs call={call} status={status} service={params.get('service')} setService={(s) => go('logs', {service: s})} chat={chat} />}
            {section.id === 'jobs' && <Jobs call={call} status={status} id={params.get('job')} setId={openJob} chat={chat} refresh={refresh} />}
            {section.id === 'troubleshoot' && <Checks call={call} chat={chat} onFix={quick} onLogs={(s) => go('logs', {service: s})} />}
            {section.groups && <Actions status={status} groups={section.groups} pick={pick} onStart={startAction} onOpenJob={openJob} />}
            {section.groups && <RecentJobs jobs={sectionJobs} onOpen={openJob} />}
          </div>
        )}

        <ConfirmDialog open={stopping} title="Stop the stack?" confirmLabel="Stop it" busyLabel="Stopping…" onCancel={() => setStopping(false)} onConfirm={async () => {
          await startAction('stop', {}, false);
          setStopping(false);
        }}>
          <p>
            Runs <code>scripts/dev/down</code>: every container of the stack stops and is removed. Your data stays in the volumes, and <strong>Start the stack</strong> brings it back.
          </p>
        </ConfirmDialog>
      </main>
    </div>
  );
}
