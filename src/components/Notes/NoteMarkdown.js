// Renders a note's Markdown, including the Obsidian syntax people use most:
//   [[Note]], [[Note|text]], [[Note#Heading]]  links to other notes (a missing note → "create it")
//   ![[image.png]], ![[image.png|300]]         images from the vault (served by the notes API)
//   #tag                                       tag links (filter the list)
//   > [!note] Title                            callouts
//   %%comment%%                                hidden, as in Obsidian's reading view
//   ==highlight==                              highlighted (<mark>)
// Raw HTML in a note is shown as text, never run (react-markdown's default), so a note can't
// inject scripts into the site.
import React, {createContext, useContext} from 'react';
import Link from '@docusaurus/Link';
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {TagIcon} from './icons';
import styles from './styles.module.css';

const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|pdf)$/i;
const escapeText = (s) => s.replace(/([[\]\\])/g, '\\$1');

// Applies `fn` to the parts of the text that aren't code (fenced blocks and inline code)
function outsideCode(text, fn) {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((block, i) => (i % 2 ? block : block.split(/(`+[^`\n]*?`+)/).map((part, j) => (j % 2 ? part : fn(part))).join('')))
    .join('');
}

function obsidianToMarkdown(text) {
  return outsideCode(text, (s) =>
    s
      // Keeps the line breaks, so line numbers still match the note (task checkboxes rely on it)
      .replace(/%%[\s\S]*?%%/g, (comment) => comment.replace(/[^\n]/g, ''))
      .replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, target, size) =>
        ATTACHMENT.test(target.trim())
          ? `![${escapeText(target.trim())}](notefile:${encodeURIComponent(target.trim())}${size && /^\d+/.test(size) ? ` "w=${parseInt(size, 10)}"` : ''})`
          : `[↪ ${escapeText(target.trim())}](note:${encodeURIComponent(target.trim().split('#')[0])})`,
      )
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => {
        const [name, heading] = target.trim().split('#');
        const label = alias?.trim() || (name ? target.trim().replace('#', ' › ') : heading);
        return `[${escapeText(label)}](note:${encodeURIComponent(name || '')})`;
      })
      // A tag needs a letter, _ or - and no / at either end (as on the server: "#339/#340" isn't one)
      .replace(/(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu, (whole, before, tag) =>
        /[\p{L}_-]/u.test(tag) && !/^\/|\/$/.test(tag) ? `${before}[#${tag}](tag:${encodeURIComponent(tag)})` : whole,
      ),
  );
}

// > [!type] Title  →  <aside class="callout callout-type"> with a title line
function remarkCallouts() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'blockquote') {
        const first = node.children?.[0];
        const text = first?.type === 'paragraph' && first.children?.[0]?.type === 'text' ? first.children[0] : null;
        const m = text?.value.match(/^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)\n?/);
        if (m) {
          const type = m[1].toLowerCase();
          text.value = text.value.slice(m[0].length);
          if (!text.value) first.children.shift();
          if (!first.children.length) node.children.shift();
          node.data = {hName: 'aside', hProperties: {className: ['callout', `callout-${type}`]}};
          node.children.unshift({
            type: 'paragraph',
            data: {hProperties: {className: ['callout-title']}},
            children: [{type: 'text', value: m[2].trim() || type[0].toUpperCase() + type.slice(1)}],
          });
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

// ==text== → <mark>text</mark> (text nodes only, so never inside code)
function remarkHighlights() {
  return (tree) => {
    const visit = (node) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value.includes('==')) {
          visit(child);
          return [child];
        }
        const parts = child.value.split(/==([^=\n](?:[^\n]*?[^=\n])?)==/);
        return parts
          .map((value, i) => (i % 2 ? {type: 'emphasis', data: {hName: 'mark'}, children: [{type: 'text', value}]} : value && {type: 'text', value}))
          .filter(Boolean);
      });
    };
    visit(tree);
  };
}

