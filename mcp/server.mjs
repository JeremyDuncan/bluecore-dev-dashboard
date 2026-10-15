// MCP server that lets AI agents search and read this documentation.
//
//   node mcp/server.mjs           → stdio (the agent starts it as a subprocess)
//   node mcp/server.mjs --http    → Streamable HTTP at http://localhost:3001/mcp (what `make up` runs)
//
// Tools (read-only unless noted): search_docs, read_doc, list_docs, docs_health (docs-health.mjs);
// GitHub (github-tools.mjs): project_board, list_issues, get_issue, search_issues, list_releases,
// list_files, get_file, search_code, fork_changes, ci_status, recent_changes, integration_tests;
// API reference (api-tools.mjs): api_endpoints, api_endpoint, api_schema;
// notes vault (notes-tools.mjs): list_notes, search_notes, read_note (with sections and images),
// related_notes, list_tasks, list_templates, list_attachments, get_note_image, notes_for_doc,
// notes_health, and the only write tools: create_note, update_note, complete_task, rename_note,
// pin_note, attach_image (they add or change notes; agents can't delete them).
// Prompts (prompts.mjs): standup_summary, weekly_update, onboarding_plan, summarize_epic, docs_cleanup. Content comes straight from docs/, so it includes
// everything on the site — internal Google Drive pages too. Don't expose the HTTP port publicly.
// The HTTP server also serves live GitHub data for the Project Status pages (live-api.mjs) and the
// notes for the Notes page (notes-api.mjs).
import http from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {extractSection, findPage, getIndex, headings, search} from './docs-index.mjs';
import {allowedOrigin, handleLiveApi, prewarm} from './live-api.mjs';
import {handleNotesApi} from './notes-api.mjs';
import {ensureVault, VAULT} from './notes.mjs';
import {registerNotesTools} from './notes-tools.mjs';
import {registerApiTools} from './api-tools.mjs';
import {registerDocsHealthTool} from './docs-health.mjs';
import {registerDiagnoseTool} from './diagnose.mjs';
import {registerGitHubTools} from './github-tools.mjs';
import {registerPrompts} from './prompts.mjs';

const text = (t) => ({content: [{type: 'text', text: t}]});

