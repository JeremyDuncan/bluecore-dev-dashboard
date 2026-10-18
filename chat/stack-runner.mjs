// Runs your bluecore-stack checkout's own dev scripts (scripts/dev, scripts/test, the Keycloak realm
// scripts) on this machine, for the Local Stack page and the stack_* MCP tools. It lives in the chat
// helper because that already runs on the host, where Docker, uv, act and the sibling checkouts are.
//
//   GET  /stack/status            Docker, the checkout, its containers, recent jobs, the actions
//   GET  /stack/logs?container=&tail=&since=   a container's log lines (stdout and stderr, by time)
//   GET  /stack/diagnose          checks with findings and suggested fixes
//   GET  /stack/jobs              recent jobs; GET /stack/job?id=&offset= one job and its output from offset
//   POST /stack/run               {action, options, confirm, by} → starts a job
//   POST /stack/stop              {id} → stops a running job (Ctrl+C, then harder)
//   POST /stack/jobs/clear        {ids?} → removes finished jobs (those ids, or all of them); running ones stay
//
// Only the MCP server calls these: every request needs the token in .devenv/token (created here, read
// by the MCP containers through their mount of this folder; JupyterLab has no such mount). Only the
// actions below run, each a fixed script with checked options, so nothing passes free text to a shell.
// Jobs run detached (their own process group, output in .devenv/jobs/<id>.log), so they keep going when
// this helper restarts: `make up`'s helper restarting doesn't stop a stack you started from the page.
import {execFile, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(REPO, '.devenv');
const JOBS = path.join(STATE, 'jobs');
const TOKEN_FILE = path.join(STATE, 'token');
const KEEP_JOBS = 100;
const MAX_LOG = 20 * 1024 * 1024; // a running job's output is trimmed to its last 2 MB past this
const STACK_URL = (process.env.BLUECORE_STACK_URL || 'http://localhost').replace(/\/$/, '');

export class RunnerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Settings: BLUECORE_STACK_DIR from the environment or this repo's .env (read on each call)

function dotenv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  return out;
}

const expandHome = (v) => v.replace(/^~(?=\/|$)/, os.homedir()).replace(/\$\{HOME\}|\$HOME\b/g, os.homedir());

// Off unless LOCAL_STACK=true (make exports it from .env; read from .env too, for `make chat` alone)
export const stackEnabled = () => /^(true|1|yes|on)$/i.test(String(process.env.LOCAL_STACK ?? dotenv(path.join(REPO, '.env')).LOCAL_STACK ?? '').trim());

export function stackDir() {
  const v = process.env.BLUECORE_STACK_DIR || dotenv(path.join(REPO, '.env')).BLUECORE_STACK_DIR;
  return v ? path.resolve(REPO, expandHome(v)) : null;
}

function requireStack() {
  const dir = stackDir();
  if (!dir) throw new RunnerError(409, 'Set BLUECORE_STACK_DIR in the dashboard\'s .env to your bluecore-stack checkout');
  if (!fs.existsSync(path.join(dir, 'scripts', 'dev', 'run'))) throw new RunnerError(409, `${dir} doesn't look like a bluecore-stack checkout (no scripts/dev/run)`);
  return dir;
}

// Docker Compose's project name for the checkout: its folder name, lowercased (as scripts/dev/clear-data does)
const projectOf = (dir) => path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, '');

// The sibling checkouts, as scripts/dev/local-repo-paths sets them
function siblings(dir) {
  const env = (k, d) => process.env[k] || d;
  return [
    {name: 'bluecore_api', dir: env('LOCAL_BLUECORE_API_DIR', path.join(dir, '../bluecore_api'))},
    {name: 'bluecore-workflows', dir: env('LOCAL_BLUECORE_WORKFLOWS_DIR', path.join(dir, '../bluecore-workflows'))},
    {name: 'bluecore-models', dir: env('LOCAL_BLUECORE_MODELS_DIR', path.join(dir, '../bluecore-models'))},
    {name: 'marva_editor', dir: env('LOCAL_MARVA_DIR', path.join(dir, '../marva_editor'))},
    {name: 'sinopia_editor', dir: env('LOCAL_SINOPIA_DIR', path.join(dir, '../sinopia_editor'))},
    {name: 'graph-toolbox', dir: env('LOCAL_GRAPH_TOOLBOX_DIR', path.join(dir, 'nginx/toolbox')), submodule: true},
  ].map((s) => ({...s, dir: path.resolve(s.dir)}));
}

// ---------- Commands

function exec(cmd, args, {timeout = 15000, cwd} = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {timeout, cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8'}, (err, stdout, stderr) =>
      resolve({ok: !err, code: err ? (typeof err.code === 'number' ? err.code : null) : 0, missing: err?.code === 'ENOENT', stdout: stdout ?? '', stderr: stderr ?? ''}),
    );
  });
}

async function which(tool) {
  const r = await exec('/usr/bin/which', [tool], {timeout: 3000});
  return r.ok ? r.stdout.trim() : null;
}

async function dockerInfo() {
  const r = await exec('docker', ['info', '--format', '{{json .}}'], {timeout: 8000});
  if (r.missing) return {installed: false, running: false};
  if (!r.ok) return {installed: true, running: false, error: (r.stderr || r.stdout).trim().split('\n').pop()};
  try {
    const i = JSON.parse(r.stdout);
    return {installed: true, running: true, version: i.ServerVersion, memory: i.MemTotal, cpus: i.NCPU};
  } catch {
    return {installed: true, running: true};
  }
}

