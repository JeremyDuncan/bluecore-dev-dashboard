// Cell outputs as the notebook saved them: streams, results, tables (pandas HTML, rebuilt safely),
// images, Markdown and errors. Also the Markdown renderer for Markdown cells.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './styles.module.css';

// Markdown cells and outputs; react-markdown shows raw HTML as text, so a notebook can't inject markup
export const Markdown = ({text}) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>
    {text}
  </ReactMarkdown>
);

export const joined = (v) => (Array.isArray(v) ? v.join('') : String(v ?? ''));
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

// --- Safe HTML outputs ---------------------------------------------------------------------------
// Notebook HTML (pandas tables, mostly) is rebuilt as React elements from an allow-list: no scripts,
// styles, event handlers or links run on this page.
const ALLOWED = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'small', 'sub', 'sup']);
function safeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const build = (node, key) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    const kids = [...node.childNodes].map((c, i) => build(c, i));
    if (!ALLOWED.has(tag)) return tag === 'style' || tag === 'script' ? null : <React.Fragment key={key}>{kids}</React.Fragment>;
    const props = {key};
    for (const a of ['colspan', 'rowspan']) if (node.getAttribute(a)) props[a === 'colspan' ? 'colSpan' : 'rowSpan'] = Number(node.getAttribute(a)) || 1;
    return React.createElement(tag, props, tag === 'br' ? undefined : kids);
  };
  return [...doc.body.childNodes].map((c, i) => build(c, i));
}

export default function Output({o}) {
  if (o.output_type === 'stream') return <pre className={`${styles.stream} ${o.name === 'stderr' ? styles.stderr : ''}`}>{joined(o.text)}</pre>;
  if (o.output_type === 'error')
    return (
      <pre className={styles.error}>
        <strong>
          {o.ename}: {o.evalue}
        </strong>
        {'\n'}
        {(o.traceback ?? []).join('\n').replace(ANSI, '')}
      </pre>
    );
  const data = o.data ?? {};
  if (data['image/png']) return <img className={styles.image} alt="Cell output" src={`data:image/png;base64,${joined(data['image/png']).replace(/\s/g, '')}`} />;
  if (data['image/jpeg']) return <img className={styles.image} alt="Cell output" src={`data:image/jpeg;base64,${joined(data['image/jpeg']).replace(/\s/g, '')}`} />;
  if (data['text/html']) return <div className={styles.html}>{safeHtml(joined(data['text/html']))}</div>;
  if (data['text/markdown']) return <div className={styles.markdownOut}><Markdown text={joined(data['text/markdown'])} /></div>;
  if (data['text/plain']) return <pre className={styles.result}>{joined(data['text/plain'])}</pre>;
  return null;
}

