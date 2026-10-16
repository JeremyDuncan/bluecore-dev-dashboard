// OpenAI Codex CLI (`codex exec`). Codex always comes with a shell and other built-in tools that
// can't all be switched off, so it's locked down in layers:
//   1. macOS sandbox (sandbox-exec) around Codex: it can't read or write anything in your home
//      folder except its own ~/.codex (login) and the chat's empty working folder. Codex's own
//      shell can't start inside it, so every shell command fails.
//   2. Codex's read-only sandbox, approvals off ("never"), web search off.
//   3. ChatGPT apps/connectors, plugins, image generation, sub-agents, browser and computer use
//      are turned off, so it can't act on your connected accounts (e.g. GitHub) either.
//   4. Your ~/.codex/config.toml and rules aren't loaded; the only MCP server is the docs server,
//      whose tools are read-only except the notes write tools (approved below).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describeTool, readJsonLines, run, toolName, which} from './util.mjs';

const BIN = process.env.CODEX_BIN || 'codex';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const DISABLED_FEATURES = [
  'apps', 'plugins', 'remote_plugin', 'image_generation', 'multi_agent', 'computer_use', 'browser_use',
  'browser_use_external', 'in_app_browser', 'view_image', 'goals', 'skill_search', 'tool_suggest', 'hooks',
  'skill_mcp_dependency_install',
];

// Sandbox profile: hide the home folder except Codex's own folder and the working folder.
// File details (stat: exists / size / date) stay readable so Codex can resolve its own paths;
// file contents and folder listings stay blocked.
function sandboxProfile(cwd) {
  const file = path.join(cwd, 'codex-sandbox.sb');
  const q = (p) => JSON.stringify(fs.realpathSync(p));
  fs.writeFileSync(
    file,
    `(version 1)
(allow default)
(deny file-read* file-write* (subpath ${q(os.homedir())}))
(allow file-read-metadata)
(allow file-read* file-write* (subpath ${q(CODEX_HOME)}))
(allow file-read* file-write* (subpath ${q(cwd)}))
`,
  );
  return file;
}

// The models Codex offers your account, from Codex's own cache (refreshed when you use Codex).
function codexModels() {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, 'models_cache.json'), 'utf8'));
    const list = (cache.models ?? []).filter((m) => m.visibility === 'list' && m.slug);
    if (list.length) return list.map((m) => ({id: m.slug, label: m.display_name || m.slug, description: m.description || ''}));
  } catch {
    // no cache yet
  }
  return [];
}

function configuredModel() {
  try {
    return fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8').match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export default {
  id: 'codex',
  name: 'Codex',
  icon: 'codex',
  get models() {
    return codexModels();
  },
  get defaultModel() {
    return process.env.CHAT_CODEX_MODEL || configuredModel() || codexModels()[0]?.id || null;
  },
  setup: {
    install: [
      {label: 'Install with npm', command: 'npm install -g @openai/codex'},
      {label: 'or with Homebrew', command: 'brew install --cask codex'},
    ],
    login: [{label: 'Log in with your ChatGPT account (opens your browser)', command: 'codex login'}],
    docs: 'https://developers.openai.com/codex/cli',
  },

  async status() {
    if (process.platform !== 'darwin') {
      return {installed: false, loggedIn: false, unsupported: 'Codex chat needs macOS: it runs inside a macOS sandbox so it can’t read your files.'};
    }
    const bin = await which(BIN);
    if (!bin) return {installed: false, loggedIn: false};
    const [version, login] = await Promise.all([run(bin, ['--version']), run(bin, ['login', 'status'])]);
    return {
      installed: true,
      loggedIn: login.ok && /logged in/i.test(login.stdout + login.stderr),
      version: version.stdout.trim().split(/\s+/).pop() || null,
    };
  },

  async ask({question, sessionId, model, systemPrompt, mcpUrl, writer, cwd, emit}) {
    const bin = await which(BIN); // real path: the PATH symlink may sit in the hidden home folder
    const config = [
      'approval_policy="never"',
      'sandbox_mode="read-only"',
      'web_search="disabled"',
      `mcp_servers.docs.url=${JSON.stringify(mcpUrl)}`,
      // Tells the MCP server which AI writes any notes (see mcp/agent-runs.mjs); a TOML inline table
      `mcp_servers.docs.http_headers={${Object.entries({'x-notes-agent': writer.agent, 'x-notes-model': writer.model ?? '', 'x-notes-run': writer.run})
        .map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`)
        .join(',')}}`,
      // The notes and notebook write tools aren't read-only, so with approvals off Codex would refuse them: approve
      // just these (they only add or change notes and notebooks, or run notebooks; the prompt allows them only when asked)
      ...['create_note', 'update_note', 'duplicate_note', 'complete_task', 'rename_note', 'pin_note', 'attach_image', 'save_template', 'create_notebook', 'update_notebook', 'run_notebook'].map(
        (tool) => `mcp_servers.docs.tools.${tool}.approval_mode="approve"`,
      ),
      'mcp_servers.docs.tool_timeout_sec=600', // run_notebook can take minutes (Codex's default is 60 s)
      ...DISABLED_FEATURES.map((f) => `features.${f}=false`),
    ].flatMap((c) => ['-c', c]);
    const common = ['--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', ...config, ...(model ? ['-m', model] : [])];
    const args = sessionId ? ['exec', 'resume', ...common, sessionId, '-'] : ['exec', ...common];
    const child = spawn('/usr/bin/sandbox-exec', ['-f', sandboxProfile(cwd), bin, ...args], {cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe']});
    // Codex has no separate system prompt option here, so the instructions lead the first message
    child.stdin.end(sessionId ? question : `${systemPrompt}\n\n---\n\nQuestion: ${question}`);
    if (model) emit('model', {model}); // Codex takes exact model ids (gpt-5.1-codex, …)

    let thread = sessionId;
    let answer = '';
    readJsonLines(child.stdout, (e) => {
      if (e.type === 'thread.started') thread = e.thread_id;
      else if (e.type === 'item.started' && e.item?.type === 'mcp_tool_call') {
        const text = describeTool(e.item.tool ?? '', e.item.arguments ?? {});
        emit('status', {text});
        emit('tool', {name: toolName(e.item.tool), text}); // kept with the answer ("Show tool usage" in the chat)
      } else if (e.type === 'item.completed' && e.item?.type === 'agent_message') {
        answer = e.item.text ?? '';
        emit('turn', {});
        emit('delta', {text: answer});
      } else if (e.type === 'turn.completed') {
        emit('done', {sessionId: thread, answer});
      } else if (e.type === 'turn.failed' || e.type === 'error') {
        emit('error', {message: e.error?.message ?? e.message ?? 'Codex stopped with an error'});
      }
    });
    return child;
  },

  loginHint: (stderr) => (/log ?in|auth|401|unauthorized/i.test(stderr) ? 'Run `codex login` in a terminal.' : ''),
};