const SEP = '\u001f';
export async function containers(project) {
  const format = ['{{.Names}}', '{{.State}}', '{{.Status}}', '{{.Ports}}', '{{.Image}}', '{{.Label "com.docker.compose.service"}}', '{{.RunningFor}}', '{{.Label "com.docker.compose.oneoff"}}'].join(SEP);
  const r = await exec('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', format]);
  if (!r.ok) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, state, status, ports, image, service, runningFor, oneOff] = line.split(SEP);
      const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]?.replace('health: ', '') ?? null;
      const exitCode = /^Exited \((\d+)\)/.exec(status)?.[1];
      return {name, service: service || name, state, status, health, exitCode: exitCode == null ? null : Number(exitCode), ports, image, runningFor, oneOff: oneOff === 'True'};
    })
    .filter((c) => !c.oneOff) // `docker compose run` containers (realm export, tests)
    .sort((a, b) => a.service.localeCompare(b.service));
}

// The stack's pages, through its nginx (scripts/dev/run always starts nginx)
const LINKS = [
  {label: 'Home', path: '/'},
  {label: 'API docs', path: '/api/docs'},
  {label: 'Sinopia', path: '/sinopia/', service: 'sinopia'},
  {label: 'Marva', path: '/marva/', service: 'marva'},
  {label: 'Airflow', path: '/workflows/', service: 'airflow-apiserver'},
  {label: 'Keycloak', path: '/keycloak/admin/', service: 'keycloak'},
];

// ---------- Actions: each one of the stack's scripts, with the options the page and the agents may set

const URL_RE = /^https?:\/\/[^\s'"`<>]{1,500}$/;
const REF_RE = /^(?!-)[\w.\/-]{1,100}$/;

function scriptDefault(dir, file, name) {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf8').match(new RegExp(`^${name}="([^"]+)"`, 'm'))?.[1] ?? null;
  } catch {
    return null;
  }
}

