// The Local Stack page's API (src/pages/local-stack.js), served next to the MCP endpoint. It passes
// requests on to the stack runner in the chat helper on this machine (stack-runner.mjs), which holds
// the actual scripts:
//
//   GET  /api/stack                        Docker, the checkout, the containers, recent jobs, the actions
//   GET  /api/stack/logs?container=&tail=&since=   a service's log lines
//   GET  /api/stack/diagnose               checks, findings and suggested fixes
//   GET  /api/stack/jobs                   recent jobs
//   GET  /api/stack/job?id=&offset=        one job and its output from byte offset
//   POST /api/stack/run                    {action, options, confirm} → starts a job
//   POST /api/stack/stop                   {id} → stops a running job
//   POST /api/stack/jobs/clear             {ids?} → removes finished jobs (those ids, or all)
//
// Same rules as the notes and notebooks APIs: this machine only, and writes need a JSON body from an
// allowed origin. nginx (make prod) serves it to localhost only, as it runs scripts on this machine.
import {allowedOrigin} from './live-api.mjs';
import {readJson, send} from './notes-api.mjs';
import {runner, STACK_ENABLED, StackRunnerError} from './stack-runner.mjs';

const ROUTES = {
  'GET ': () => ['/status'],
  'GET /logs': (q) => ['/logs', {params: {container: q.get('container'), tail: q.get('tail'), since: q.get('since')}}],
  'GET /diagnose': () => ['/diagnose', {timeout: 120_000}],
  'GET /jobs': (q) => ['/jobs', {params: {limit: q.get('limit')}}],
  'GET /job': (q) => ['/job', {params: {id: q.get('id'), offset: q.get('offset'), tail: q.get('tail')}}],
  'POST /run': (q, body) => ['/run', {method: 'POST', body: {action: body.action, options: body.options ?? {}, confirm: body.confirm === true, by: 'Local Stack page'}}],
  'POST /stop': (q, body) => ['/stop', {method: 'POST', body: {id: body.id}}],
  'POST /jobs/clear': (q, body) => ['/jobs/clear', {method: 'POST', body: {ids: body.ids}}],
};

export async function handleStackApi(req, res, pathname) {
  if (pathname !== '/api/stack' && !pathname.startsWith('/api/stack/')) return false;
  const origin = allowedOrigin(req.headers.origin);
  if (!STACK_ENABLED) {
    send(res, 404, {error: 'The Local Stack pages are turned off (set LOCAL_STACK=true in .env)', off: true}, origin);
    return true;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, {
      ...(origin && {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      }),
    });
    res.end();
    return true;
  }
  if (req.headers.origin && !origin) {
    send(res, 403, {error: 'Origin not allowed'}, null);
    return true;
  }
  const route = ROUTES[`${req.method} ${pathname.slice('/api/stack'.length)}`];
  if (!route) {
    send(res, 404, {error: 'Unknown endpoint'}, origin);
    return true;
  }
  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const [path, options] = route(new URL(req.url, 'http://x').searchParams, body);
    send(res, 200, await runner(path, options), origin);
  } catch (err) {
    send(res, err.status ?? 500, {error: err.message, helperDown: err instanceof StackRunnerError && err.status === 503}, origin);
  }
  return true;
}
