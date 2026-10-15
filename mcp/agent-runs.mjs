// Which AI wrote a note: the agent (Claude Code, Codex, …) and its exact model.
//
// The chat helper (chat/server.mjs) starts each CLI with MCP headers naming itself:
//   x-notes-agent: Claude Code     x-notes-model: sonnet     x-notes-run: <id for this answer>
// A model alias like "sonnet" only becomes an exact model id once the CLI has started, so the helper
// then registers the run's exact model (POST /api/notes/agent-run), and tool calls with that run id
// get it. Other agents connected straight to /mcp are recognized by their User-Agent where possible
// and may name their model in the tool call.

const TTL_MS = 60 * 60 * 1000;
const runs = new Map(); // run id → {agent, model, at}

export function registerRun({run, agent, model}) {
  if (typeof run !== 'string' || !/^[\w-]{8,64}$/.test(run)) return false;
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.at > TTL_MS) runs.delete(id);
  runs.set(run, {agent: clean(agent), model: clean(model), at: now});
  return true;
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

// User-Agent → agent name, for agents that connect without the chat helper's headers
function agentFromUserAgent(ua = '') {
  if (/claude-code|claude-cli/i.test(ua)) return 'Claude Code';
  if (/codex/i.test(ua)) return 'Codex';
  if (/cursor/i.test(ua)) return 'Cursor';
  return null;
}

// {author, model} for a write tool call. `extra` is the MCP SDK's handler context (its request
// headers); `claimed` is what the agent said about itself in the call, used only when the headers
// don't say. The chat helper's headers win, since the CLI was started with them.
export function writerOf(extra, claimed = {}) {
  const h = extra?.requestInfo?.headers ?? {};
  const header = (name) => clean(Array.isArray(h[name]) ? h[name][0] : h[name]);
  const run = runs.get(header('x-notes-run'));
  const author = header('x-notes-agent') ?? run?.agent ?? clean(claimed.author) ?? agentFromUserAgent(header('user-agent') ?? '') ?? 'AI agent';
  const model = run?.model ?? header('x-notes-model') ?? clean(claimed.model);
  return {author, model};
}
