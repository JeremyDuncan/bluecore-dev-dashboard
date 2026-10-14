// Builds static/llms.txt (page index) and static/llms-full.txt (all docs concatenated)
// so any AI agent can read the whole doc set in one request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DOCS_DIR, ROOT, log} from './lib.mjs';

async function walk(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return files.flat().filter((f) => /\.mdx?$/.test(f)).sort();
}

export async function buildLlmsTxt() {
  const files = await walk(DOCS_DIR);
  const index = ['# Blue Core Project Docs', '', '> Developer documentation. Full text: llms-full.txt', ''];
  const full = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const rel = path.relative(DOCS_DIR, file);
    const title = text.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? rel;
    // Relative links so they resolve under the site's baseUrl; honor a `slug:` override.
    const slug = text.match(/^slug:\s*(.+?)\s*$/m)?.[1];
    const url = (slug ?? rel.replace(/\.mdx?$/, '')).replace(/^\//, '') || './';
    index.push(`- [${title}](${url})`);
    full.push(`\n\n<!-- ${rel} -->\n\n# ${title}\n\n${text.replace(/^---[\s\S]*?---\n/, '')}`);
  }
  await fs.mkdir(path.join(ROOT, 'static'), {recursive: true});
  await fs.writeFile(path.join(ROOT, 'static', 'llms.txt'), index.join('\n') + '\n');
  await fs.writeFile(path.join(ROOT, 'static', 'llms-full.txt'), full.join('').trim() + '\n');
  log('llms-txt', `✓ indexed ${files.length} pages`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildLlmsTxt();
