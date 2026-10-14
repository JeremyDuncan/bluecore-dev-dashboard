// API reference tools from OpenAPI specs (docs-sources.json → apiReference): list endpoints,
// describe one endpoint (parameters, request body, responses, auth, an example), describe a schema.
// The spec is read live (cached 10 minutes), so answers match what the API actually serves.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const SOURCES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs-sources.json');
const CACHE_MS = 10 * 60 * 1000;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const cache = new Map();

const text = (t) => ({content: [{type: 'text', text: t}]});
const fail = (t) => ({...text(t), isError: true});

function apis() {
  try {
    return JSON.parse(fs.readFileSync(SOURCES, 'utf8')).apiReference?.filter((a) => a.enabled !== false) ?? [];
  } catch {
    return [];
  }
}

async function loadSpec(api) {
  const hit = cache.get(api.slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.spec;
  const res = await fetch(api.specUrl, {headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${api.specUrl}`);
  const spec = await res.json();
  cache.set(api.slug, {at: Date.now(), spec});
  return spec;
}

function operations(spec) {
  const ops = [];
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      ops.push({method: m.toUpperCase(), path: p, op: {...op, parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])]}});
    }
  }
  return ops;
}

const refName = (ref) => ref.split('/').pop();
const resolve = (spec, schema) => (schema?.$ref ? spec.components?.schemas?.[refName(schema.$ref)] ?? {} : schema ?? {});

// One-line type of a schema: "string (uuid)", "array of Work", "Work | null", …
function typeOf(spec, schema) {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  for (const key of ['anyOf', 'oneOf']) if (schema[key]) return schema[key].map((s) => typeOf(spec, s)).join(' | ');
  if (schema.allOf) return schema.allOf.map((s) => typeOf(spec, s)).join(' & ');
  if (schema.type === 'array') return `array of ${typeOf(spec, schema.items)}`;
  if (schema.enum) return `${schema.type ?? 'enum'}: ${schema.enum.map((v) => JSON.stringify(v)).join(' | ')}`;
  if (schema.type === 'object' && schema.additionalProperties && !schema.properties) return `object (map of ${typeOf(spec, schema.additionalProperties)})`;
  return [schema.type ?? 'object', schema.format && `(${schema.format})`].filter(Boolean).join(' ');
}

// Properties of an object schema as indented lines, following $refs up to `depth` levels.
function describeSchema(spec, schema, depth = 2, indent = '', seen = new Set()) {
  const s = resolve(spec, schema);
  const name = schema?.$ref && refName(schema.$ref);
  if (name) {
    if (seen.has(name)) return [`${indent}(${name}, see above)`];
    seen = new Set([...seen, name]);
  }
  const variants = s.anyOf ?? s.oneOf;
  if (variants) return variants.flatMap((v) => [`${indent}one of: ${typeOf(spec, v)}`, ...(depth > 0 && v.$ref ? describeSchema(spec, v, depth - 1, `${indent}  `, seen) : [])]);
  if (s.type === 'array' && s.items) return [`${indent}array of ${typeOf(spec, s.items)}`, ...(depth > 0 ? describeSchema(spec, s.items, depth - 1, `${indent}  `, seen) : [])];
  const props = Object.entries(s.properties ?? {});
  if (!props.length) return [];
  const required = new Set(s.required ?? []);
  return props.flatMap(([prop, ps]) => {
    const line = `${indent}- ${prop}${required.has(prop) ? ' (required)' : ''}: ${typeOf(spec, ps)}${ps.description || resolve(spec, ps).description ? ` — ${(ps.description || resolve(spec, ps).description).split('\n')[0]}` : ''}`;
    const nested = depth > 0 && (ps.$ref || ps.items?.$ref) ? describeSchema(spec, ps.$ref ? ps : ps.items, depth - 1, `${indent}  `, seen) : [];
    return [line, ...nested];
  });
}

function findOperation(ops, method, query) {
  const q = query.trim();
  const m = method?.toUpperCase();
  const norm = (p) => p.replace(/\/$/, '').toLowerCase();
  const exact = ops.filter((o) => norm(o.path) === norm(q) && (!m || o.method === m));
  if (exact.length) return exact;
  const byId = ops.filter((o) => o.op.operationId === q);
  if (byId.length) return byId;
  const words = q.toLowerCase().split(/\s+/);
  return ops.filter(
    (o) => (!m || o.method === m) && words.every((w) => `${o.method} ${o.path} ${o.op.summary ?? ''} ${o.op.operationId ?? ''} ${(o.op.tags ?? []).join(' ')}`.toLowerCase().includes(w)),
  );
}

function exampleCurl(api, o) {
  const url = `${api.baseUrl.replace(/\/$/, '')}${o.path.replace(/\{(\w+)\}/g, '<$1>')}`;
  const query = o.op.parameters.filter((p) => p.in === 'query' && p.required).map((p) => `${p.name}=<${p.name}>`);
  const body = o.op.requestBody?.content ? Object.keys(o.op.requestBody.content)[0] : null;
  return [
    `curl -X ${o.method} "${url}${query.length ? `?${query.join('&')}` : ''}"`,
    o.op.security?.length ? '  -H "Authorization: Bearer $TOKEN"' : null,
    body ? `  -H "Content-Type: ${body}" --data @body.json` : null,
  ]
    .filter(Boolean)
    .join(' \\\n');
}

export function registerApiTools(server) {
  const list = apis();
  if (!list.length) return;
  const names = list.map((a) => `"${a.slug}" (${a.name})`).join(', ');
  const pick = (slug) => list.find((a) => a.slug === slug) ?? list[0];
  const apiArg = z.string().optional().describe(`Which API: ${names}. Default: the first.`);
  const readOnly = {readOnlyHint: true, openWorldHint: true};

  server.registerTool(
    'api_endpoints',
    {
      title: 'List API endpoints',
      description: `Endpoints of the ${list.map((a) => a.name).join(' / ')} from its live OpenAPI spec: method, path, summary, whether it needs auth. Filter by tag (e.g. "Works") or words.`,
      inputSchema: {api: apiArg, tag: z.string().optional(), query: z.string().optional().describe('Words to find in path or summary')},
      annotations: readOnly,
    },
    async ({api: slug, tag, query}) => {
      const api = pick(slug);
      let spec;
      try {
        spec = await loadSpec(api);
      } catch (err) {
        return fail(`Couldn't load the ${api.name} spec: ${err.message}`);
      }
      const ops = operations(spec).filter(
        (o) =>
          (!tag || (o.op.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) &&
          (!query || query.toLowerCase().split(/\s+/).every((w) => `${o.path} ${o.op.summary ?? ''}`.toLowerCase().includes(w))),
      );
      if (!ops.length) return text(`No ${api.name} endpoints match${tag ? ` tag "${tag}"` : ''}${query ? ` "${query}"` : ''}. Tags: ${[...new Set(operations(spec).flatMap((o) => o.op.tags ?? []))].join(', ')}`);
      const groups = new Map();
      for (const o of ops) {
        const t = o.op.tags?.[0] ?? 'Other';
        groups.set(t, [...(groups.get(t) ?? []), o]);
      }
      return text(
        `${api.name} — ${ops.length} endpoints (base URL ${api.baseUrl}; spec ${api.specUrl})${api.docsUrl ? `; interactive docs ${api.docsUrl}` : ''}\n` +
          `"auth" = needs a Keycloak bearer token.\n\n` +
          [...groups].map(([t, os]) => `## ${t}\n${os.map((o) => `- ${o.method} ${o.path} — ${o.op.summary ?? ''}${o.op.security?.length ? ' [auth]' : ''}`).join('\n')}`).join('\n\n'),
      );
    },
  );

  server.registerTool(
    'api_endpoint',
    {
      title: 'Describe an API endpoint',
      description: 'One endpoint in detail from the live OpenAPI spec: path and query parameters, request body schema, responses, auth, and an example curl. Pass the path (e.g. "/works/{work_uuid}") or words (e.g. "create work").',
      inputSchema: {api: apiArg, endpoint: z.string().describe('Path, operationId or words'), method: z.string().optional().describe('GET, POST, PUT, PATCH or DELETE')},
      annotations: readOnly,
    },
    async ({api: slug, endpoint, method}) => {
      const api = pick(slug);
      let spec;
      try {
        spec = await loadSpec(api);
      } catch (err) {
        return fail(`Couldn't load the ${api.name} spec: ${err.message}`);
      }
      const found = findOperation(operations(spec), method, endpoint);
      if (!found.length) return text(`No ${api.name} endpoint matches "${endpoint}"${method ? ` (${method})` : ''}. It may not exist yet; use api_endpoints to list them.`);
      if (found.length > 6) return text(`${found.length} endpoints match "${endpoint}". Be more specific:\n${found.map((o) => `- ${o.method} ${o.path} — ${o.op.summary ?? ''}`).join('\n')}`);
      const out = found.map((o) => {
        const params = o.op.parameters.map((p) => `- ${p.name} (${p.in}${p.required ? ', required' : ''}): ${typeOf(spec, p.schema)}${p.description ? ` — ${p.description}` : ''}${p.schema?.default !== undefined ? ` [default ${JSON.stringify(p.schema.default)}]` : ''}`);
        const body = o.op.requestBody?.content
          ? Object.entries(o.op.requestBody.content).flatMap(([type, c]) => [`Content-Type ${type}${o.op.requestBody.required ? ' (required)' : ''}: ${typeOf(spec, c.schema)}`, ...describeSchema(spec, c.schema, 1, '  ')])
          : [];
        const responses = Object.entries(o.op.responses ?? {}).flatMap(([code, r]) => {
          const content = r.content ? Object.entries(r.content)[0] : null;
          return [`- ${code}: ${r.description ?? ''}${content ? ` → ${content[0]}: ${typeOf(spec, content[1].schema)}` : ''}`];
        });
        return [
          `## ${o.method} ${o.path}`,
          o.op.summary,
          o.op.description && o.op.description !== o.op.summary ? o.op.description : null,
          `Tags: ${(o.op.tags ?? []).join(', ') || '–'} · operationId: ${o.op.operationId ?? '–'} · Auth: ${o.op.security?.length ? `required (${o.op.security.flatMap((s) => Object.keys(s)).join(', ')} bearer token)` : 'none'}`,
          params.length ? `\nParameters:\n${params.join('\n')}` : '\nParameters: none',
          body.length ? `\nRequest body:\n${body.join('\n')}` : null,
          `\nResponses:\n${responses.join('\n')}`,
          `\nExample:\n\`\`\`bash\n${exampleCurl(api, o)}\n\`\`\``,
        ]
          .filter(Boolean)
          .join('\n');
      });
      return text(`${api.name} (base URL ${api.baseUrl})\n\n${out.join('\n\n')}`);
    },
  );

  server.registerTool(
    'api_schema',
    {
      title: 'Describe an API schema',
      description: 'A data model (component schema) from the live OpenAPI spec: its fields, types and which are required. Use names from api_endpoint responses (e.g. "WorkSchema"), or omit name to list all schemas.',
      inputSchema: {api: apiArg, name: z.string().optional()},
      annotations: readOnly,
    },
    async ({api: slug, name}) => {
      const api = pick(slug);
      let spec;
      try {
        spec = await loadSpec(api);
      } catch (err) {
        return fail(`Couldn't load the ${api.name} spec: ${err.message}`);
      }
      const schemas = spec.components?.schemas ?? {};
      if (!name) return text(`${api.name} schemas (${Object.keys(schemas).length}):\n${Object.keys(schemas).sort().map((n) => `- ${n}`).join('\n')}`);
      const key = Object.keys(schemas).find((n) => n.toLowerCase() === name.toLowerCase()) ?? Object.keys(schemas).find((n) => n.toLowerCase().includes(name.toLowerCase()));
      if (!key) return text(`No schema named "${name}". Schemas: ${Object.keys(schemas).sort().join(', ')}`);
      const s = schemas[key];
      return text([`## ${key}`, s.description, `Type: ${typeOf(spec, s)}`, ...describeSchema(spec, {$ref: `#/components/schemas/${key}`}, 2)].filter(Boolean).join('\n'));
    },
  );
}
