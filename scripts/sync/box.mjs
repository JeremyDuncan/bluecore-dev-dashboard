// Imports a Box folder (through the Box Drive app's local folder) into docs/box/<slug>/.
//
// No Box API or developer app needed: Box Drive keeps the files on disk, and Docker mounts
// that folder read-only at /box (BOX_DIR in .env). Runs on every `make up` / `make prod`.
// Local only: docs/box/ is git-ignored, and the section is removed when the folder isn't there.
//
// Converts .docx (pandoc), .boxnote, .boxcanvas, .pptx, .pdf (pdftotext), .md/.txt, and images.
// Anything else (.xlsx, ...) is skipped and listed in the log.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {boxcanvasToMarkdown, boxnoteToMarkdown} from './convert/box.mjs';
import {pptxToMarkdown} from './convert/pptx.mjs';
import {docxToMarkdown, walk} from './drive-downloads.mjs';
import {slugify} from './google-docs.mjs';
import {DOCS_DIR, dropEmptySection, enabled, extractTitle, fingerprint, isUpToDate, loadSources, log, writeDoc, writeStamp} from './lib.mjs';

const OUT_DIR = path.join(DOCS_DIR, 'box');
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
const DOC = /\.(docx|boxnote|boxcanvas|pptx|pdf|md|markdown|txt)$/i;

function pdfToMarkdown(file) {
  const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  return '*Text extracted from a PDF; formatting is approximate.*\n\n```text\n' + text.replace(/```/g, "'''").trim() + '\n```\n';
}

async function convert(file, outDir, slug) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') return docxToMarkdown(file, outDir, slug);
  if (ext === '.boxnote') return boxnoteToMarkdown(await fs.readFile(file, 'utf8'));
  if (ext === '.boxcanvas') return boxcanvasToMarkdown(await fs.readFile(file, 'utf8'));
  if (ext === '.pptx') return pptxToMarkdown(file);
  if (ext === '.pdf') return pdfToMarkdown(file);
  return fs.readFile(file, 'utf8'); // .md / .txt
}

async function syncFolder(entry) {
  const sourceDir = path.resolve(entry.dir);
  const projectDir = path.join(OUT_DIR, entry.slug);
  const files = await walk(sourceDir).catch(() => []);
  if (files.length === 0) {
    // Box Drive not on this machine (CI, BOX_DIR unset): the section isn't part of this site.
    await fs.rm(projectDir, {recursive: true, force: true});
    log('box', `- ${entry.slug}: nothing found in ${entry.dir}, left out of the site (set BOX_DIR in .env to include it)`);
    return;
  }
  const stamp = await fingerprint(files);
  if (await isUpToDate(projectDir, stamp)) {
    log('box', `✓ docs/box/${entry.slug}/ unchanged`);
    return;
  }

  // Build in a staging folder and swap it in at the end, so a failure never leaves half a section.
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'box-'));
  await fs.chmod(staging, 0o755); // mkdtemp makes it private, and fs.cp would copy that onto the section
  const writeCategory = (dir, label, extra = {}) =>
    fs.writeFile(path.join(dir, '_category_.json'), JSON.stringify({label, ...extra}, null, 2) + '\n');
  await writeCategory(staging, entry.title ?? entry.slug);

  const counts = {docs: 0, images: 0, skipped: [], failed: []};
  const used = new Set();
  for (const file of files) {
    const rel = path.relative(sourceDir, file);
    const ext = path.extname(rel);
    const name = path.basename(rel, ext);
    if (!DOC.test(rel) && !IMAGE.test(rel)) {
      counts.skipped.push(rel);
      continue;
    }
    const relDir = path.dirname(rel) === '.' ? [] : path.dirname(rel).split(path.sep);
    const outDir = path.join(staging, ...relDir.map(slugify));
    await fs.mkdir(outDir, {recursive: true});
    for (let i = 0; i < relDir.length; i++) {
      await writeCategory(path.join(staging, ...relDir.slice(0, i + 1).map(slugify)), relDir[i]);
    }
    // "Notes.docx" and "Notes.boxnote" in one folder would both become notes.md
    let slug = slugify(name);
    for (let i = 2; used.has(path.join(outDir, slug)); i++) slug = `${slugify(name)}-${i}`;
    used.add(path.join(outDir, slug));

    try {
      let body;
      if (IMAGE.test(rel)) {
        await fs.mkdir(path.join(outDir, '_media'), {recursive: true});
        const imageName = `${slug}${ext.toLowerCase()}`;
        await fs.copyFile(file, path.join(outDir, '_media', imageName));
        body = `![${name}](./_media/${encodeURIComponent(imageName)})\n`;
        counts.images++;
      } else {
        body = extractTitle(await convert(file, outDir, slug), name).body;
        counts.docs++;
      }
      await writeDoc(outDir, {
        slug,
        title: name,
        lastUpdate: {date: (await fs.stat(file)).mtime}, // Box Drive keeps the file's modified date
        source: entry.boxUrl ?? null,
        origin: `Box, ${path.join(path.basename(sourceDir), rel)}`,
        body: `*From Box: \`${path.join(path.basename(sourceDir), rel)}\`*\n\n${body}`,
      });
    } catch (err) {
      // Usually a Box Drive file that's online-only and couldn't be downloaded
      counts.failed.push(`${rel} (${err.message.split('\n')[0]})`);
    }
  }

  await fs.rm(projectDir, {recursive: true, force: true});
  await fs.mkdir(path.dirname(projectDir), {recursive: true});
  await fs.cp(staging, projectDir, {recursive: true});
  await fs.rm(staging, {recursive: true, force: true});

  log('box', `✓ docs/box/${entry.slug}/ (${counts.docs} docs, ${counts.images} images)`);
  if (counts.skipped.length) log('box', `  skipped (format not supported): ${counts.skipped.join(', ')}`);
  if (counts.failed.length) {
    log('box', `  ✗ failed: ${counts.failed.join('; ')}`);
    process.exitCode = 1;
  } else {
    await writeStamp(projectDir, stamp); // with failures, try again next time
  }
}

export async function syncBox() {
  const entries = enabled((await loadSources()).boxFolders);
  await fs.mkdir(OUT_DIR, {recursive: true});
  // With a landing page at /box listing what's in it (the navbar's Docs menu links there)
  const category = {
    label: 'Box',
    position: 70,
    link: {type: 'generated-index', slug: '/box', title: 'Box', description: 'MVP planning documents from the project Box folder. Internal: only on machines that have the files.'},
  };
  await fs.writeFile(path.join(OUT_DIR, '_category_.json'), JSON.stringify(category, null, 2) + '\n');
  for (const entry of entries) {
    try {
      await syncFolder(entry);
    } catch (err) {
      log('box', `✗ ${entry.slug}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  await dropEmptySection(OUT_DIR);
}

if (import.meta.url === `file://${process.argv[1]}`) await syncBox();