export const ACTIONS = [
  {
    id: 'install',
    group: 'Set up',
    title: 'Install or repair',
    script: 'scripts/dev/update-stack --install',
    description: 'Clones any missing sibling repos (bluecore_api, bluecore-models, bluecore-workflows, marva_editor, sinopia_editor), sets up the graph-toolbox submodule and creates missing .env files from the templates. Never overwrites a file and never pulls.',
    command: () => ['scripts/dev/update-stack', '--install'],
  },
  {
    id: 'check_updates',
    group: 'Set up',
    title: 'Check for updates',
    script: 'scripts/dev/update-stack --check',
    description: "Fetches each repo and reports whether its branch is behind its base branch (main, or Marva's bluecore-dev-mvp). Changes nothing.",
    command: () => ['scripts/dev/update-stack', '--check'],
  },
  {
    id: 'update',
    group: 'Set up',
    title: 'Update the repos',
    script: 'scripts/dev/update-stack',
    description: 'Pulls each base branch, then merges (or rebases) it into the branch each repo is on. Repos with uncommitted changes are skipped (it only stashes them when run in a terminal).',
    danger: (o) => (o.dry_run ? null : `${o.strategy === 'rebase' ? 'Rebases' : 'Merges'} the base branches into the branches your sibling repos are on.`),
    options: [
      {name: 'strategy', type: 'choice', choices: ['merge', 'rebase'], default: 'merge', label: 'How to bring in the base branch'},
      {name: 'dry_run', type: 'boolean', label: 'Dry run: only print what it would do'},
    ],
    command: (o) => ['scripts/dev/update-stack', `--${o.strategy}`, ...(o.dry_run ? ['--dry-run'] : [])],
  },
  {
    id: 'start',
    group: 'Run',
    title: 'Start the stack',
    script: 'scripts/dev/run',
    long: true,
    description: 'Builds and starts the stack from your local checkouts (or the published images). postgres, keycloak, nginx and the API always run. The job keeps running and shows the services\' output while the stack is up; stopping the job is like Ctrl+C.',
    options: [
      {name: 'services', type: 'multi', choices: ['marva', 'sinopia', 'airflow'], label: 'Only these, besides the core (none picked: everything)'},
      {name: 'core_only', type: 'boolean', label: 'Core only: postgres, keycloak, nginx and the API (--api)'},
      {name: 'image', type: 'boolean', label: 'Published images from GHCR instead of your checkouts (--image, always everything)'},
    ],
    command: (o) => ['scripts/dev/run', ...(o.image ? ['--image'] : o.core_only ? ['--api'] : (o.services ?? []).map((s) => `--${s}`))],
  },
  {
    id: 'stop',
    group: 'Run',
    title: 'Stop the stack',
    script: 'scripts/dev/down',
    description: 'Stops and removes every container of the stack and its network. Your data stays in the volumes.',
    command: () => ['scripts/dev/down'],
  },
  {
    id: 'restart_service',
    group: 'Run',
    title: 'Restart a service',
    script: 'docker restart <container>',
    description: 'Restarts one container of the stack, e.g. after changing its settings or when it hangs.',
    options: [{name: 'service', type: 'service', required: true, label: 'Service'}],
    command: (o) => ['docker', 'restart', o.service],
  },
  {
    id: 'reset',
    group: 'Run',
    title: 'Stop and delete all data',
    script: 'scripts/dev/down --volumes',
    description: 'Stops the stack and deletes its volumes: the Postgres databases (Blue Core, Keycloak, Airflow). The next start begins from scratch.',
    danger: () => 'Deletes every record, Keycloak user and Airflow run in your local stack.',
    command: () => ['scripts/dev/down', '--volumes'],
  },
  {
    id: 'load_data',
    group: 'Data',
    title: 'Load data',
    script: 'scripts/dev/load-data <url>',
    description: 'Uploads Bibframe JSON-LD into the local stack with the bluecore CLI (fetched by uv). Without a URL it loads the default dev dataset. Needs the stack running.',
    options: [{name: 'url', type: 'url', label: 'JSON-LD URL (empty: the default dev dataset)'}],
    command: (o, dir) => ['scripts/dev/load-data', o.url || scriptDefault(dir, 'scripts/dev/load-data', 'DEFAULT_DEV_DATA_URL')],
  },
  {
    id: 'load_profiles',
    group: 'Data',
    title: 'Load Sinopia profiles',
    script: 'scripts/dev/load-profiles <remote>',
    description: 'Copies the resource templates ("profiles") from a deployed Blue Core into the local stack. Needs the stack running.',
    options: [
      {name: 'remote', type: 'url', label: 'Copy from', placeholder: 'https://dev.bcld.info'},
      {name: 'dry_run', type: 'boolean', label: 'Dry run: fetch and report, write nothing'},
    ],
    command: (o, dir) => ['scripts/dev/load-profiles', o.remote || scriptDefault(dir, 'scripts/dev/load-profiles', 'DEFAULT_REMOTE_HOST'), ...(o.dry_run ? ['--dry-run'] : [])],
  },
  {
    id: 'clear_data',
    group: 'Data',
    title: 'Clear loaded data',
    script: 'scripts/dev/clear-data --yes',
    description: 'Empties the Blue Core tables (works, instances, hubs, …) but keeps the schema, so the stack keeps running.',
    danger: (o) => `Deletes every resource in your local Blue Core database${o.keep_profiles ? ' except the profiles' : ''}${o.uploads ? ', and the uploaded batch files' : ''}.`,
    options: [
      {name: 'keep_profiles', type: 'boolean', label: 'Keep the Sinopia profiles'},
      {name: 'uploads', type: 'boolean', label: 'Also delete uploaded batch files (uploads/)'},
    ],
    command: (o) => ['scripts/dev/clear-data', '--yes', ...(o.keep_profiles ? ['--keep-profiles'] : []), ...(o.uploads ? ['--uploads'] : [])],
  },
  {
    id: 'export_realm',
    group: 'Keycloak',
    title: 'Export the realm',
    script: 'scripts/export-keycloak-realm.sh',
    description: "Writes the local bluecore realm (clients, roles, users) to keycloak-export/development/bluecore-realm.json in bluecore-stack, a committed file: review the diff before committing.",
    command: () => ['scripts/export-keycloak-realm.sh', '--env=development'],
  },
  {
    id: 'import_realm',
    group: 'Keycloak',
    title: 'Import the realm',
    script: 'scripts/import-keycloak-realm.sh',
    description: 'Replaces the local bluecore realm with keycloak-export/development/bluecore-realm.json, e.g. after pulling a realm change.',
    danger: () => 'Replaces your local bluecore realm: users created since the export are removed.',
    command: () => ['scripts/import-keycloak-realm.sh', '--env=development'],
  },
  {
    id: 'integration_tests',
    group: 'Tests',
    title: 'Integration tests',
    script: 'scripts/test/integration-tests.sh',
    long: true,
    description: "Runs the pytest integration suite. By default in its own stack (project terraform_integration), which it builds, tests and removes: that takes a while and needs memory next to your dev stack. Dev mode keeps that stack up between runs, for quicker reruns.",
    options: [
      {name: 'dev_mode', type: 'boolean', label: 'Dev mode: keep the test stack up between runs (--dev-mode)'},
      {name: 'tests', type: 'tests', label: 'Tests to run'},
      {name: 'match', type: 'match', label: 'Only tests whose name matches (pytest -k, optional)', placeholder: 'health and not slow'},
      {name: 'api_ref', type: 'ref', label: 'Build bluecore_api from this branch or tag'},
      {name: 'workflows_ref', type: 'ref', label: 'Build bluecore-workflows from'},
      {name: 'marva_ref', type: 'ref', label: 'Build Marva from'},
      {name: 'models_ref', type: 'ref', label: 'Migrate with bluecore-models from'},
    ],
    command: (o) => [
      'scripts/test/integration-tests.sh',
      ...(o.dev_mode ? ['--dev-mode'] : []),
      ...['api', 'workflows', 'marva', 'models'].flatMap((k) => (o[`${k}_ref`] ? [`--${k}-ref`, o[`${k}_ref`]] : [])),
      ...(o.tests ? [o.tests] : []),
      ...(o.match ? ['-k', o.match] : []),
    ],
  },
  {
    id: 'integration_tests_stop',
    group: 'Tests',
    title: 'Remove the dev-mode test stack',
    script: 'scripts/test/integration-tests.sh --dev-mode-stop',
    description: 'Stops the stack that dev-mode integration test runs leave up, and removes its containers, images and volumes.',
    command: () => ['scripts/test/integration-tests.sh', '--dev-mode-stop'],
  },
  {
    id: 'workflow_tests',
    group: 'Tests',
    title: 'Workflow tests (act)',
    script: 'scripts/test/workflow-tests.sh',
    long: true,
    description: "Runs the repo's GitHub Actions integration workflow locally with act. Needs act and a .secrets file in bluecore-stack.",
    options: [
      {name: 'local', type: 'multi', choices: ['api', 'workflows', 'models'], label: 'Use your local checkouts of (none: the published images)'},
      {name: 'api_ref', type: 'ref', label: 'Build bluecore_api from this branch or tag'},
      {name: 'workflows_ref', type: 'ref', label: 'Build bluecore-workflows from'},
      {name: 'models_ref', type: 'ref', label: 'Migrate with bluecore-models from'},
    ],
    command: (o) => [
      'scripts/test/workflow-tests.sh',
      ...(o.local ?? []).map((k) => `--local-${k}`),
      ...['api', 'workflows', 'models'].flatMap((k) => (o[`${k}_ref`] ? [`--${k}-ref`, o[`${k}_ref`]] : [])),
    ],
  },
  {
    id: 'slow_queries',
    group: 'Debug',
    title: 'Watch slow query plans',
    script: 'scripts/dev/database/explain --since <time>',
    long: true,
    description: 'Follows the query plans Postgres logs for slow queries (auto_explain), colored. Needs POSTGRES_EXPLAIN_SLOW_QUERY_MS in the stack\'s .env. Runs until you stop it.',
    options: [{name: 'since', type: 'since', default: '10m', label: 'Also show the last', placeholder: '10m'}],
    command: (o) => ['scripts/dev/database/explain', '--since', o.since || '10m'],
  },
];