function createServer() {
  const server = new McpServer({name: 'bluecore-dev-dashboard', version: '1.0.0'});

  server.registerTool(
    'search_docs',
    {
      title: 'Search documentation',
      description:
        'Full-text search across all Blue Core developer docs (guides, repo docs, the wiki, Google Drive and Box documents). ' +
        'Returns the best-matching sections with a snippet, the page path (for read_doc) and the website URL. ' +
        'Use specific keywords, e.g. "keycloak export realm" rather than a full question. ' +
        'For current project status, issues or releases, prefer the live GitHub tools (project_board, list_issues, get_issue, search_issues, list_releases).',
      inputSchema: {
        query: z.string().min(1).describe('Keywords to search for'),
        limit: z.number().int().min(1).max(25).optional().describe('Max results (default 8)'),
        path_prefix: z
          .string()
          .optional()
          .describe('Only search pages under this docs/ path, e.g. "blue-core-repos/bluecore_api" or "blue-core-wiki" (see list_docs)'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({query, limit, path_prefix}) => {
      const results = await search(query, {limit, pathPrefix: path_prefix});
      if (results.length === 0) return text(`No results for "${query}". Try fewer or different keywords, or list_docs.`);
      return text(
        results
          .map((r, i) =>
            [
              `${i + 1}. ${r.title}${r.section ? ` › ${r.section}` : ''}`,
              `   path: ${r.path}`,
              `   url: ${r.url}`,
              r.source ? `   source: ${r.source}` : null,
              r.updated ? `   last updated: ${r.updated}` : null,
              `   ${r.snippet}`,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n'),
      );
    },
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read a documentation page',
      description:
        'Returns a page as Markdown. Pass the path or url from search_docs/list_docs. ' +
        'Pass section (a heading name) to get just that part of a long page.',
      inputSchema: {
        page: z.string().min(1).describe('docs/ path (e.g. "guides/writing-docs.md") or website URL'),
        section: z.string().optional().describe('Heading to return, including its sub-sections'),
        max_chars: z.number().int().min(500).optional().describe('Truncate long pages (default 40000)'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({page: ref, section, max_chars = 40_000}) => {
      const page = await findPage(ref);
      if (!page) return {...text(`No page "${ref}". Use search_docs or list_docs to find the right path.`), isError: true};
      let body = page.body.trim();
      if (section) {
        const part = extractSection(page, section);
        if (!part) return {...text(`No heading "${section}" on ${page.path}. Headings:\n${headings(page).join('\n')}`), isError: true};
        body = part;
      }
      const header = [
        `# ${page.title}`,
        `path: ${page.path}`,
        `url: ${page.url}`,
        page.source ? `source: ${page.source}` : null,
        page.updated ? `last updated: ${page.updated}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      if (body.length > max_chars) {
        body = `${body.slice(0, max_chars)}\n\n[… truncated at ${max_chars} of ${body.length} characters. Read one section at a time:]\n${headings(page).join('\n')}`;
      }
      return text(`${header}\n\n${body}`);
    },
  );

  server.registerTool(
    'list_docs',
    {
      title: 'List documentation pages',
      description: 'Lists every page (path — title), optionally only those under a docs/ path prefix such as "blue-core-wiki" or "google-drive".',
      inputSchema: {path_prefix: z.string().optional().describe('Only list pages under this path')},
      annotations: {readOnlyHint: true},
    },
    async ({path_prefix}) => {
      const {pages} = await getIndex();
      const list = pages.filter((p) => !path_prefix || p.path.startsWith(path_prefix));
      if (list.length === 0) return text(`No pages under "${path_prefix}".`);
      return text(`${list.length} pages\n\n${list.map((p) => `${p.path} — ${p.title}`).join('\n')}`);
    },
  );

  registerGitHubTools(server);
  registerDiagnoseTool(server);
  registerApiTools(server);
  registerDocsHealthTool(server);
  registerNotesTools(server);
  registerPrompts(server);

  return server;
}

async function serveHttp() {
  const port = Number(process.env.MCP_PORT ?? 3001);
  // Reject requests whose Host header isn't ours (protects against DNS rebinding from web pages).
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.MCP_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)]);

  const httpServer = http.createServer(async (req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!allowedHosts.has(host)) {
      res.writeHead(403).end(`Host "${host}" not allowed. Add it to MCP_ALLOWED_HOSTS.`);
      return;
    }
    const {pathname} = new URL(req.url, 'http://x');
    if (pathname === '/health') {
      const {pages, sections} = await getIndex();
      res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({ok: true, pages: pages.length, sections: sections.length}));
      return;
    }
    if (await handleLiveApi(req, res, pathname)) return; // live GitHub data for the Project Status pages
    if (await handleNotesApi(req, res, pathname)) return; // the Notes page
    if (pathname !== '/mcp') {
      res.writeHead(404).end('MCP endpoint is /mcp');
      return;
    }
    if (req.method !== 'POST') {
      // Stateless server: no server-initiated streams or sessions to resume.
      res.writeHead(405, {allow: 'POST'}).end();
      return;
    }
    // Agents don't send Origin; a browser does. Only pages on this machine may call tools (some write notes).
    if (req.headers.origin && !allowedOrigin(req.headers.origin)) {
      res.writeHead(403).end('Origin not allowed');
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      // Stateless: a fresh server + transport per request, so any number of agents can connect.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('[mcp]', err);
      if (!res.headersSent) {
        res.writeHead(400, {'content-type': 'application/json'}).end(
          JSON.stringify({jsonrpc: '2.0', error: {code: -32700, message: String(err.message ?? err)}, id: null}),
        );
      }
    }
  });

  const {pages} = await getIndex();
  prewarm();
  try {
    ensureVault();
    console.log(`[mcp] notes vault: ${VAULT}`);
  } catch (err) {
    console.error(`[mcp] notes vault ${VAULT} unavailable: ${err.message}`);
  }
  httpServer.listen(port, '0.0.0.0', () => console.log(`[mcp] ${pages.length} pages indexed — http://localhost:${port}/mcp`));
}

if (process.argv.includes('--http')) {
  await serveHttp();
} else {
  await createServer().connect(new StdioServerTransport()); // stdout is the protocol channel: log to stderr only
}
