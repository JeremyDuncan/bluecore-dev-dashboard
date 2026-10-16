// MCP tools for the notebooks folder (notebooks.mjs), for debugging and troubleshooting the Bluecore stack.
//   Reading: list_notebooks, read_notebook (cells, outputs, and output images)
//   Writing: create_notebook (optionally from a starter), update_notebook (add, change, delete cells)
//   Running: run_notebook — runs code cells in the JupyterLab container's Python kernel (jupyter.mjs)
//            and saves the outputs in the notebook
// Like the note-writing tools, agents use the writing and running tools only when the user asks.
// None deletes a notebook: only the person can, on the Notebooks page.
// A notebook runs against an environment (target): the local stack, or a deployed one (dev, stage),
// which the kernel's helper (docker/jupyter/bluecore.py) only reads. Outputs pass through redact()
// so the stack's secrets and the deployed environments' logins don't reach the AI provider.
import {z} from 'zod';
import {writerOf} from './agent-runs.mjs';
import {CELL_TIMEOUT_MS, labUrl} from './jupyter.mjs';
import {afterTargetChange, runNotebook} from './notebooks-api.mjs';
import {environments, redact} from './local-stack.mjs';
import {ICON_HELP, iconFromInput} from './folder-icons.mjs';
import {createNotebook, listNotebooks, listStarters, NotebookError, outputText, readNotebook, setNotebookMeta, updateNotebook} from './notebooks.mjs';

const MAX_OUTPUT_CHARS = 4000;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 3_000_000;

const MODEL_FIELD = z.string().max(80).optional().describe('Your exact model id, if you know it; recorded as who wrote or ran it');
const ICON_FIELD = z.string().max(40).optional().describe(`The notebook's icon on the Notebooks page. ${ICON_HELP}`);
// "🧪" or "bug (line icon)"
const iconLabel = (icon) => (icon?.startsWith('emoji:') ? icon.slice(6) : icon ? `${icon.slice(5)} (line icon)` : null);
const text = (t) => ({content: [{type: 'text', text: t}]});
const failed = (err) => {
  if (err instanceof NotebookError || err.status) return {...text(err.message), isError: true};
  throw err;
};
const siteUrl = (rel) => `${(process.env.DOCS_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/notebooks?nb=${encodeURIComponent(rel)}`;
const clip = (s, n = MAX_OUTPUT_CHARS) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);

const targetLabel = (name) => {
  const env = environments().find((e) => e.name === name);
  return env?.deployed ? `${name} (${env.url}, deployed: read-only)` : `${name}${env ? ' (the local stack)' : ' (unknown environment)'}`;
};
const TARGET_FIELD = () =>
  z
    .string()
    .optional()
    .describe(
      `Environment it runs against: ${environments().map((e) => e.name).join(', ')}. "local" is the user's own stack; the others are shared, deployed sites ` +
        '(the notebook helper only reads them). Only pick a deployed one when the user asks for it.',
    );

const head = (nb) =>
  [
    `"${nb.title}"`,
    `path: ${nb.path}`,
    `page: ${siteUrl(nb.path)}`,
    `JupyterLab: ${labUrl(nb.path, {withToken: false})}`,
    `runs against: ${targetLabel(nb.target)}`,
    nb.icon ? `icon: ${iconLabel(nb.icon)}` : null,
    `${nb.cells} cells (${nb.codeCells} code; ${nb.ran} with outputs${nb.errors ? `; ${nb.errors} with errors` : ''})`,
    nb.author && nb.author !== 'you' && nb.author !== 'starter' ? `author: ${nb.author}${nb.model ? ` (model: ${nb.model})` : ''}` : null,
    nb.lastRun ? `last run: ${nb.lastRun.at.slice(0, 16).replace('T', ' ')} UTC by ${nb.lastRun.by}` : null,
  ]
    .filter(Boolean)
    .join('\n');

// One cell as Markdown, for agents: its source and its outputs (text only; images are separate)
function cellText(c) {
  const label = c.type === 'code' ? `code${c.executionCount != null ? ` [${c.executionCount}]` : ''}` : c.type;
  const parts = [`### Cell ${c.index} · ${label}`];
  parts.push(c.type === 'code' ? `\`\`\`python\n${c.source}\n\`\`\`` : c.source);
  const out = c.outputs.map(outputText).filter(Boolean).join('\n');
  if (out) parts.push(`Output:\n\`\`\`\n${clip(redact(out))}\n\`\`\``);
  return parts.join('\n\n');
}

const images = (cells) =>
  cells.flatMap((c) =>
    c.outputs.flatMap((o) => {
      const png = o.data?.['image/png'];
      const jpeg = o.data?.['image/jpeg'];
      const data = (png ?? jpeg ?? '').toString().replace(/\s/g, '');
      if (!data || data.length * 0.75 > MAX_IMAGE_BYTES) return [];
      return [{type: 'image', data, mimeType: png ? 'image/png' : 'image/jpeg'}];
    }),
  );

