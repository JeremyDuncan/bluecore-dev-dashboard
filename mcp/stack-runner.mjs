// Client for the stack runner in the chat helper on this machine (chat/stack-runner.mjs), which runs the
// bluecore-stack checkout's dev scripts, reads container logs and checks the stack. Used by the Local
// Stack page's API (stack-api.mjs) and the stack_* MCP tools (stack-tools.mjs).
//
// STACK_RUNNER_URL: where the helper listens (default http://localhost:3002/stack; docker-compose.yml sets
// host.docker.internal). STACK_RUNNER_TOKEN_FILE: the token the helper writes to .devenv/token.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = (process.env.STACK_RUNNER_URL || 'http://localhost:3002/stack').replace(/\/$/, '');
const TOKEN_FILE = process.env.STACK_RUNNER_TOKEN_FILE || path.join(REPO, '.devenv', 'token');

// The Local Stack pages and the stack_* tools are off unless LOCAL_STACK=true in .env (docker-compose.yml passes it)
export const STACK_ENABLED = /^(true|1|yes|on)$/i.test(String(process.env.LOCAL_STACK ?? '').trim());

export const HELPER_DOWN =
  "The dashboard's helper on this machine isn't running, so the stack can't be controlled from here. It starts with `make up` or `make prod` (or alone with `make chat`).";

export class StackRunnerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function runner(route, {method = 'GET', params = {}, body, timeout = 60_000} = {}) {
  let token;
  try {
    token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return Promise.reject(new StackRunnerError(503, HELPER_DOWN));
  }
  const url = new URL(RUNNER + route);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      // The helper only answers requests addressed to localhost (it guards against DNS rebinding)
      {method, timeout, headers: {host: 'localhost', 'x-stack-token': token, ...(body && {'content-type': 'application/json'})}},
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let data = {};
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {}
          if (res.statusCode === 404 && !data.error) reject(new StackRunnerError(503, `${HELPER_DOWN} (The running helper is older than this feature: restart make up / make prod.)`));
          else if (res.statusCode >= 400) reject(new StackRunnerError(res.statusCode, data.error ?? `HTTP ${res.statusCode}`));
          else resolve(data);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (err) => reject(new StackRunnerError(503, ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(err.code) ? HELPER_DOWN : `The stack helper didn't answer: ${err.message}`)));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// For agents: no terminal colors, and a line that a progress bar rewrote shows its last state
export const plain = (text) =>
  String(text ?? '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .split('\n')
    .map((l) => l.split('\r').filter(Boolean).pop() ?? '')
    .join('\n');