const byId = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// What the page and the tools see of the actions (no command functions)
export const actionList = () =>
  ACTIONS.map(({command, danger, ...a}) => ({...a, options: a.options ?? [], danger: Boolean(danger), dangerText: danger?.({}) ?? null}));

const CHECKS = {
  boolean: (v) => v === true || v === 'true',
  url: (v) => (v === '' || v == null ? '' : URL_RE.test(v) ? v : bad('a http(s) URL')),
  ref: (v) => (v === '' || v == null ? '' : REF_RE.test(v) ? v : bad('a branch, tag or commit')),
  tests: (v) => (v === '' || v == null ? '' : /^tests\/[\w\/.-]+(::[\w\[\].-]+)*$/.test(v) && !v.includes('..') ? v : bad('a path under tests/, optionally with ::test_name')),
  match: (v) => (v === '' || v == null ? '' : /^[\w\s().-]{1,120}$/.test(v) ? v : bad('letters, digits, spaces, parentheses and dots (pytest -k)')),
  since: (v) => (v === '' || v == null ? '' : /^\d{1,4}[smh]$/.test(v) ? v : bad('a time like 10m, 2h or 30s')),
};
function bad(what) {
  throw new RunnerError(400, `must be ${what}`);
}

async function checkOptions(action, raw, dir) {
  const out = {};
  for (const opt of action.options ?? []) {
    const v = raw?.[opt.name];
    try {
      if (opt.type === 'choice') out[opt.name] = v == null || v === '' ? opt.default : opt.choices.includes(v) ? v : bad(`one of ${opt.choices.join(', ')}`);
      else if (opt.type === 'multi') out[opt.name] = v == null ? [] : Array.isArray(v) && v.every((x) => opt.choices.includes(x)) ? [...new Set(v)] : bad(`a list of ${opt.choices.join(', ')}`);
      else if (opt.type === 'service') {
        const list = await containers(projectOf(dir));
        const hit = list.find((c) => c.name === v || c.service === v);
        out[opt.name] = hit ? hit.name : bad(`one of the stack's services: ${list.map((c) => c.service).join(', ') || '(none running)'}`);
      } else out[opt.name] = CHECKS[opt.type](v);
      if (opt.required && !out[opt.name]) bad('set');
    } catch (err) {
      throw new RunnerError(400, `${action.id}: option "${opt.name}" ${err.message}`);
    }
  }
  const unknown = Object.keys(raw ?? {}).filter((k) => !(action.options ?? []).some((o) => o.name === k));
  if (unknown.length) throw new RunnerError(400, `${action.id}: unknown option ${unknown.join(', ')} (options: ${(action.options ?? []).map((o) => o.name).join(', ') || 'none'})`);
  return out;
}

// ---------- Jobs

const jobPath = (id, ext) => path.join(JOBS, `${id}.${ext}`);
const ID_RE = /^[a-z0-9]+-[a-f0-9]{6}$/;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

