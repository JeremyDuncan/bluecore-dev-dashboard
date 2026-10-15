// Formatting toolbar for the note editor's textarea: headings, bold, italic, links, [[note links]],
// lists, tasks, quotes, callouts, tables and more. Edits go through the browser's insertText command,
// so ⌘Z / Ctrl+Z undoes them like typing. Also: ⌘B / ⌘I / ⌘K shortcuts, Enter continuing lists,
// and typing [[ to pick a note to link.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useNotesApi} from './api';
import {
  BoldIcon,
  BookIcon,
  CalloutIcon,
  CodeBlockIcon,
  CodeIcon,
  FolderIcon,
  HeadingIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  NoteIcon,
  NoteLinkIcon,
  OrderedListIcon,
  PlusIcon,
  QuoteIcon,
  RuleIcon,
  StrikeIcon,
  TableIcon,
  TagIcon,
  TaskIcon,
} from './icons';
import styles from './styles.module.css';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';

// --- Editing the textarea ------------------------------------------------------------------------

// Inserts text at the cursor (replacing any selection), undoable like typing
export function insertAtCursor(ta, text) {
  replace(ta, ta.selectionStart, ta.selectionEnd, text);
}

// Replaces [start, end) with text (undoable), then selects [selStart, selEnd) (relative to start)
function replace(ta, start, end, text, selStart = text.length, selEnd = selStart) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // insertText keeps the browser's undo history; it's deprecated but still the only way to do that
  const ok = document.execCommand?.('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', {bubbles: true}));
  }
  ta.setSelectionRange(start + selStart, start + selEnd);
}

// **bold**, *italic*, `code`, …: wraps the selection (or a placeholder), or unwraps it if already wrapped
function wrap(ta, before, after = before, placeholder = 'text') {
  const {selectionStart: s, selectionEnd: e, value} = ta;
  const selected = value.slice(s, e);
  if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    return replace(ta, s - before.length, e + after.length, selected, 0, selected.length);
  }
  const inner = selected || placeholder;
  replace(ta, s, e, `${before}${inner}${after}`, before.length, before.length + inner.length);
}

// The whole lines the selection touches
function lineRange(ta) {
  const {selectionStart: s, selectionEnd: e, value} = ta;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  let end = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
  if (end < 0) end = value.length;
  return {start, end, lines: value.slice(start, end).split('\n')};
}

// Adds a prefix to each selected line ("- ", "> ", "1. "…), or removes it if every line has it.
// `prefix(i)` gives line i's prefix; `match` recognizes an existing one.
function prefixLines(ta, prefix, match) {
  const {start, end, lines} = lineRange(ta);
  const filled = lines.filter((l) => l.trim());
  const all = filled.length > 0 && filled.every((l) => match.test(l));
  const out = lines.map((l, i) => (all ? l.replace(match, '') : l.trim() || lines.length === 1 ? prefix(i) + l.replace(LIST_MARK, '') : l));
  const text = out.join('\n');
  replace(ta, start, end, text, text.length);
}

const LIST_MARK = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

