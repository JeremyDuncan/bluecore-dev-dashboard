// Runs a language-specific doc generator per project and copies its Markdown output
// into docs/reference/<name>/. Examples for docs-sources.json "codeDocs":
//
//   TypeScript/JS: npx typedoc --plugin typedoc-plugin-markdown --out ./.docs-out src/index.ts
//   Python:        pydoc-markdown (configure output to .docs-out)
//   Ruby:          AI agent recommended (see AGENT_PROMPTS.md); YARD's HTML output isn't Markdown
//   OpenAPI:       npx widdershins openapi.yaml -o .docs-out/api.md
import {execSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DOCS_DIR, ROOT, enabled, loadSources, log, resetDir} from './lib.mjs';

const OUT_DIR = path.join(DOCS_DIR, 'reference');

export async function syncCodeDocs() {
  const projects = enabled((await loadSources()).codeDocs);
  await resetDir(OUT_DIR, {label: 'API Reference (generated)', position: 70});
  for (const project of projects) {
    try {
      const cwd = path.resolve(ROOT, project.cwd);
      execSync(project.command, {cwd, stdio: 'inherit'});
      const target = path.join(OUT_DIR, project.name);
      await fs.cp(path.join(cwd, project.output), target, {recursive: true});
      await fs.writeFile(
        path.join(target, '_category_.json'),
        JSON.stringify({label: project.label ?? project.name}, null, 2) + '\n',
      );
      log('code-docs', `✓ docs/reference/${project.name}`);
    } catch (err) {
      log('code-docs', `✗ ${project.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await syncCodeDocs();