function readJob(id) {
  if (!ID_RE.test(id ?? '')) throw new RunnerError(400, 'Unknown job id');
  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath(id, 'json'), 'utf8'));
  } catch {
    throw new RunnerError(404, `No job ${id}`);
  }
  if (job.exitCode == null) {
    const code = fs.existsSync(jobPath(id, 'exit')) ? Number(fs.readFileSync(jobPath(id, 'exit'), 'utf8')) : null;
    if (code != null && !Number.isNaN(code)) {
      job.exitCode = code;
      job.endedAt = fs.statSync(jobPath(id, 'exit')).mtime.toISOString();
      fs.writeFileSync(jobPath(id, 'json'), JSON.stringify(job, null, 1));
    }
  }
  const status = job.exitCode != null ? (job.exitCode === 0 ? 'succeeded' : job.stopRequested ? 'stopped' : 'failed') : alive(job.pid) ? 'running' : job.stopRequested ? 'stopped' : 'ended';
  let size = 0;
  try {
    size = fs.statSync(jobPath(id, 'log')).size;
  } catch {}
  return {...job, status, outputSize: size};
}

export function listJobs(limit = 30) {
  let ids = [];
  try {
    ids = fs.readdirSync(JOBS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id));
  } catch {}
  return ids
    .sort()
    .reverse()
    .slice(0, limit)
    .map((id) => {
      try {
        return readJob(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function pruneJobs() {
  const all = listJobs(10000);
  for (const job of all.slice(KEEP_JOBS)) {
    if (job.status === 'running') continue;
    for (const ext of ['json', 'log', 'exit']) fs.rmSync(jobPath(job.id, ext), {force: true});
  }
}

export async function startJob(actionId, rawOptions = {}, {confirm = false, by = 'page'} = {}) {
  const action = byId[actionId];
  if (!action) throw new RunnerError(400, `Unknown action "${actionId}". Actions: ${ACTIONS.map((a) => a.id).join(', ')}`);
  const dir = requireStack();
  const options = await checkOptions(action, rawOptions, dir);
  const warning = action.danger?.(options);
  if (warning && !confirm) throw new RunnerError(409, `${action.title}: ${warning} Run it again with confirm: true once the user has agreed.`);
  const running = listJobs().find((j) => j.action === action.id && j.status === 'running' && (action.id !== 'restart_service' || j.options?.service === options.service));
  if (running) throw new RunnerError(409, `"${action.title}" is already running (job ${running.id}). Stop it first, or follow its output.`);
  const [cmd, ...args] = action.command(options, dir);
  if (args.some((a) => a == null)) throw new RunnerError(500, `${action.title}: couldn't find the script's default`);

  fs.mkdirSync(JOBS, {recursive: true});
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const out = fs.openSync(jobPath(id, 'log'), 'a');
  // The exit code goes to a file, so it's known even when this helper restarted in the meantime
  const child = spawn('/bin/bash', ['-c', '"$@"; code=$?; printf %s "$code" > "$DEVENV_EXIT"; exit $code', 'devenv', cmd.includes('/') ? path.join(dir, cmd) : cmd, ...args], {
    cwd: dir,
    detached: true, // its own process group: Stop signals the whole script, and it outlives this helper
    stdio: ['ignore', out, out],
    env: {...process.env, DEVENV_EXIT: jobPath(id, 'exit'), CLICOLOR_FORCE: '1', FORCE_COLOR: '1', COMPOSE_ANSI: 'always'},
  });
  fs.closeSync(out);
  const job = {id, action: action.id, title: action.title, command: [cmd, ...args].join(' '), options, by, pid: child.pid, startedAt: new Date().toISOString(), long: Boolean(action.long)};
  child.on('error', (err) => fs.appendFileSync(jobPath(id, 'log'), `\n[dashboard] couldn't start: ${err.message}\n`));
  child.unref();
  fs.writeFileSync(jobPath(id, 'json'), JSON.stringify(job, null, 1));
  pruneJobs();
  return readJob(id);
}

// Removes finished jobs and their output: the ids given, or every finished job. Running jobs are kept.
export function clearJobs(ids) {
  if (ids != null && (!Array.isArray(ids) || ids.some((id) => !ID_RE.test(id)))) throw new RunnerError(400, 'ids: a list of job ids');
  const removed = [];
  for (const job of listJobs(10000)) {
    if (job.status === 'running' || (ids && !ids.includes(job.id))) continue;
    for (const ext of ['json', 'log', 'exit']) fs.rmSync(jobPath(job.id, ext), {force: true});
    removed.push(job.id);
  }
  return {removed, kept: listJobs(10000).filter((j) => j.status === 'running').map((j) => j.id)};
}

export function stopJob(id) {
  const job = readJob(id);
  if (job.status !== 'running') return job;
  const {status, outputSize, ...saved} = job;
  fs.writeFileSync(jobPath(id, 'json'), JSON.stringify({...saved, stopRequested: true, stoppedAt: new Date().toISOString()}, null, 1));
  const signal = (sig) => {
    try {
      process.kill(-job.pid, sig);
    } catch {}
  };
  signal('SIGINT'); // like Ctrl+C: docker compose up stops the containers cleanly
  setTimeout(() => alive(job.pid) && signal('SIGTERM'), 15000).unref();
  setTimeout(() => alive(job.pid) && signal('SIGKILL'), 45000).unref();
  return readJob(id);
}

// Output from byte `offset` (at most `max` bytes); `tail` instead returns the last lines
export function jobOutput(id, {offset = 0, max = 256 * 1024, tail} = {}) {
  const job = readJob(id);
  const file = jobPath(id, 'log');
  const size = job.outputSize;
  let start = Math.max(0, Number(offset) || 0);
  let reset = false;
  if (start > size) {
    start = 0; // the log was trimmed since
    reset = true;
  }
  if (tail) start = Math.max(0, size - Math.min(max, 512 * 1024));
  const length = Math.min(max, size - start);
  const buf = Buffer.alloc(Math.max(0, length));
  if (length > 0) {
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, length, start);
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (tail) text = text.split('\n').slice(-(Number(tail) + 1)).join('\n');
  return {job, text, offset: start + length, reset, more: start + length < size};
}

// Long jobs (an attached `docker compose up`) can print without end: keep their logs to the last 2 MB
setInterval(() => {
  for (const job of listJobs().filter((j) => j.status === 'running' && j.outputSize > MAX_LOG)) {
    try {
      const {text} = jobOutput(job.id, {offset: job.outputSize - 2 * 1024 * 1024, max: 2 * 1024 * 1024});
      fs.truncateSync(jobPath(job.id, 'log'), 0);
      fs.appendFileSync(jobPath(job.id, 'log'), `[dashboard] earlier output trimmed\n${text.slice(text.indexOf('\n') + 1)}`);
    } catch {}
  }
}, 60_000).unref();

// ---------- Logs

// RFC 3339 timestamps sort as text once the fraction has the same length
const tsKey = (ts) => ts.replace(/\.(\d+)Z$/, (m, f) => `.${f.padEnd(9, '0')}Z`).replace(/Z$/, '');

export async function containerLogs({container, tail = 300, since} = {}) {
  const dir = requireStack();
  const list = await containers(projectOf(dir));
  const c = list.find((x) => x.name === container || x.service === container);
  if (!c) throw new RunnerError(404, `No service "${container}" in the stack. Services: ${list.map((x) => x.service).join(', ') || '(none)'}`);
  const n = Math.min(5000, Math.max(1, Number(tail) || 300));
  if (since && !/^(\d{1,5}[smhd]?|\d{4}-\d\d-\d\dT[\d:.]+Z?)$/.test(since)) throw new RunnerError(400, 'since: a time like 10m or 2h, or an RFC 3339 timestamp');
  const r = await exec('docker', ['logs', '--timestamps', '--tail', String(n), ...(since ? ['--since', since] : []), c.name], {timeout: 20000});
  if (!r.ok && !r.stdout && !r.stderr) throw new RunnerError(502, `docker logs failed for ${c.name}`);
  const parse = (text, stream) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d{4}-\d\d-\d\dT\S+Z) ?(.*)$/);
        return m ? {ts: m[1], text: m[2], stream} : {ts: '', text: line, stream};
      });
  const lines = [...parse(r.stdout, 'out'), ...parse(r.stderr, 'err')].sort((a, b) => (tsKey(a.ts) < tsKey(b.ts) ? -1 : tsKey(a.ts) > tsKey(b.ts) ? 1 : 0));
  return {container: c.name, service: c.service, state: c.state, lines: lines.slice(-n)};
}

