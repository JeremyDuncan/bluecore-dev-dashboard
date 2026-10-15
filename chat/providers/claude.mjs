// Claude Code CLI (`claude -p`). Only the docs MCP tools are available: built-in tools are off
// (no shell, no file access) and user/project settings, hooks and CLAUDE.md files aren't loaded.
import {spawn} from 'node:child_process';
import {describeTool, readJsonLines, run, which} from './util.mjs';

const BIN = process.env.CLAUDE_BIN || 'claude';
// Every tool of the docs MCP server: read-only (docs, GitHub, API reference, notes) except
// create_note / update_note, which only add to or change the notes vault
const TOOLS = ['mcp__docs'];

export default {
  id: 'claude',
  name: 'Claude Code',
  icon: 'claude',
  models: [
    {id: 'sonnet', label: 'Sonnet', description: 'Fast and capable (recommended)'},
    {id: 'opus', label: 'Opus', description: 'Most capable, slower'},
    {id: 'haiku', label: 'Haiku', description: 'Fastest'},
  ],
  defaultModel: process.env.CHAT_CLAUDE_MODEL || 'sonnet',
  setup: {
    install: [
      {label: 'Install (macOS / Linux)', command: 'curl -fsSL https://claude.ai/install.sh | bash'},
      {label: 'or with npm', command: 'npm install -g @anthropic-ai/claude-code'},
    ],
    login: [{label: 'Log in (opens your browser), then type /exit', command: 'claude'}],
    docs: 'https://code.claude.com/docs',
  },

  async status() {
    const path = await which(BIN);
    if (!path) return {installed: false, loggedIn: false};
    const [version, auth] = await Promise.all([run(path, ['--version']), run(path, ['auth', 'status'])]);
    let loggedIn = false;
    try {
      loggedIn = Boolean(JSON.parse(auth.stdout).loggedIn);
    } catch {
      loggedIn = auth.ok;
    }
    return {installed: true, loggedIn, version: version.stdout.trim().split(' ')[0] || null};
  },

  // Starts one question. Emits: turn, delta, status, done {sessionId, answer}, error. Returns the child process.
  ask({question, sessionId, model, systemPrompt, mcpUrl, writer, cwd, emit}) {
    // Tells the MCP server which AI writes any notes (see mcp/agent-runs.mjs)
    const headers = {'x-notes-agent': writer.agent, 'x-notes-model': writer.model, 'x-notes-run': writer.run};
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      '--tools', '', // no built-in tools
      '--mcp-config', JSON.stringify({mcpServers: {docs: {type: 'http', url: mcpUrl, headers}}}),
      '--strict-mcp-config',
      '--allowedTools', TOOLS.join(','),
      '--permission-mode', 'dontAsk', // anything not allowed above is refused, never prompted
      '--setting-sources', '', // ignore user/project settings, hooks and CLAUDE.md
      '--system-prompt', systemPrompt,
      ...(sessionId ? ['--resume', sessionId] : []),
    ];
    const child = spawn(BIN, args, {cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(question); // stdin, never a command-line argument

    readJsonLines(child.stdout, (e) => {
      // The first event names the exact model behind an alias like "sonnet"
      if (e.type === 'system' && e.subtype === 'init' && e.model) emit('model', {model: e.model});
      else if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.type === 'text_delta') {
        emit('delta', {text: e.event.delta.text});
      } else if (e.type === 'stream_event' && e.event?.type === 'message_start') {
        emit('turn', {});
      } else if (e.type === 'assistant') {
        for (const c of e.message?.content ?? []) if (c.type === 'tool_use') emit('status', {text: describeTool(c.name, c.input)});
      } else if (e.type === 'result') {
        if (e.subtype === 'success') emit('done', {sessionId: e.session_id, answer: e.result});
        else emit('error', {message: `Claude Code stopped: ${e.subtype}`});
      }
    });
    return child;
  },

  loginHint: (stderr) => (/log ?in|auth|credential/i.test(stderr) ? 'Run `claude` in a terminal to log in.' : ''),
};
