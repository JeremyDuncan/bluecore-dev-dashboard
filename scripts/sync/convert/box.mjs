// Box Notes (.boxnote) and Box Canvas (.boxcanvas) → Markdown.
//
// Box Drive stores both as JSON. Notes are a ProseMirror document; a canvas is a whiteboard
// whose sticky notes and shapes each hold a small ProseMirror document. Node names come in
// both snake_case (notes) and camelCase (canvas), so they're normalized first.

const kind = (node) => node.type?.replace(/([A-Z])/g, '_$1').toLowerCase();

function inline(nodes = []) {
  return nodes
    .map((n) => {
      if (kind(n) === 'hard_break') return '  \n';
      if (kind(n) === 'embed' || kind(n) === 'image') {
        const url = n.attrs?.url ?? n.attrs?.src;
        return url && /^https?:/.test(url) ? `[${url}](${url})` : '';
      }
      if (kind(n) !== 'text') return inline(n.content);
      let text = n.text ?? '';
      const marks = new Set((n.marks ?? []).map(kind));
      if (marks.has('code')) text = `\`${text}\``;
      if (marks.has('strong') || marks.has('bold')) text = `**${text}**`;
      if (marks.has('em') || marks.has('italic')) text = `*${text}*`;
      if (marks.has('strikethrough') || marks.has('strike')) text = `~~${text}~~`;
      const link = (n.marks ?? []).find((m) => kind(m) === 'link')?.attrs?.href;
      if (link) text = `[${text}](${link})`;
      return text;
    })
    .join('');
}

function blocks(nodes = [], indent = '') {
  const out = [];
  for (const n of nodes) {
    const t = kind(n);
    if (t === 'paragraph') out.push(indent + inline(n.content));
    else if (t === 'heading') out.push(`${'#'.repeat(Math.min((n.attrs?.level ?? 1) + 1, 6))} ${inline(n.content)}`);
    else if (t === 'bullet_list' || t === 'ordered_list' || t === 'check_list') {
      const lines = [];
      (n.content ?? []).forEach((item, i) => {
        const marker =
          t === 'ordered_list' ? `${i + 1}.` : t === 'check_list' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
        const [first, ...rest] = blocks(item.content, '').filter((line) => line.trim());
        lines.push(`${indent}${marker} ${first ?? ''}`);
        for (const line of rest) lines.push(line.replace(/^/gm, `${indent}  `));
      });
      out.push(lines.join('\n')); // one block, so the list stays tight (no blank lines between items)
    } else if (t === 'blockquote') out.push(...blocks(n.content).map((l) => l.replace(/^/gm, '> ')));
    else if (t === 'code_block') out.push('```\n' + inline(n.content) + '\n```');
    else if (t === 'horizontal_rule') out.push('---');
    else if (t === 'table') out.push(table(n));
    else if (n.content) out.push(...blocks(n.content, indent)); // callouts, columns, unknown wrappers
    else if (t === 'embed' || t === 'image') out.push(indent + inline([n]));
  }
  return out;
}

function table(node) {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => blocks(cell.content).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${Array.from({length: width}, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

const render = (doc) => blocks(doc?.content).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

export function boxnoteToMarkdown(json) {
  const data = JSON.parse(json);
  return render(data.doc) + '\n';
}

// Sticky notes and shapes with text, read top-to-bottom then left-to-right. Arrows are dropped.
export function boxcanvasToMarkdown(json) {
  const data = JSON.parse(json);
  const items = (data.widgets ?? [])
    .map((w) => w.data)
    .filter((d) => d?.content && d.type !== 'link')
    .map((d) => ({y: d.metrics?.y ?? 0, x: d.metrics?.x ?? 0, text: render(d.content) || d.content.text?.trim()}))
    .filter((d) => d.text)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (items.length === 0) return '*This canvas has no text.*\n';
  return (
    '*Text from a Box Canvas whiteboard. Open it in Box to see the layout and arrows.*\n\n' +
    items.map((d, i) => `### Item ${i + 1}\n\n${d.text}`).join('\n\n') +
    '\n'
  );
}