// ---------- The checkout's pytest tests (for the Integration tests picker)

// Every tests/**/test_*.py with its tests: top-level `def test_…` and the test methods of `class Test…`,
// as pytest ids (file::test, file::Class::test). Read from the files, so nothing needs Python.
export function testCatalog(dir) {
  const root = path.join(dir, 'tests');
  const files = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, {withFileTypes: true});
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__pycache__') walk(path.join(d, e.name));
      else if (e.isFile() && /^test_.*\.py$/.test(e.name)) files.push(path.join(d, e.name));
    }
  };
  walk(root);
  return files.map((file) => {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const tests = [];
    let cls = null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const c = line.match(/^class (Test\w*)\b/);
      if (c) cls = c[1];
      else if (/^\S/.test(line) && !/^[@#)]/.test(line)) cls = null; // back at the top level
      const top = line.match(/^(?:async )?def (test_\w+)/);
      const method = cls && line.match(/^\s+(?:async )?def (test_\w+)/);
      if (top) tests.push(top[1]);
      else if (method) tests.push(`${cls}::${method[1]}`);
    }
    return {path: rel, folder: path.posix.dirname(rel), tests};
  });
}

// ---------- Status and diagnosis

export async function status() {
  const dir = stackDir();
  const [docker, tools] = await Promise.all([dockerInfo(), Promise.all(['docker', 'git', 'uv', 'act'].map(async (t) => [t, Boolean(await which(t))])).then(Object.fromEntries)]);
  const configured = Boolean(dir && fs.existsSync(path.join(dir, 'scripts', 'dev', 'run')));
  const list = configured && docker.running ? await containers(projectOf(dir)) : [];
  let branch = null;
  if (configured) branch = (await exec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {timeout: 5000})).stdout.trim() || null;
  const has = (s) => list.some((c) => c.service.startsWith(s) && c.state === 'running');
  return {
    stack: {configured, path: dir, project: dir ? projectOf(dir) : null, branch, url: STACK_URL},
    docker,
    tools,
    containers: list,
    links: list.some((c) => c.service === 'nginx' && c.state === 'running') ? LINKS.filter((l) => !l.service || has(l.service)).map((l) => ({label: l.label, url: STACK_URL + l.path})) : [],
    jobs: listJobs(20),
    actions: actionList(),
    tests: configured ? testCatalog(dir) : [],
  };
}

const ERROR_LINE = /\b(ERROR|CRITICAL|FATAL|Traceback|Exception|panic)\b|\blevel=error\b|"level":\s*"error"/i;
const GiB = 1024 ** 3;

