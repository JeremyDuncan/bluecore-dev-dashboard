// The developer's own Bluecore: their bluecore-stack checkout and the environments notebooks run against.
//
// BLUECORE_STACK_DIR: the bluecore-stack checkout (docker-compose.yml mounts it read-only at
// /bluecore-stack; BLUECORE_STACK_SOURCE is the path on the host, for display). Used by the local_stack
// MCP tool and the Notebooks page; JupyterLab gets the same mount (docker/jupyter/bluecore.py).
//
// Environments: "local" plus the deployed sites in docs-sources.json (projectStatus.versionDrift.environments),
// the same list the Version Drift page probes. A notebook's environment is metadata.bluecore.target.
//
// redact(): notebook outputs and stack files go to AI providers, so values of the stack's secret
// settings and of the deployed environments' logins (.env.notebooks) are replaced before they leave.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = path.join(REPO, 'docs-sources.json');
export const STACK = process.env.BLUECORE_STACK_DIR ? path.resolve(REPO, process.env.BLUECORE_STACK_DIR) : null;
const MAX_FILE_BYTES = 200_000;

export class StackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Environments --------------------------------------------------------------------------------

export function environments() {
  let deployed = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
    deployed = (cfg.projectStatus?.versionDrift?.environments ?? []).filter((e) => e.name && e.url && e.name !== 'local');
  } catch {
    // no config: local only
  }
  return [{name: 'local', url: null, deployed: false}, ...deployed.map((e) => ({name: e.name, url: e.url.replace(/\/$/, ''), deployed: true}))];
}

export function checkTarget(name) {
  const t = String(name ?? '').trim() || 'local';
  if (!environments().some((e) => e.name === t)) throw new StackError(400, `No environment "${name}". Environments: ${environments().map((e) => e.name).join(', ')}`);
  return t;
}

// --- The stack checkout --------------------------------------------------------------------------

const hasStack = () => !!STACK && ['compose-base.yaml', 'compose.yaml', 'docker-compose.yml'].some((f) => fs.existsSync(path.join(STACK, f)));
const shownPath = () => process.env.BLUECORE_STACK_SOURCE || STACK;

function git(...args) {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', '-C', STACK, ...args], {encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null; // no git in this image (mcp-prod), or not a repository
  }
}

// Branch without git: .git/HEAD
function headBranch() {
  try {
    const head = fs.readFileSync(path.join(STACK, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
  } catch {
    return null;
  }
}

// KEY=value lines of a .env file
function envFile(file) {
  const values = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).replace(/^export\s+/, '').trim();
    let value = line.slice(i + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && `"'`.includes(value[0])) value = value.slice(1, -1);
    else value = value.split(' #')[0].trim();
    values[key] = value;
  }
  return values;
}

