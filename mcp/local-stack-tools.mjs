// MCP tool for the developer's own bluecore-stack checkout (BLUECORE_STACK_DIR, local-stack.mjs):
// local_stack shows where it is, its branch, commit and uncommitted changes, compose files and services,
// and reads its files, including changes not pushed to GitHub (get_file reads GitHub). Settings files
// that hold secrets (.env, .secrets, Keycloak exports) aren't readable, and secret values are redacted.
import {z} from 'zod';
import {readStackPath, stackInfo, StackError} from './local-stack.mjs';

const text = (t) => ({content: [{type: 'text', text: t}]});

function summary() {
  const s = stackInfo();
  if (!s.configured) return {...text(`The local stack checkout isn't set up. ${s.hint}`), isError: true};
  const changes = s.uncommitted == null ? 'unknown (git unavailable here)' : s.uncommitted.length ? `\n${s.uncommitted.map((l) => `  ${l}`).join('\n')}` : 'none';
  return text(
    [
      `Local bluecore-stack checkout: ${s.path}`,
      `branch: ${s.branch ?? 'unknown'}`,
      s.commit ? `last commit: ${s.commit}` : null,
      `uncommitted changes: ${changes}`,
      `compose files: ${s.composeFiles.join(', ')}`,
      s.services.length ? `services (compose-base.yaml): ${s.services.join(', ')}` : null,
      s.envKeys.length ? `.env sets (values hidden): ${s.envKeys.join(', ')}` : '.env: none',
      '',
      'Pass path to list a folder or read a file (e.g. "compose-dev.yaml", "docs", "nginx").',
    ]
      .filter((l) => l != null)
      .join('\n'),
  );
}

export function registerLocalStackTools(server) {
  server.registerTool(
    'local_stack',
    {
      title: 'Your local stack checkout',
      description:
        'The user\'s own bluecore-stack checkout on this machine: where it is, its branch, last commit and uncommitted changes, compose files and services, ' +
        'and which .env settings it has (names only). Pass path to list a folder or read a file from it, including local changes that aren\'t on GitHub ' +
        '(get_file reads GitHub). Settings files with secrets aren\'t readable.',
      inputSchema: {path: z.string().max(500).optional().describe('A file or folder in the checkout, relative to its root (e.g. "compose-dev.yaml", "nginx/")')},
      annotations: {readOnlyHint: true},
    },
    async ({path: rel}) => {
      if (!rel) return summary();
      try {
        const r = readStackPath(rel);
        if (r.entries) {
          const lines = r.entries.map((e) => `- ${e.name}${e.dir ? '/' : ''}${e.hidden ? ' (not readable: may hold secrets)' : ''}`);
          return text(`${r.dir || '(root)'}: ${r.entries.length} entries\n\n${lines.join('\n')}`);
        }
        const lang = r.file.split('.').pop();
        return text(`${r.file} (${r.size} bytes${r.truncated ? ', first 200 KB' : ''})\n\n\`\`\`${lang}\n${r.text}\n\`\`\``);
      } catch (err) {
        if (err instanceof StackError) return {...text(err.message), isError: true};
        throw err;
      }
    },
  );
}
