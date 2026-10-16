// A small code editor for notebook cells, without an editor library: a transparent <textarea> on top of
// the same text highlighted by Prism (the site's code theme), so typing, selection, undo and the
// clipboard are the browser's own. Adds Tab / Shift+Tab indenting and auto-indent after Enter (and
// after a line ending in ":"). Both layers wrap long lines identically, so the caret stays aligned.
import React, {useEffect, useRef} from 'react';
import {Highlight} from 'prism-react-renderer';
import {usePrismTheme} from '@docusaurus/theme-common';
import styles from './styles.module.css';

const INDENT = '    ';

// Replaces the selection with text through the browser, so Ctrl+Z undoes it
function insert(ta, text, onChange) {
  ta.focus();
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    onChange(ta.value);
  }
}

function handleKey(e, onChange) {
  const ta = e.currentTarget;
  const {selectionStart: start, selectionEnd: end, value} = ta;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (e.key === 'Tab' && plain) {
    e.preventDefault();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    if (!e.shiftKey && start === end) return insert(ta, INDENT, onChange);
    // Indent or dedent every selected line
    const block = value.slice(lineStart, end);
    const lines = block.split('\n');
    const changed = e.shiftKey ? lines.map((l) => l.replace(/^ {1,4}|^\t/, '')) : lines.map((l) => INDENT + l);
    ta.setSelectionRange(lineStart, end);
    insert(ta, changed.join('\n'), onChange);
    ta.setSelectionRange(lineStart, lineStart + changed.join('\n').length);
  } else if (e.key === 'Enter' && plain && !e.shiftKey) {
    // Keep the line's indentation; one more level after a ":" (def, if, for, …)
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const line = value.slice(lineStart, start);
    const indent = line.match(/^[ \t]*/)[0] + (/:\s*$/.test(line) ? INDENT : '');
    e.preventDefault();
    insert(ta, `\n${indent}`, onChange);
  }
}

export default function CodeEditor({value, onChange, onKeyDown, onFocus, readOnly, autoFocus, language = 'python', label, placeholder}) {
  const theme = usePrismTheme();
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [autoFocus]);
  return (
    <div className={`${styles.editor} ${readOnly ? styles.editorReadOnly : ''}`}>
      <Highlight theme={theme} code={value} language={language}>
        {({tokens, getTokenProps}) => (
          <pre className={styles.edHighlight} aria-hidden="true" style={{color: theme.plain.color}}>
            {tokens.map((line, i) => (
              <React.Fragment key={i}>
                {line.map((token, k) => {
                  const {key: _k, ...props} = getTokenProps({token});
                  return <span key={k} {...props} />;
                })}
                {i < tokens.length - 1 ? '\n' : null}
              </React.Fragment>
            ))}
            {/* keeps a trailing empty line as tall as the textarea's */}
            {'​'}
          </pre>
        )}
      </Highlight>
      <textarea
        ref={ref}
        className={styles.edInput}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label={label}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && !readOnly) handleKey(e, onChange);
        }}
      />
    </div>
  );
}
