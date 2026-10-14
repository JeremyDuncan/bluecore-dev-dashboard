// PowerPoint (.pptx) → Markdown: one section per slide with its text and speaker notes.
// Pandoc can't read .pptx, but it's a zip of XML files, so `unzip -p` is all that's needed.
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const unzipFile = (file, member) => {
  try {
    return execFileSync('unzip', ['-p', file, member], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  } catch {
    return '';
  }
};

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

// Relationship id → target path, from a .rels file.
function rels(file, member) {
  const map = new Map();
  for (const m of unzipFile(file, member).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

// Each shape (<p:sp>) → {kind, paragraphs: [{level, text}]}. Placeholders like slide numbers are dropped.
function shapes(xml) {
  const out = [];
  for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
    const kind = sp.match(/<p:ph\b[^>]*type="(\w+)"/)?.[1] ?? 'body';
    if (['sldNum', 'dt', 'ftr', 'sldImg', 'hdr'].includes(kind)) continue;
    const paragraphs = [];
    for (const p of sp.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? []) {
      const text = decode([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''))
        .replace(/\s+/g, ' ')
        .trim();
      if (text) paragraphs.push({level: Number(p.match(/<a:pPr\b[^>]*lvl="(\d+)"/)?.[1] ?? 0), text});
    }
    if (paragraphs.length) out.push({kind, paragraphs});
  }
  return out;
}

export function pptxToMarkdown(file) {
  // Slides in presentation order (slide file numbers don't always match).
  const presRels = rels(file, 'ppt/_rels/presentation.xml.rels');
  const order = [...unzipFile(file, 'ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)]
    .map((m) => presRels.get(m[1]))
    .filter(Boolean)
    .map((t) => path.posix.join('ppt', t));

  const sections = [];
  order.forEach((slidePath, i) => {
    const all = shapes(unzipFile(file, slidePath));
    const titleShape = all.find((s) => s.kind === 'title' || s.kind === 'ctrTitle');
    const title = titleShape?.paragraphs.map((p) => p.text).join(' ') || 'Untitled';
    const lines = [`## Slide ${i + 1}: ${title}`, ''];
    for (const s of all.filter((x) => x !== titleShape)) {
      for (const p of s.paragraphs) lines.push(`${'  '.repeat(p.level)}- ${p.text}`);
      lines.push('');
    }

    const slideRels = rels(file, slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const notesTarget = [...slideRels.values()].find((t) => t.includes('notesSlide'));
    if (notesTarget) {
      const notes = shapes(unzipFile(file, path.posix.join(path.posix.dirname(slidePath), notesTarget)))
        .flatMap((s) => s.paragraphs.map((p) => p.text))
        .filter(Boolean);
      if (notes.length) lines.push('**Speaker notes:**', '', ...notes.map((n) => `> ${n}`), '');
    }
    sections.push(lines.join('\n').trim());
  });
  return sections.join('\n\n') + '\n';
}