// Services in a compose file: the keys under "services:" (two-space indent), without a YAML parser
function composeServices(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  let inServices = false;
  for (const line of text.split('\n')) {
    if (/^services:\s*$/.test(line)) inServices = true;
    else if (/^\S/.test(line)) inServices = false;
    else if (inServices) {
      const m = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

export function stackInfo() {
  if (!STACK) return {configured: false, hint: 'Set BLUECORE_STACK_DIR in the dashboard\'s .env to your bluecore-stack checkout, then restart (make up).'};
  if (!hasStack()) return {configured: false, path: shownPath(), hint: `No bluecore-stack checkout at ${shownPath() || 'BLUECORE_STACK_DIR'} (no compose files). Check BLUECORE_STACK_DIR in the dashboard's .env, then restart (make up).`};
  const status = git('status', '--porcelain');
  const composeFiles = fs.readdirSync(STACK).filter((f) => /^(compose|docker-compose).*\.ya?ml$/.test(f)).sort();
  const env = envFile(path.join(STACK, '.env'));
  return {
    configured: true,
    path: shownPath(),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD') ?? headBranch(),
    commit: git('log', '-1', '--format=%h %s (%cr, %an)'),
    uncommitted: status == null ? null : status.split('\n').filter(Boolean),
    composeFiles,
    services: composeServices(path.join(STACK, 'compose-base.yaml')),
    envKeys: Object.keys(env),
  };
}

// --- Reading files from the checkout -------------------------------------------------------------

// Never read: settings files with secrets, git internals, Keycloak exports (users and client secrets)
const SECRET_NAME = /^(\.env.*|.*\.env|\.secrets|.*\.(pem|key|p12|pfx)|id_[a-z0-9]+|\.git|keycloak-export|\.netrc|\.pgpass)$/i;

function resolveInStack(rel) {
  if (!hasStack()) throw new StackError(404, stackInfo().hint);
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = clean ? clean.split('/') : [];
  if (parts.some((p) => !p || p === '..')) throw new StackError(400, `Invalid path "${rel}"`);
  if (parts.some((p) => SECRET_NAME.test(p))) throw new StackError(403, `"${rel}" may hold secrets, so it isn't readable through the dashboard.`);
  const abs = path.resolve(STACK, clean);
  if (abs !== STACK && !abs.startsWith(STACK + path.sep)) throw new StackError(400, `Invalid path "${rel}"`);
  if (!fs.existsSync(abs)) throw new StackError(404, `No "${clean}" in the stack checkout`);
  const real = fs.realpathSync(abs);
  const root = fs.realpathSync(STACK);
  if (real !== root && !real.startsWith(root + path.sep)) throw new StackError(400, `"${rel}" points outside the stack checkout`);
  return {abs, rel: clean};
}

// A directory listing ({dir, entries}) or a file's text ({file, text, truncated})
export function readStackPath(rel = '') {
  const {abs, rel: clean} = resolveInStack(rel);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(abs, {withFileTypes: true})
      .filter((e) => e.name !== '.git' && e.name !== '.DS_Store')
      .map((e) => ({name: e.name, dir: e.isDirectory(), hidden: SECRET_NAME.test(e.name)}))
      .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
    return {dir: clean, entries};
  }
  const buf = fs.readFileSync(abs).subarray(0, MAX_FILE_BYTES);
  if (buf.includes(0)) throw new StackError(415, `"${clean}" is a binary file`);
  return {file: clean, text: redact(buf.toString('utf8')), truncated: stat.size > MAX_FILE_BYTES, size: stat.size};
}

// --- Redaction -----------------------------------------------------------------------------------

const SECRET_KEY = /(PASSWORD|PASSWD|SECRET|TOKEN|_PAT$|^CR_PAT$|PRIVATE|API_KEY|_KEY$|CREDENTIAL|DB_URL$|DATABASE_URL$)/i;
const MIN_SECRET = 8; // shorter values are the stack's documented dev defaults ("airflow", "123456")
// The stack's documented local-development logins (bluecore-stack docs/keycloak.md): public, and hiding
// them would hide every "developer" in an output
const DOCUMENTED = new Set(['developer', 'airflow', '123456', 'bluecore', 'bluecore_api', 'localhost']);
let cache = {at: 0, values: []};

function secretValues() {
  if (Date.now() - cache.at < 30_000) return cache.values;
  const pairs = Object.entries(process.env);
  if (hasStack()) {
    // what notebooks get as environment variables (docker/jupyter/bluecore.py stack_env)
    const templates = path.join(STACK, 'scripts', 'dev', 'env-templates');
    const files = ['.env', 'bluecore_db.env', ...(fs.existsSync(templates) ? fs.readdirSync(templates).filter((f) => f.endsWith('.env')).map((f) => path.join('scripts', 'dev', 'env-templates', f)) : [])];
    for (const f of files) pairs.push(...Object.entries(envFile(path.join(STACK, f))));
  }
  const values = new Set();
  for (const [key, value] of pairs) {
    if (!SECRET_KEY.test(key) || !value || value.length < MIN_SECRET || DOCUMENTED.has(value)) continue;
    values.add(value);
    // the password inside a connection URL
    const m = value.match(/^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i);
    if (m && m[1].length >= MIN_SECRET) values.add(decodeURIComponent(m[1]));
  }
  cache = {at: Date.now(), values: [...values].sort((a, b) => b.length - a.length)};
  return cache.values;
}

export function redact(text) {
  let out = String(text ?? '');
  for (const v of secretValues()) if (out.includes(v)) out = out.split(v).join('‹redacted›');
  return out;
}
