// Pulls Google Docs as Markdown into docs/google-drive/.
//
// Two kinds of entries in docs-sources.json "googleDocs":
//   - One doc:     { "id": "<doc id>", "slug": "onboarding" }
//   - A folder:    { "folder": "<folder or shared drive id>", "slug": "team-docs", "title": "Team Docs" }
//       → every Google Doc (and uploaded .md file) in it, subfolders included, keeping the folder structure.
//
// Auth:
//   - Single docs shared "Anyone with the link can view" need no credentials.
//   - Folders and private docs need GOOGLE_ACCESS_TOKEN (Drive read-only scope). See README.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DOCS_DIR, enabled, extractTitle, loadSources, log, writeDoc} from './lib.mjs';

export const OUT_DIR = path.join(DOCS_DIR, 'google-drive');
export const DRIVE_CATEGORY = {label: 'Google Drive', position: 60};
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';
const MARKDOWN_TYPES = ['text/markdown', 'text/x-markdown'];

function authHeaders() {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  return token ? {Authorization: `Bearer ${token}`} : {};
}

async function driveFetch(url) {
  const res = await fetch(url, {headers: authHeaders()});
  const body = await res.text();
  if (!res.ok || body.trimStart().startsWith('<!DOCTYPE html')) {
    const hint = process.env.GOOGLE_ACCESS_TOKEN
      ? 'token expired or has no access to this file?'
      : 'not shared "anyone with the link", and GOOGLE_ACCESS_TOKEN is not set';
    throw new Error(`HTTP ${res.status} (${hint})`);
  }
  return body;
}

function exportDoc(id) {
  return process.env.GOOGLE_ACCESS_TOKEN
    ? driveFetch(`${DRIVE_API}/files/${id}/export?mimeType=text/markdown`)
    : driveFetch(`https://docs.google.com/document/d/${id}/export?format=md`);
}

async function listFolder(folderId) {
  if (!process.env.GOOGLE_ACCESS_TOKEN) throw new Error('folders need GOOGLE_ACCESS_TOKEN (see README.md)');
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = JSON.parse(await driveFetch(`${DRIVE_API}/files?${params}`));
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/\.(md|markdown)$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

async function syncFolder(folderId, dir, counts) {
  const files = await listFolder(folderId);
  await fs.mkdir(dir, {recursive: true});
  for (const file of files) {
    try {
      if (file.mimeType === FOLDER) {
        const subdir = path.join(dir, slugify(file.name));
        await syncFolder(file.id, subdir, counts);
        await fs.writeFile(path.join(subdir, '_category_.json'), JSON.stringify({label: file.name}, null, 2) + '\n');
        continue;
      }
      let markdown;
      if (file.mimeType === GOOGLE_DOC) markdown = await exportDoc(file.id);
      else if (MARKDOWN_TYPES.includes(file.mimeType)) markdown = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media&supportsAllDrives=true`);
      else {
        counts.skipped++; // Sheets, Slides, PDFs, images, ...
        continue;
      }
      const {body} = extractTitle(markdown, file.name);
      await writeDoc(dir, {
        slug: slugify(file.name),
        title: file.name.replace(/\.(md|markdown)$/i, ''),
        source: `https://drive.google.com/open?id=${file.id}`,
        body,
      });
      counts.docs++;
    } catch (err) {
      log('google-docs', `✗ ${file.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

export async function syncGoogleDocs() {
  const entries = enabled((await loadSources()).googleDocs);
  // Only remove what this step owns, so pages built from Drive downloads survive.
  const owned = new Set(entries.map((e) => e.slug));
  const existing = await fs.readdir(OUT_DIR).catch(() => []);
  for (const name of existing) {
    if (owned.has(name.replace(/\.md$/, ''))) await fs.rm(path.join(OUT_DIR, name), {recursive: true, force: true});
  }
  await fs.mkdir(OUT_DIR, {recursive: true});
  await fs.writeFile(path.join(OUT_DIR, '_category_.json'), JSON.stringify(DRIVE_CATEGORY, null, 2) + '\n');
  for (const entry of entries) {
    try {
      if (entry.folder) {
        const dir = path.join(OUT_DIR, entry.slug);
        const counts = {docs: 0, skipped: 0};
        await syncFolder(entry.folder, dir, counts);
        await fs.writeFile(
          path.join(dir, '_category_.json'),
          JSON.stringify({label: entry.title ?? entry.slug}, null, 2) + '\n',
        );
        log('google-docs', `✓ docs/google-drive/${entry.slug}/ (${counts.docs} docs, ${counts.skipped} non-doc files skipped)`);
        continue;
      }
      const markdown = await exportDoc(entry.id);
      const {title, body} = extractTitle(markdown, entry.title ?? entry.slug);
      const file = await writeDoc(OUT_DIR, {
        slug: entry.slug,
        title: entry.title ?? title,
        source: `https://docs.google.com/document/d/${entry.id}/edit`,
        body,
      });
      log('google-docs', `✓ ${file}`);
    } catch (err) {
      log('google-docs', `✗ ${entry.slug}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await syncGoogleDocs();