// # Heading: sets the level of the current line (the same level again removes it)
function heading(ta, level) {
  const {start, end, lines} = lineRange(ta);
  const line = lines[0];
  const current = line.match(/^(#{1,6})\s+/);
  const text = current?.[1].length === level ? line.slice(current[0].length) : `${'#'.repeat(level)} ${current ? line.slice(current[0].length) : line}`;
  replace(ta, start, start + line.length, text, text.length);
  if (end > start + line.length) ta.setSelectionRange(start + text.length, start + text.length);
}

// A block on its own lines, with a blank line before and after
function block(ta, text, select = [0, 0]) {
  const {selectionStart: s, selectionEnd: e, value} = ta;
  const before = s === 0 || value.slice(0, s).endsWith('\n\n') ? '' : value.slice(0, s).endsWith('\n') ? '\n' : '\n\n';
  const after = value.slice(e).startsWith('\n\n') || e === value.length ? '\n' : value.slice(e).startsWith('\n') ? '\n' : '\n\n';
  replace(ta, s, e, `${before}${text}${after}`, before.length + select[0], before.length + select[1]);
}

// Enter in a list or quote continues it; Enter on an empty item ends the list
function continueList(ta) {
  const {selectionStart: s, selectionEnd: e, value} = ta;
  if (s !== e) return false;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const line = value.slice(lineStart, s);
  const m = line.match(LIST_MARK);
  if (!m) return false;
  if (line.trim() === m[0].trim()) {
    replace(ta, lineStart, s, ''); // empty item: end the list
    return true;
  }
  let mark = m[2];
  const num = mark.match(/^(\d+)([.)]) $/);
  if (num) mark = `${Number(num[1]) + 1}${num[2]} `;
  if (/\[[xX]\]/.test(mark)) mark = mark.replace(/\[[xX]\]/, '[ ]');
  replace(ta, s, s, `\n${m[1]}${mark}`);
  return true;
}

// --- [[Note link]] picker ------------------------------------------------------------------------

// Choosing a note inserts [[Title]] ([[folder/Title]] when two notes share the title). With text
// selected, that text becomes the link's label: [[Title|text]]. No match: a link to a new note.
function NoteLinkPicker({notes, onPick, onClose}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return notes
      .filter((n) => words.every((w) => `${n.title} ${n.folder}`.toLowerCase().includes(w)))
      .sort((a, b) => (b.title.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 0) - (a.title.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 0) || b.updated.localeCompare(a.updated))
      .slice(0, 8);
  }, [notes, q]);
  const exact = matches.some((n) => n.title.toLowerCase() === q.trim().toLowerCase());
  const options = [...matches.map((n) => ({note: n})), ...(q.trim() && !exact ? [{create: q.trim()}] : [])];
  useEffect(() => {
    setActive(0);
  }, [q]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const choose = (opt) => {
    if (!opt) return;
    if (opt.create) return onPick(opt.create);
    const {note} = opt;
    const twins = notes.filter((n) => n.title.toLowerCase() === note.title.toLowerCase()).length > 1;
    onPick(twins ? note.path.replace(/\.md$/i, '') : note.title);
  };
  return (
    <div className={styles.picker} role="dialog" aria-label="Link to a note">
      <input
        className={styles.pickerInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(options.length, 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={(e) => !e.currentTarget.parentElement.contains(e.relatedTarget) && onClose()}
        placeholder="Link to a note…"
        aria-label="Find a note to link"
        role="combobox"
        aria-expanded="true"
        aria-controls="note-link-options"
        aria-activedescendant={options.length ? `note-link-${active}` : undefined}
        autoFocus
      />
      <ul ref={listRef} id="note-link-options" className={styles.pickerList} role="listbox">
        {options.map((opt, i) => (
          <li
            key={opt.note?.path ?? 'create'}
            id={`note-link-${i}`}
            role="option"
            aria-selected={i === active}
            className={`${styles.pickerOption} ${i === active ? styles.pickerActive : ''}`}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus until the pick is done
              choose(opt);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {opt.create ? (
              <>
                <PlusIcon size={14} />
                <span>
                  Link to a new note “<strong>{opt.create}</strong>”
                </span>
              </>
            ) : (
              <>
                <NoteIcon size={14} />
                <span className={styles.pickerTitle}>{opt.note.title}</span>
                {opt.note.folder && (
                  <span className={styles.pickerFolder}>
                    <FolderIcon size={11} /> {opt.note.folder}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
        {!options.length && <li className={styles.pickerEmpty}>Type a note's title</li>}
      </ul>
    </div>
  );
}

// --- Docs page link picker -----------------------------------------------------------------------

// Searches the docs (the MCP server's index) and inserts [Page title](/path/to/page)
function DocsLinkPicker({onPick, onClose}) {
  const {call} = useNotesApi();
  const [q, setQ] = useState('');
  const [pages, setPages] = useState([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!q.trim()) {
      setPages([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      call(`/docs-search?q=${encodeURIComponent(q)}`).then(
        (d) => !cancelled && (setPages(d.pages), setActive(0)),
        () => !cancelled && setPages([]),
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, call]);
  const choose = (p) => p && onPick(p);
  return (
    <div className={styles.picker} role="dialog" aria-label="Link to a docs page">
      <input
        className={styles.pickerInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + pages.length) % Math.max(pages.length, 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(pages[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={(e) => !e.currentTarget.parentElement.contains(e.relatedTarget) && onClose()}
        placeholder="Search the docs…"
        aria-label="Find a docs page to link"
        autoFocus
      />
      <ul className={styles.pickerList} role="listbox">
        {pages.map((p, i) => (
          <li
            key={p.path}
            role="option"
            aria-selected={i === active}
            className={`${styles.pickerOption} ${i === active ? styles.pickerActive : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(p);
            }}
            onMouseEnter={() => setActive(i)}
          >
            <BookIcon size={14} />
            <span className={styles.pickerTitle}>
              {p.title}
              {p.section && <span className={styles.pickerFolder}> › {p.section}</span>}
            </span>
          </li>
        ))}
        {!pages.length && <li className={styles.pickerEmpty}>{q.trim() ? 'No pages found' : 'Type to search the docs'}</li>}
      </ul>
    </div>
  );
}

// --- Toolbar -------------------------------------------------------------------------------------

export default function MarkdownToolbar({textareaRef, notes, onPickImage}) {
  const [picker, setPicker] = useState(null); // {start, end, selected, kind: 'note' | 'docs'}: where the link goes
  const ta = () => textareaRef.current;

  const openPicker = ({trigger = false} = {}) => {
    const t = ta();
    if (!t) return;
    const {selectionStart: s, selectionEnd: e, value} = t;
    // Typed "[[": the link replaces those two characters
    setPicker({kind: 'note', start: trigger ? s - 2 : s, end: e, selected: trigger ? '' : value.slice(s, e)});
  };
  const openDocsPicker = () => {
    const t = ta();
    if (!t) return;
    setPicker({kind: 'docs', start: t.selectionStart, end: t.selectionEnd, selected: t.value.slice(t.selectionStart, t.selectionEnd)});
  };
  // [Page title](/path): the link shows on the note, and the note shows on that docs page
  const insertDocsLink = (page) => {
    const {start, end, selected} = picker;
    setPicker(null);
    const label = selected.trim() || (page.section ? `${page.title} › ${page.section}` : page.title);
    replace(ta(), start, end, `[${label.replace(/[[\]]/g, '')}](${page.path.replace(/ /g, '%20')})`);
  };
  const insertLink = (target) => {
    const t = ta();
    const {start, end, selected} = picker;
    setPicker(null);
    const label = selected.trim() && selected.trim() !== target ? `|${selected.trim()}` : '';
    const text = `[[${target}${label}]]`;
    replace(t, start, end, text);
  };
  const closePicker = () => {
    setPicker(null);
    ta()?.focus();
  };

  const tools = [
    {label: 'Heading 1', icon: <HeadingIcon />, badge: '1', run: (t) => heading(t, 1)},
    {label: 'Heading 2', icon: <HeadingIcon />, badge: '2', run: (t) => heading(t, 2)},
    {label: 'Heading 3', icon: <HeadingIcon />, badge: '3', run: (t) => heading(t, 3)},
    'sep',
    {label: 'Bold', keys: `${MOD}B`, icon: <BoldIcon />, run: (t) => wrap(t, '**', '**', 'bold text')},
    {label: 'Italic', keys: `${MOD}I`, icon: <ItalicIcon />, run: (t) => wrap(t, '*', '*', 'italic text')},
    {label: 'Strikethrough', icon: <StrikeIcon />, run: (t) => wrap(t, '~~', '~~', 'struck text')},
    {label: 'Highlight', icon: <span className={styles.highlightGlyph}>H</span>, run: (t) => wrap(t, '==', '==', 'highlighted')},
    {label: 'Inline code', icon: <CodeIcon />, run: (t) => wrap(t, '`', '`', 'code')},
    'sep',
    {label: 'Link to a note', keys: '[[', icon: <NoteLinkIcon />, run: () => openPicker()},
    {
      label: 'Web link',
      keys: `${MOD}K`,
      icon: <LinkIcon />,
      run: (t) => {
        const {selectionStart: s, selectionEnd: e, value} = t;
        const text = value.slice(s, e) || 'link text';
        replace(t, s, e, `[${text}](https://)`, text.length + 3, text.length + 11); // selects "https://"
      },
    },
    {label: 'Link to a docs page', icon: <BookIcon />, run: () => openDocsPicker()},
    {
      label: 'Add an image (or paste / drop one)',
      icon: <ImageIcon />,
      run: () => onPickImage?.(),
    },
    {
      label: 'Tag',
      icon: <TagIcon />,
      run: (t) => {
        const {selectionStart: s, selectionEnd: e, value} = t;
        const word = value.slice(s, e).trim().replace(/\s+/g, '-') || 'tag';
        const space = s > 0 && !/\s/.test(value[s - 1]) ? ' ' : '';
        replace(t, s, e, `${space}#${word}`, space.length + 1, space.length + 1 + word.length);
      },
    },
    'sep',
    {label: 'Bulleted list', icon: <ListIcon />, run: (t) => prefixLines(t, () => '- ', /^(\s*)[-*+] (?!\[)/)},
    {label: 'Numbered list', icon: <OrderedListIcon />, run: (t) => prefixLines(t, (i) => `${i + 1}. `, /^(\s*)\d+[.)] /)},
    {label: 'Task list', icon: <TaskIcon />, run: (t) => prefixLines(t, () => '- [ ] ', /^(\s*)[-*+] \[[ xX]\] /)},
    {label: 'Quote', icon: <QuoteIcon />, run: (t) => prefixLines(t, () => '> ', /^(\s*)> /)},
    'sep',
    {
      label: 'Callout',
      icon: <CalloutIcon />,
      run: (t) => {
        const text = t.value.slice(t.selectionStart, t.selectionEnd);
        const body = (text || 'Text').split('\n').map((l) => `> ${l}`).join('\n');
        block(t, `> [!note] Title\n${body}`, [10, 15]); // selects "Title"
      },
    },
    {
      label: 'Code block',
      icon: <CodeBlockIcon />,
      run: (t) => {
        const text = t.value.slice(t.selectionStart, t.selectionEnd);
        block(t, `\`\`\`bash\n${text || 'code'}\n\`\`\``, [3, 7]); // selects the language
      },
    },
    {
      label: 'Table',
      icon: <TableIcon />,
      run: (t) => block(t, '| Column | Column |\n| --- | --- |\n| Cell | Cell |', [2, 8]),
    },
    {label: 'Divider', icon: <RuleIcon />, run: (t) => block(t, '---', [3, 3])},
  ];

  // Shortcuts and list continuation, on the textarea itself
  useEffect(() => {
    const t = ta();
    if (!t) return undefined;
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        tools.find((x) => x.keys === `${MOD}${e.key.toUpperCase()}`)?.run(t);
      } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.isComposing && continueList(t)) {
        e.preventDefault();
      }
    };
    const onInput = () => {
      if (t.value.slice(t.selectionStart - 2, t.selectionStart) === '[[' && t.selectionStart === t.selectionEnd) openPicker({trigger: true});
    };
    t.addEventListener('keydown', onKey);
    t.addEventListener('input', onInput);
    return () => {
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('input', onInput);
    };
  });

  return (
    <div className={styles.mdToolbarWrap}>
      <div className={styles.mdToolbar} role="toolbar" aria-label="Formatting">
        {tools.map((tool, i) =>
          tool === 'sep' ? (
            <span key={`sep${i}`} className={styles.mdSep} aria-hidden="true" />
          ) : (
            <button
              key={tool.label}
              type="button"
              className={styles.mdButton}
              title={tool.keys ? `${tool.label} (${tool.keys})` : tool.label}
              aria-label={tool.label}
              onMouseDown={(e) => e.preventDefault()} // keep the textarea's selection
              onClick={() => ta() && tool.run(ta())}
            >
              {tool.icon}
              {tool.badge && <span className={styles.mdBadge}>{tool.badge}</span>}
            </button>
          ),
        )}
      </div>
      {picker?.kind === 'note' && <NoteLinkPicker notes={notes} onPick={insertLink} onClose={closePicker} />}
      {picker?.kind === 'docs' && <DocsLinkPicker onPick={insertDocsLink} onClose={closePicker} />}
    </div>
  );
}
