// Small Markdown renderer for chat answers: paragraphs, headings, lists, tables, code, bold,
// italics and links. Builds React elements (no innerHTML), so answer text can't inject markup.
// Links to the docs site become in-site links, so they work on whichever port you're viewing.
import React from 'react';
import Link from '@docusaurus/Link';

function DocLink({href, children}) {
  let url;
  try {
    url = new URL(href, 'http://localhost');
  } catch {
    return <span>{children}</span>;
  }
  if (!/^https?:$/.test(url.protocol)) return <span>{children}</span>; // no javascript: etc.
  if (['localhost', '127.0.0.1'].includes(url.hostname) || href.startsWith('/')) {
    return <Link to={url.pathname + url.hash}>{children}</Link>;
  }
  return (
    <a href={url.href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// GitHub links in release notes read better short: …/pull/358 → #358, …/compare/a...b → a...b
function shortUrl(url) {
  const gh = url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)$/);
  if (gh) return `#${gh[1]}`;
  const compare = url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/(.+)$/);
  return compare ? compare[1] : url;
}

// Inline: `code`, **bold**, *italic* / _italic_, [text](url), bare URLs
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(https?:\/\/[^\s)]+)/g;

function inline(text, keyPrefix = '') {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}${i++}`;
    const [token] = m;
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{inline(token.slice(2, -2), `${key}-`)}</strong>);
    else if (m[3]) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push(
        <DocLink key={key} href={href}>
          {inline(label, `${key}-`)}
        </DocLink>,
      );
    } else if (m[4]) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (m[5]) out.push(<DocLink key={key} href={token}>{shortUrl(token)}</DocLink>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export default function Markdown({text}) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (/^\s*```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<p key={key} className="ask-heading">{inline(line.replace(/^#+\s*/, ''))}</p>);
      i++;
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key} className="ask-table">
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const item = lines[i].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (item) items.push({depth: item[1].length >= 2 ? 1 : 0, text: item[3]});
        else items[items.length - 1].text += ` ${lines[i].trim()}`;
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j} className={it.depth ? 'ask-nested' : undefined}>
              {inline(it.text)}
            </li>
          ))}
        </List>,
      );
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(\s*```|#{1,6}\s|\s*([-*]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
      if (para.length === 0) para.push(lines[i++]); // a line no other rule took
      blocks.push(<p key={key}>{inline(para.join(' '))}</p>);
    }
  }
  return <>{blocks}</>;
}