async function portOwner(port) {
  const r = await exec('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {timeout: 4000});
  const line = r.stdout.split('\n')[1];
  return line ? line.split(/\s+/)[0] : null;
}

async function httpCheck(url) {
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(5000), redirect: 'manual'});
    return res.status < 500 ? null : `HTTP ${res.status}`;
  } catch (err) {
    return err.cause?.code ?? err.name ?? err.message;
  }
}

export async function diagnose() {
  const findings = [];
  const add = (level, title, detail, extra = {}) => findings.push({level, title, detail, ...extra});
  const dir = stackDir();

  const docker = await dockerInfo();
  if (!docker.installed) add('error', "Docker isn't installed", 'The docker command is not on the PATH of the helper (started by make up / make prod). Install Docker Desktop.');
  else if (!docker.running) add('error', "Docker isn't running", `Start Docker Desktop, then check again. (${docker.error ?? 'no answer from the Docker daemon'})`);
  else {
    const gb = docker.memory ? docker.memory / GiB : null;
    if (gb && gb < 8) add('error', `Docker has only ${gb.toFixed(1)} GB of memory`, 'The full stack needs about 6 GB, plus whatever else runs in Docker (this dashboard, JupyterLab, the integration test stack). Raise it in Docker Desktop → Settings → Resources (12 GB is comfortable).');
    else if (gb && gb < 10) add('warn', `Docker has ${gb.toFixed(1)} GB of memory`, 'Enough for the stack, but tight with this dashboard and an integration test stack beside it; containers may be killed (exit 137). 12 GB is comfortable.');
    else add('ok', `Docker ${docker.version ?? ''} is running`, gb ? `${gb.toFixed(1)} GB of memory, ${docker.cpus} CPUs` : '');
  }

  if (!dir) {
    add('error', 'No stack checkout set', 'Set BLUECORE_STACK_DIR in the dashboard\'s .env to your bluecore-stack checkout.');
    return {checkedAt: new Date().toISOString(), findings};
  }
  if (!fs.existsSync(path.join(dir, 'scripts', 'dev', 'run'))) {
    add('error', 'The stack checkout is missing', `${dir} has no scripts/dev/run. Check BLUECORE_STACK_DIR in the dashboard's .env.`);
    return {checkedAt: new Date().toISOString(), findings};
  }

  // Sibling checkouts and their .env files (what scripts/dev/update-stack --install sets up)
  const install = {action: 'install', label: 'Install or repair'};
  const missing = siblings(dir).filter((s) => !fs.existsSync(s.dir) || (s.submodule && fs.readdirSync(s.dir).length === 0));
  if (missing.length) add('error', `Missing ${missing.map((s) => s.name).join(', ')}`, `The local build mounts these checkouts: ${missing.map((s) => s.dir).join(', ')}.`, {fix: install});
  else add('ok', 'All sibling checkouts are there', siblings(dir).map((s) => s.name).join(', '));
  const templates = path.join(dir, 'scripts', 'dev', 'env-templates');
  const noEnv = [];
  if (!fs.existsSync(path.join(dir, '.env'))) noEnv.push('bluecore-stack');
  for (const s of siblings(dir)) if (fs.existsSync(path.join(templates, `${path.basename(s.dir)}.env`)) && fs.existsSync(s.dir) && !fs.existsSync(path.join(s.dir, '.env'))) noEnv.push(s.name);
  if (noEnv.length) add('error', `No .env in ${noEnv.join(', ')}`, 'Created from scripts/dev/env-templates by the install.', {fix: install});

  // Containers
  if (docker.running) {
    const list = await containers(projectOf(dir));
    const running = list.filter((c) => c.state === 'running');
    const tailOf = async (c, n = 25) => (await containerLogs({container: c.name, tail: n}).catch(() => ({lines: []}))).lines.map((l) => l.text);
    if (!running.length) {
      add('warn', "The stack isn't running", list.length ? `${list.length} stopped containers.` : 'No containers yet.', {fix: {action: 'start', label: 'Start the stack'}});
      // What would stop it from starting: ports taken by something else
      for (const port of [80, 5432]) {
        const owner = await portOwner(port);
        if (owner && !/docker|com\.docke|vpnkit/i.test(owner)) add('error', `Port ${port} is taken by ${owner}`, `The stack's ${port === 80 ? 'nginx' : 'Postgres'} needs it. Stop ${owner} first.`);
      }
    }
    for (const c of list) {
      const restart = {action: 'restart_service', options: {service: c.service}, label: `Restart ${c.service}`};
      if (c.state === 'restarting') add('error', `${c.service} keeps restarting`, c.status, {service: c.service, logs: await tailOf(c), fix: restart});
      else if (c.state === 'exited' && c.exitCode !== 0) add('error', `${c.service} stopped with exit code ${c.exitCode}`, c.exitCode === 137 ? 'Exit code 137 usually means Docker ran out of memory and killed it.' : c.status, {service: c.service, logs: await tailOf(c), fix: restart});
      else if (c.state === 'dead' || c.state === 'created') add('warn', `${c.service} is ${c.state}`, c.status, {service: c.service, fix: restart});
      else if (c.health === 'unhealthy') add('error', `${c.service} is unhealthy`, c.status, {service: c.service, logs: await tailOf(c), fix: restart});
      else if (c.health === 'starting') add('info', `${c.service} is still starting`, c.status, {service: c.service});
    }
    if (running.length) {
      const bad = list.filter((c) => c.state !== 'running' && !(c.state === 'exited' && c.exitCode === 0));
      add(bad.length ? 'warn' : 'ok', `${running.length} of ${list.length} services running`, list.filter((c) => c.state === 'exited' && c.exitCode === 0).map((c) => `${c.service} finished (a one-time setup step)`).join('; '));

      // Errors in the last 15 minutes
      const recent = await Promise.all(
        running.map(async (c) => {
          const {lines} = await containerLogs({container: c.name, tail: 2000, since: '15m'}).catch(() => ({lines: []}));
          return {c, errors: lines.filter((l) => ERROR_LINE.test(l.text))};
        }),
      );
      for (const {c, errors} of recent.filter((r) => r.errors.length)) {
        add('warn', `${c.service}: ${errors.length} error line${errors.length === 1 ? '' : 's'} in the last 15 minutes`, 'The latest ones are below; open its logs for context.', {service: c.service, logs: errors.slice(-8).map((l) => `${l.ts.slice(11, 19)} ${l.text}`)});
      }

      // The stack's pages, through nginx
      if (running.some((c) => c.service === 'nginx')) {
        const checks = [
          ['API', '/api/', 'bc_api'],
          ['Keycloak', '/keycloak/realms/bluecore', 'keycloak'],
          ['Airflow', '/workflows/health', 'airflow-apiserver'],
          ['Sinopia', '/sinopia/health', 'sinopia'],
          ['Marva', '/marva/health', 'marva'],
        ].filter(([, , svc]) => running.some((c) => c.service === svc));
        const results = await Promise.all(checks.map(async ([label, p, svc]) => [label, p, svc, await httpCheck(STACK_URL + p)]));
        const failing = results.filter((r) => r[3]);
        for (const [label, p, svc, err] of failing) add('error', `${label} doesn't answer at ${STACK_URL}${p}`, `${err}. Its container runs, so look at the ${svc} and nginx logs.`, {service: svc, fix: {action: 'restart_service', options: {service: svc}, label: `Restart ${svc}`}});
        if (!failing.length && results.length) add('ok', `${results.map((r) => r[0]).join(', ')} answer through nginx`, STACK_URL);
      }
    }
  }

  // Tools some actions need
  const [uv, act] = await Promise.all([which('uv'), which('act')]);
  if (!uv) add('info', "uv isn't installed", 'Load data and Load profiles run the bluecore CLI with uv: https://docs.astral.sh/uv/');
  if (!act) add('info', "act isn't installed", 'Workflow tests run GitHub Actions locally with act: https://nektosact.com');
  if (!fs.existsSync(path.join(dir, '.secrets')) && act) add('info', 'No .secrets file in bluecore-stack', 'Workflow tests (act) read their secrets from it.');

  const order = {error: 0, warn: 1, info: 2, ok: 3};
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return {checkedAt: new Date().toISOString(), findings};
}

