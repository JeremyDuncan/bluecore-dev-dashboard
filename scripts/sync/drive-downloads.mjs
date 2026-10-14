// Converts files downloaded from Google Drive into docs/google-drive/<slug>/.
// No Google API access needed — for when your organization blocks API tokens.
//
//   1. In Google Drive, right-click the folder → Download. Google Docs arrive as .docx inside a .zip.
//   2. Put the .zip (or the extracted files) in the folder named by "dir" in docs-sources.json.
//   3. Run `make sync`.
//
// Local only: imports/ and docs/google-drive/ are git-ignored, and the section is removed when the
// folder is empty. Unchanged downloads aren't converted again (see fingerprint in lib.mjs).
//
// Handles .zip (extracted), .docx (converted with pandoc, images included) and .md (copied).
// Requires `pandoc` and `unzip` (both are installed in the Docker image).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DOCS_DIR, ROOT, dropEmptySection, enabled, extractTitle, fingerprint, isUpToDate, loadSources, log, writeDoc, writeStamp} from './lib.mjs';
import {DRIVE_CATEGORY, OUT_DIR, slugify} from './google-docs.mjs';

export async function walk(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const nested = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.') && !e.name.startsWith('~$'))
      .map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return nested.flat().sort();
}

// Extract every .zip into a temp folder so zips and loose files are handled the same way.
async function collectFiles(sourceDir) {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-'));
  for (const file of await walk(sourceDir)) {
    const rel = path.relative(sourceDir, file);
    if (/\.zip$/i.test(file)) {
      execFileSync('unzip', ['-q', '-o', file, '-d', path.join(staging, path.dirname(rel))]);
    } else {
      await fs.mkdir(path.join(staging, path.dirname(rel)), {recursive: true});
      await fs.cp(file, path.join(staging, rel), {preserveTimestamps: true}); // keep the modified date
    }
  }
  // Drive zips wrap everything in a folder named after the downloaded folder; skip that extra level.
  const top = await fs.readdir(staging, {withFileTypes: true});
  if (top.length === 1 && top[0].isDirectory()) return {staging, root: path.join(staging, top[0].name)};
  return {staging, root: staging};
}

export function docxToMarkdown(file, outDir, slug) {
  // Run inside outDir so image paths in the Markdown come out relative to the page.
  return execFileSync(
    'pandoc',
    [
      file,
      '--from=docx',
      '--to=gfm-raw_html',
      '--wrap=none',
      `--extract-media=_media/${slug}`,
      `--lua-filter=${path.join(ROOT, 'scripts/sync/pandoc/google-docx.lua')}`,
    ],
    {cwd: outDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
  );
}

export async function syncDriveDownloads() {
  const entries = enabled((await loadSources()).driveDownloads);
  for (const entry of entries) {
    const projectDir = path.join(OUT_DIR, entry.slug);
    try {
      const sourceDir = path.resolve(ROOT, entry.dir);
      const downloads = await walk(sourceDir).catch(() => []);
      if (downloads.length === 0) {
        // Downloads are local only (git-ignored): without them the section isn't part of this site.
        await fs.rm(projectDir, {recursive: true, force: true});
        log('drive-downloads', `- ${entry.slug}: nothing in ${entry.dir}, left out of the site`);
        continue;
      }
      const stamp = await fingerprint(downloads);
      if (await isUpToDate(projectDir, stamp)) {
        log('drive-downloads', `✓ docs/google-drive/${entry.slug}/ unchanged`);
        continue;
      }
      const {staging, root} = await collectFiles(sourceDir);
      await fs.mkdir(OUT_DIR, {recursive: true});
      await fs.writeFile(path.join(OUT_DIR, '_category_.json'), JSON.stringify(DRIVE_CATEGORY, null, 2) + '\n');
      await fs.rm(projectDir, {recursive: true, force: true});
      await fs.mkdir(projectDir, {recursive: true});
      await fs.writeFile(
        path.join(projectDir, '_category_.json'),
        JSON.stringify({label: entry.title ?? entry.slug}, null, 2) + '\n',
      );

      const counts = {docs: 0, skipped: 0};
      for (const file of await walk(root)) {
        const rel = path.relative(root, file);
        const name = path.basename(rel).replace(/\.(docx|md|markdown)$/i, '');
        // Slugify each folder name so URLs stay clean; the folder's real name becomes its sidebar label.
        const relDir = path.dirname(rel) === '.' ? [] : path.dirname(rel).split(path.sep);
        const outDir = path.join(projectDir, ...relDir.map(slugify));
        await fs.mkdir(outDir, {recursive: true});
        for (let i = 0; i < relDir.length; i++) {
          const categoryFile = path.join(projectDir, ...relDir.slice(0, i + 1).map(slugify), '_category_.json');
          await fs.writeFile(categoryFile, JSON.stringify({label: relDir[i]}, null, 2) + '\n');
        }

        let markdown;
        if (/\.docx$/i.test(file)) markdown = docxToMarkdown(file, outDir, slugify(name));
        else if (/\.(md|markdown)$/i.test(file)) markdown = await fs.readFile(file, 'utf8');
        else {
          counts.skipped++; // .xlsx, .pptx, .pdf, images, ...
          continue;
        }
        const {body} = extractTitle(markdown, name);
        // Drive zips keep each file's last-modified date
        const lastUpdate = {date: (await fs.stat(file)).mtime};
        await writeDoc(outDir, {slug: slugify(name), title: name, lastUpdate, source: entry.driveUrl ?? null, body});
        counts.docs++;
      }
      await fs.rm(staging, {recursive: true, force: true});
      await writeStamp(projectDir, stamp);
      log('drive-downloads', `✓ docs/google-drive/${entry.slug}/ (${counts.docs} docs, ${counts.skipped} other files skipped)`);
    } catch (err) {
      log('drive-downloads', `✗ ${entry.slug}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  await dropEmptySection(OUT_DIR);
}

if (import.meta.url === `file://${process.argv[1]}`) await syncDriveDownloads();