const urlTransform = (url) => (/^(note|tag|notefile):/.test(url) ? url : defaultUrlTransform(url));

// resolve(name) → note path or null; noteHref(path), tagHref(tag), newHref(title), fileUrl(name): links
// Plain text of rendered children (for heading ids)
const textOf = (children) =>
  React.Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? c : textOf(c?.props?.children)))
    .join('');

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

// The line of the task list item being rendered, for its checkbox
const TaskLine = createContext(null);

function Heading({level, node, children}) {
  const Tag = `h${level}`;
  // The line number keeps ids unique when two headings share a text
  return <Tag id={`${slug(textOf(children)) || 'section'}-${node?.position?.start.line ?? 0}`}>{children}</Tag>;
}

// onToggleTask(line, checked): makes "- [ ]" checkboxes clickable; `line` counts from 1 in `body`
export default function NoteMarkdown({body, resolve, noteHref, tagHref, newHref, fileUrl, onToggleTask}) {
  const components = {
    table({children}) {
      return <div className={styles.tableWrap}><table>{children}</table></div>;
    },
    h1: (p) => <Heading level={1} {...p} />,
    h2: (p) => <Heading level={2} {...p} />,
    h3: (p) => <Heading level={3} {...p} />,
    h4: (p) => <Heading level={4} {...p} />,
    li({node, className, children}) {
      if (!String(className ?? '').includes('task-list-item')) return <li className={className}>{children}</li>;
      return (
        <li className={className}>
          <TaskLine.Provider value={node?.position?.start.line ?? null}>{children}</TaskLine.Provider>
        </li>
      );
    },
    input: function TaskBox({type, checked, ...rest}) {
      const line = useContext(TaskLine);
      if (type !== 'checkbox') return <input type={type} checked={checked} {...rest} />;
      if (!onToggleTask || line == null) return <input type="checkbox" checked={Boolean(checked)} disabled readOnly />;
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(e) => onToggleTask(line, e.target.checked)}
          aria-label={checked ? 'Mark as not done' : 'Mark as done'}
          className={styles.taskBox}
        />
      );
    },
    a({href = '', children}) {
      if (href.startsWith('note:')) {
        const name = decodeURIComponent(href.slice(5));
        const target = resolve(name);
        return target ? (
          <Link to={noteHref(target)} className={styles.wikiLink}>
            {children}
          </Link>
        ) : (
          <Link to={newHref(name)} className={`${styles.wikiLink} ${styles.wikiLinkMissing}`} title={`No note "${name}" yet: create it`}>
            {children}
          </Link>
        );
      }
      if (href.startsWith('tag:')) {
        const tag = decodeURIComponent(href.slice(4));
        return (
          <Link to={tagHref(tag)} className={styles.tag} aria-label={`Tag ${tag}`}>
            <TagIcon size={12} />
            {tag}
          </Link>
        );
      }
      // A link to a docs page on this site: stays in the app
      if (/^\/(?!\/)/.test(href)) return <Link to={href}>{children}</Link>;
      return <a href={href}>{children}</a>;
    },
    img({src = '', alt, title}) {
      const local = src.startsWith('notefile:') ? decodeURIComponent(src.slice(9)) : !/^[a-z]+:|^\/\//i.test(src) ? decodeURIComponent(src) : null;
      const url = local != null ? fileUrl(local) : src;
      const width = title?.startsWith('w=') ? Number(title.slice(2)) : undefined;
      if (local && /\.pdf$/i.test(local)) return <a href={url}>📄 {alt || local}</a>;
      return <img src={url} alt={alt ?? ''} width={width} title={width ? undefined : title} loading="lazy" />;
    },
  };
  return (
    <div className={`markdown ${styles.noteBody}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCallouts, remarkHighlights]} urlTransform={urlTransform} components={components}>
        {obsidianToMarkdown(body)}
      </ReactMarkdown>
    </div>
  );
}