// ---------- HTTP (mounted by chat/server.mjs under /stack/)

function token() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    fs.mkdirSync(STATE, {recursive: true});
    const t = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, t, {mode: 0o600});
    return t;
  }
}
token(); // create it at startup, so the MCP server can read it before the first request

const sendJson = (res, code, body) => res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(body));

export async function handleStack(req, res, url) {
  const given = Buffer.from(String(req.headers['x-stack-token'] ?? ''));
  const expected = Buffer.from(token());
  if (req.headers.origin || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    sendJson(res, 401, {error: 'Only the dashboard\'s MCP server may run stack scripts'});
    return;
  }
  if (!stackEnabled()) {
    sendJson(res, 404, {error: 'The Local Stack pages are turned off (set LOCAL_STACK=true in .env)'});
    return;
  }
  const route = url.pathname.replace(/^\/stack/, '');
  const q = url.searchParams;
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
    if (route === '/status' && req.method === 'GET') return sendJson(res, 200, await status());
    if (route === '/diagnose' && req.method === 'GET') return sendJson(res, 200, await diagnose());
    if (route === '/logs' && req.method === 'GET') return sendJson(res, 200, await containerLogs({container: q.get('container'), tail: q.get('tail'), since: q.get('since') || undefined}));
    if (route === '/jobs' && req.method === 'GET') return sendJson(res, 200, {jobs: listJobs(Number(q.get('limit')) || 30)});
    if (route === '/job' && req.method === 'GET') return sendJson(res, 200, jobOutput(q.get('id'), {offset: q.get('offset'), tail: q.get('tail') ? Number(q.get('tail')) : undefined}));
    if (route === '/run' && req.method === 'POST') return sendJson(res, 200, {job: await startJob(body.action, body.options, {confirm: body.confirm === true, by: String(body.by ?? 'page').slice(0, 80)})});
    if (route === '/stop' && req.method === 'POST') return sendJson(res, 200, {job: stopJob(body.id)});
    if (route === '/jobs/clear' && req.method === 'POST') return sendJson(res, 200, clearJobs(body.ids));
    sendJson(res, 404, {error: 'Unknown stack endpoint'});
  } catch (err) {
    sendJson(res, err instanceof RunnerError ? err.status : err instanceof SyntaxError ? 400 : 500, {error: err.message});
  }
}
