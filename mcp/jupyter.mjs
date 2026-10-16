// Runs notebook cells in the JupyterLab container (docker-compose.yml, service "jupyter"), for the
// Notebooks page and the run_notebook MCP tool. It talks to Jupyter Server's REST API and its kernel
// WebSocket, the same way JupyterLab does, and reuses the notebook's kernel session: a notebook open in
// JupyterLab and the same notebook run from here share one kernel and its variables.
//
//   JUPYTER_URL         where the server is, from the MCP container (default http://jupyter:8888)
//   JUPYTER_PUBLIC_URL  where your browser reaches JupyterLab (default http://localhost:8888)
//   JUPYTER_TOKEN       the server's token; by default it's read from JUPYTER_TOKEN_FILE
//                       (/run/jupyter/token), which the jupyter container writes when it starts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = (process.env.JUPYTER_URL ?? 'http://jupyter:8888').replace(/\/$/, '');
const PUBLIC_URL = (process.env.JUPYTER_PUBLIC_URL ?? 'http://localhost:8888').replace(/\/$/, '');
const TOKEN_FILE = process.env.JUPYTER_TOKEN_FILE ?? '/run/jupyter/token';
export const CELL_TIMEOUT_MS = 120_000;

export class JupyterError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

// Read on every call: the container writes a new token each time it starts
function token() {
  if (process.env.JUPYTER_TOKEN) return process.env.JUPYTER_TOKEN;
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

const NOT_RUNNING = 'JupyterLab isn\'t running. Start it with `make up` (or `docker compose up jupyter`), then try again.';

async function api(method, route, body) {
  let res;
  try {
    res = await fetch(`${URL_}${route}`, {
      method,
      headers: {authorization: `token ${token()}`, ...(body && {'content-type': 'application/json'})},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new JupyterError(NOT_RUNNING);
  }
  if (res.status === 403) throw new JupyterError('JupyterLab refused the token. Restart the jupyter and mcp containers so they share a new one.');
  if (!res.ok) throw new JupyterError(`JupyterLab answered ${res.status} for ${route}`, 502);
  return res.status === 204 ? null : res.json();
}

// {running, version, labUrl} — never throws
export async function jupyterStatus() {
  try {
    const s = await api('GET', '/api/status');
    const v = await api('GET', '/api').catch(() => ({}));
    return {running: true, version: v.version ?? null, kernels: s.kernels ?? 0, labUrl: labUrl()};
  } catch (err) {
    return {running: false, error: err.message, labUrl: null};
  }
}

// JupyterLab in the browser, optionally at one notebook. With the token (for the Notebooks page on
// this machine) it opens signed in; agents get it without, so the token never goes to an AI provider.
export function labUrl(rel, {withToken = true} = {}) {
  const t = withToken ? token() : '';
  const where = rel ? `/lab/tree/${rel.split('/').map(encodeURIComponent).join('/')}` : '/lab';
  return `${PUBLIC_URL}${where}${t ? `?token=${encodeURIComponent(t)}` : ''}`;
}

// The notebook's kernel session (JupyterLab's, if it's open there)
async function session(rel, kernelName = 'python3', {restart = false} = {}) {
  const s = await api('POST', '/api/sessions', {path: rel, name: path.posix.basename(rel), type: 'notebook', kernel: {name: kernelName}});
  if (restart) {
    await api('POST', `/api/kernels/${s.kernel.id}/restart`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return s.kernel.id;
}

// Stops the code running in the notebook's kernel (KeyboardInterrupt), if a kernel is running
export async function interruptKernelOf(rel) {
  const sessions = await api('GET', '/api/sessions').catch(() => []);
  const s = sessions.find((x) => x.path === rel);
  if (!s?.kernel?.id) return false;
  await api('POST', `/api/kernels/${s.kernel.id}/interrupt`);
  return true;
}

// Restarts the notebook's kernel if one is running (JupyterLab's or ours), so it starts over with the
// notebook's current environment (the kernel's environment variables are set when it starts)
export async function restartKernelOf(rel) {
  const sessions = await api('GET', '/api/sessions').catch(() => []);
  const s = sessions.find((x) => x.path === rel);
  if (!s?.kernel?.id) return false;
  await api('POST', `/api/kernels/${s.kernel.id}/restart`);
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

// Kernel messages → nbformat outputs. Consecutive stream output of the same kind is merged, as Jupyter does.
function addOutput(outputs, msg) {
  const c = msg.content;
  const type = msg.header.msg_type;
  if (type === 'stream') {
    const last = outputs.at(-1);
    if (last?.output_type === 'stream' && last.name === c.name) last.text += c.text;
    else outputs.push({output_type: 'stream', name: c.name, text: c.text});
  } else if (type === 'execute_result') outputs.push({output_type: 'execute_result', data: c.data, metadata: c.metadata ?? {}, execution_count: c.execution_count});
  else if (type === 'display_data') outputs.push({output_type: 'display_data', data: c.data, metadata: c.metadata ?? {}});
  else if (type === 'error') outputs.push({output_type: 'error', ename: c.ename, evalue: c.evalue, traceback: c.traceback ?? []});
  else if (type === 'clear_output') outputs.length = 0;
}

// Opens the kernel's channels and returns run(code) → {status, outputs, executionCount}
async function connect(kernelId) {
  const sessionId = crypto.randomUUID();
  const t = token();
  const ws = new WebSocket(`${URL_.replace(/^http/, 'ws')}/api/kernels/${kernelId}/channels?session_id=${sessionId}${t ? `&token=${encodeURIComponent(t)}` : ''}`);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, {once: true});
    ws.addEventListener('error', () => fail(new JupyterError('Couldn\'t connect to the notebook\'s kernel')), {once: true});
  });
  let pending = null; // {msgId, outputs, executionCount, idle, reply, lost, done}
  // The socket can close mid-run (JupyterLab restarted, the container recreated), or the kernel shut
  // down: end the waiting cell at once instead of letting it, and every cell after it, wait out its timeout
  let closed = false;
  const lose = () => {
    closed = true;
    if (pending) {
      pending.lost = true;
      pending.done();
    }
  };
  ws.addEventListener('close', lose);
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
    } catch {
      return; // binary frames (buffers) aren't used for outputs
    }
    // The kernel shut down or died (from JupyterLab, the API or the idle culler): Jupyter announces it
    // on iopub but keeps the socket open, and would quietly drop every cell sent after it
    if (msg.channel === 'iopub' && (msg.header?.msg_type === 'shutdown_reply' || (msg.header?.msg_type === 'status' && msg.content?.execution_state === 'dead'))) {
      lose();
      ws.close();
      return;
    }
    if (!pending || msg.parent_header?.msg_id !== pending.msgId) return;
    const type = msg.header.msg_type;
    if (msg.channel === 'iopub') {
      if (type === 'execute_input') pending.executionCount = msg.content.execution_count;
      else if (type === 'status' && msg.content.execution_state === 'idle') pending.idle = true;
      else addOutput(pending.outputs, msg);
    } else if (msg.channel === 'shell' && type === 'execute_reply') {
      pending.reply = msg.content.status;
      pending.executionCount ??= msg.content.execution_count;
    }
    if (pending.idle && pending.reply) pending.done();
  });

  async function run(code, timeoutMs = CELL_TIMEOUT_MS) {
    if (closed) throw new JupyterError('The connection to the notebook\'s kernel closed. Run it again.');
    const msgId = crypto.randomUUID();
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.timedOut = true;
        pending.done();
      }, timeoutMs);
      pending = {msgId, outputs: [], executionCount: null, done: () => (clearTimeout(timer), resolve(pending))};
      ws.send(
        JSON.stringify({
          header: {msg_id: msgId, username: 'bluecore-dashboard', session: sessionId, msg_type: 'execute_request', version: '5.3', date: new Date().toISOString()},
          parent_header: {},
          metadata: {},
          content: {code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true},
          channel: 'shell',
          buffers: [],
        }),
      );
    });
    pending = null;
    if (result.lost) {
      result.outputs.push({output_type: 'error', ename: 'ConnectionError', evalue: 'The kernel shut down or the connection to it closed during the run (JupyterLab restarted?). Run it again.', traceback: []});
      return {status: 'error', outputs: result.outputs, executionCount: result.executionCount, lost: true};
    }
    if (result.timedOut) {
      await api('POST', `/api/kernels/${kernelId}/interrupt`).catch(() => {});
      result.outputs.push({output_type: 'error', ename: 'TimeoutError', evalue: `The cell ran for more than ${Math.round(timeoutMs / 1000)} s and was interrupted`, traceback: []});
      return {status: 'timeout', outputs: result.outputs, executionCount: result.executionCount};
    }
    return {status: result.reply === 'ok' ? 'ok' : 'error', outputs: result.outputs, executionCount: result.executionCount};
  }
  return {run, close: () => ws.close()};
}

// Runs code cells of a notebook (all, or the given indexes) in order. Stops at the first error unless
// keepGoing. cells: the notebook's cells (from readNotebook). Returns [{index, status, outputs, executionCount}].
export async function runCells(rel, cells, {indexes, restart = false, keepGoing = false, kernel = 'python3', timeoutMs} = {}) {
  const wanted = (indexes?.length ? indexes : cells.map((c) => c.index)).filter((i) => cells[i]?.type === 'code');
  if (!wanted.length) return [];
  const kernelId = await session(rel, kernel, {restart});
  const conn = await connect(kernelId);
  const results = [];
  try {
    for (const i of wanted) {
      const r = await conn.run(cells[i].source, timeoutMs || CELL_TIMEOUT_MS);
      const {lost, ...rest} = r;
      results.push({index: i, ...rest});
      if (lost || (r.status !== 'ok' && !keepGoing)) break; // no kernel left to run the rest on
    }
  } finally {
    conn.close();
  }
  return results;
}