const CELL = z.object({
  type: z.enum(['code', 'markdown']).optional().describe('Default "code" (Python)'),
  source: z.string().describe('The cell\'s text: Python for code cells, Markdown for markdown cells'),
});

const OP = z.object({
  op: z.enum(['append', 'insert', 'replace', 'delete', 'clear_outputs']),
  index: z.number().int().min(0).optional().describe('Cell index (from read_notebook) for insert (before it), replace and delete'),
  type: z.enum(['code', 'markdown']).optional(),
  source: z.string().optional().describe('New text, for append, insert and replace'),
});

export function registerNotebookTools(server) {
  server.registerTool(
    'list_notebooks',
    {
      title: 'List notebooks',
      description:
        'Jupyter notebooks for debugging and troubleshooting the Bluecore stack (they run in a local JupyterLab container that can reach the stack), newest first, ' +
        'with how many cells ran and how many have errors, plus the starter notebooks create_notebook can start from.',
      inputSchema: {folder: z.string().optional().describe('Only notebooks in this folder')},
      annotations: {readOnlyHint: true},
    },
    async ({folder}) => {
      const f = folder?.replace(/\/$/, '');
      const nbs = listNotebooks().filter((n) => !f || n.folder === f || n.folder.startsWith(`${f}/`));
      const starters = listStarters();
      const list = nbs.length
        ? nbs.map((n) => `- ${n.title}\n  path: ${n.path}${n.target !== 'local' ? ` · runs against ${n.target}` : ''}${n.icon ? ` · icon: ${iconLabel(n.icon)}` : ''}\n  ${n.codeCells} code cells, ${n.ran} ran${n.errors ? `, ${n.errors} with errors` : ''} · updated ${n.updated.slice(0, 16).replace('T', ' ')}${n.lastRun ? ` · last run ${n.lastRun.at.slice(0, 16).replace('T', ' ')} by ${n.lastRun.by}` : ''}`).join('\n')
        : 'No notebooks yet.';
      const st = starters.map((s) => `- ${s.name}: ${s.title}${s.group ? ` [${s.group}]` : ''}${s.description ? ` — ${s.description}` : ''}`).join('\n');
      const envs = environments().map((e) => `- ${e.name}${e.deployed ? `: ${e.url} (deployed, read-only)` : ': the user\'s local stack'}`).join('\n');
      return text(`${nbs.length} notebook(s)\n\n${list}\n\nStarter notebooks (create_notebook starter=<name>):\n${st || 'none'}\n\nEnvironments (target):\n${envs}`);
    },
  );

  server.registerTool(
    'read_notebook',
    {
      title: 'Read a notebook',
      description:
        'A notebook\'s cells with their numbers, code, Markdown and saved outputs (errors and tracebacks included). ' +
        'Pass cells to read only some. Pass include_images to also see image outputs (charts, plots).',
      inputSchema: {
        notebook: z.string().min(1).describe('Path (from list_notebooks) or title'),
        cells: z.array(z.number().int().min(0)).optional().describe('Only these cell indexes'),
        include_images: z.boolean().optional().describe(`Also return PNG/JPEG outputs, up to ${MAX_IMAGES}`),
      },
      annotations: {readOnlyHint: true},
    },
    async ({notebook, cells, include_images}) => {
      try {
        const nb = readNotebook(notebook);
        const shown = cells?.length ? nb.cellsList.filter((c) => cells.includes(c.index)) : nb.cellsList;
        const body = `${head(nb)}\n\n${shown.map(cellText).join('\n\n')}`;
        const imgs = include_images ? images(shown).slice(0, MAX_IMAGES) : [];
        return {content: [{type: 'text', text: body}, ...imgs]};
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'create_notebook',
    {
      title: 'Create a notebook',
      description:
        'Creates a Jupyter notebook (Python) for debugging or troubleshooting the Bluecore stack, from cells you write and/or a starter (list_notebooks lists them). ' +
        'Only when the user asks. Start with a Markdown cell saying what it checks. Connect through the helper, which knows each environment\'s address and logins: ' +
        '`from bluecore import target; bc = target(); bc` then bc.get("/api/health"), bc.api (the API\'s base URL), bc.db() (read-only Postgres), ' +
        'bc.airflow() → (session, api_base), bc.keycloak_token(). Never put real passwords or tokens in cells. Never overwrites: a taken title gets a number added. ' +
        'It doesn\'t run anything; use run_notebook when the user wants it run.',
      inputSchema: {
        title: z.string().min(1).max(120).optional().describe('Becomes the file name. Default: the starter\'s title'),
        cells: z.array(CELL).max(100).optional().describe('Cells, in order (after the starter\'s, if any)'),
        starter: z.string().optional().describe('Start from this starter notebook (its name from list_notebooks)'),
        folder: z.string().optional().describe('Folder inside the notebooks folder, e.g. "Investigations"'),
        target: TARGET_FIELD(),
        icon: ICON_FIELD,
        model: MODEL_FIELD,
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async ({title, cells = [], starter, folder, target, icon, model}, extra) => {
      if (!title && !starter) return {...text('Give the notebook a title (or a starter to copy).'), isError: true};
      try {
        const chosen = icon == null ? null : iconFromInput(icon); // checked before anything is written
        let nb = createNotebook({title, cells, starter, folder, target, writer: writerOf(extra, {model})});
        if (chosen) nb = setNotebookMeta(nb.path, {icon: chosen});
        return text(`Created ${head(nb)}`);
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'update_notebook',
    {
      title: 'Update a notebook',
      description:
        'Changes a notebook\'s cells: append, insert (before index), replace (a cell\'s text; clears its outputs), delete, or clear_outputs; or its title, environment or icon. ' +
        'Ops apply in order and indexes refer to the notebook as each op runs (read_notebook shows them). Only when the user asks. ' +
        'Never put real passwords or tokens in cells.',
      inputSchema: {
        notebook: z.string().min(1).describe('Path or title'),
        ops: z.array(OP).max(100).optional(),
        title: z.string().max(120).optional().describe('A new display title (the file name stays)'),
        target: TARGET_FIELD(),
        icon: ICON_FIELD,
        model: MODEL_FIELD,
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async ({notebook, ops = [], title, target, icon, model}, extra) => {
      if (!ops.length && !title && !target && icon == null) return {...text('Nothing to change: pass ops, a title, a target or an icon.'), isError: true};
      try {
        const chosen = icon == null ? undefined : iconFromInput(icon); // null removes it
        const before = target && readNotebook(notebook).target;
        // An icon alone isn't an edit of the notebook's content, so it doesn't record the AI as its editor
        let nb = ops.length || title || target ? updateNotebook(notebook, {ops, title, target, writer: writerOf(extra, {model})}) : readNotebook(notebook);
        if (chosen !== undefined) nb = setNotebookMeta(nb.path, {icon: chosen});
        if (target && nb.target !== before) await afterTargetChange(nb.path);
        return text(`Updated ${head(nb)}`);
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'run_notebook',
    {
      title: 'Run a notebook',
      description:
        'Runs a notebook\'s code cells (all, or the given indexes, in order) in the local JupyterLab container\'s Python kernel, against the notebook\'s environment ' +
        '(the user\'s local stack by default; pass target to switch, e.g. to compare with dev or stage), and saves the outputs in the notebook. ' +
        'Returns each cell\'s result. Stops at the first error unless keep_going. ' +
        'The kernel is shared with JupyterLab, so variables from earlier runs are kept; pass restart for a clean run. ' +
        `Each cell may run for ${CELL_TIMEOUT_MS / 1000} s by default. Only when the user asks to run it; this executes code on their machine.`,
      inputSchema: {
        notebook: z.string().min(1).describe('Path or title'),
        cells: z.array(z.number().int().min(0)).optional().describe('Only these cell indexes (code cells); default every code cell'),
        restart: z.boolean().optional().describe('Restart the kernel first (clears variables)'),
        keep_going: z.boolean().optional().describe('Run the remaining cells after an error'),
        timeout_seconds: z.number().int().min(5).max(600).optional().describe(`Per cell; default ${CELL_TIMEOUT_MS / 1000}`),
        target: TARGET_FIELD(),
        model: MODEL_FIELD,
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    },
    async ({notebook, cells, restart, keep_going, timeout_seconds, target, model}, extra) => {
      try {
        const {notebook: nb, results} = await runNotebook(notebook, {
          cells,
          restart,
          keepGoing: keep_going,
          timeoutMs: timeout_seconds && timeout_seconds * 1000,
          target,
          writer: writerOf(extra, {model}),
        });
        if (!results.length) return text(`Nothing to run: no code cells${cells?.length ? ' at those indexes' : ''}.\n\n${head(nb)}`);
        const ran = results.map((r) => cellText({...nb.cellsList[r.index]})).join('\n\n');
        const bad = results.filter((r) => r.status !== 'ok');
        const verdict = bad.length ? `Stopped: cell ${bad[0].index} ${bad[0].status === 'timeout' ? 'timed out' : 'raised an error'}.` : `All ${results.length} cell(s) ran without errors.`;
        return text(`${verdict}\n\n${head(nb)}\n\n${ran}`);
      } catch (err) {
        return failed(err);
      }
    },
  );
}
