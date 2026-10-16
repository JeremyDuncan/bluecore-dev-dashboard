// The prompt library (prompts.js) as a "Prompts" menu in the question box's toolbar: the sections, and
// each section's prompts in a menu beside them (or in their place when the panel is narrow), plus a search
// across every prompt. It opens upward over the conversation, sized to the chat panel, and closes on a
// pick, a click outside or Esc.
// onPick(prompt) asks it, or puts it in the input box when it has a [placeholder] to fill in.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {PROMPT_SECTIONS} from './prompts';
import styles from './styles.module.css';

// Below this width the prompts open in place of the section list rather than beside it
const SIDE_BY_SIDE = 560;

const Blanks = ({text}) => text.split(/(\[[^\]]+\])/).map((part, j) => (j % 2 ? <mark key={j} className={styles.promptBlank}>{part}</mark> : part));

export default function PromptMenu({onPick, disabled}) {
  const notebooks = Boolean(useDocusaurusContext().siteConfig.customFields?.notebooks);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(null); // the section whose prompts are showing
  const [query, setQuery] = useState('');
  const [wide, setWide] = useState(true);
  const [size, setSize] = useState(null); // {width, maxHeight}: fits the chat panel above the question box
  const ref = useRef(null);
  const sections = useMemo(() => PROMPT_SECTIONS.filter((s) => !s.needs || (s.needs === 'notebooks' && notebooks)), [notebooks]);
  const total = sections.reduce((n, s) => n + s.prompts.length, 0);
  const q = query.trim().toLowerCase();
  const hits = q ? sections.flatMap((s) => s.prompts.filter((p) => p.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)).map((p) => ({p, s}))) : [];
  const current = sections.find((s) => s.id === section);

  useEffect(() => {
    if (!open) return undefined;
    const panel = ref.current?.closest('section');
    const bar = ref.current?.getBoundingClientRect();
    const box = panel?.getBoundingClientRect();
    if (box && bar) {
      // As wide as the question box's column (the whole panel, or the centered column in fullscreen)
      const column = ref.current.parentElement?.getBoundingClientRect().width ?? box.width;
      const width = Math.min(880, column - 24);
      setWide(width >= SIDE_BY_SIDE);
      // From the button up to just under the assistant picker, so the header and picker stay visible
      const picker = panel.querySelector('header')?.nextElementSibling?.getBoundingClientRect();
      const top = picker ? picker.bottom - box.top : 110;
      setSize({width, maxHeight: Math.max(220, Math.min(480, bar.top - box.top - top - 14))});
    }
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const pick = (p) => {
    setOpen(false);
    setQuery('');
    onPick(p);
  };
  const promptList = (list) => (
    <ul className={styles.menuPrompts} role="menu">
      {list.map(({p, s}) => (
        <li key={`${s?.id}-${p}`}>
          <button type="button" role="menuitem" className={styles.prompt} onClick={() => pick(p)} title={p.includes('[') ? 'Fill in the [bracketed] part, then ask' : 'Ask this'}>
            {s && q && <span className={styles.promptFrom}>{s.title}</span>}
            <Blanks text={p} />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={styles.promptBar} ref={ref}>
      <button
        type="button"
        className={`${styles.promptButton} ${open ? styles.promptButtonOn : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          setSection(null);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}>
        <span aria-hidden="true">✨</span> Prompts <span className={styles.promptCaret} aria-hidden="true" />
      </button>
      {open && (
        <div className={`${styles.promptMenu} ${wide && current && !q ? styles.promptMenuWide : ''}`} style={size ?? undefined}>
          <input
            type="search"
            className={styles.promptSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${total} prompts`}
            aria-label="Search prompts"
            autoFocus
          />
          {q ? (
            hits.length ? (
              <div className={styles.menuScroll}>{promptList(hits)}</div>
            ) : (
              <p className={styles.menuNone}>No prompt matches “{query.trim()}”.</p>
            )
          ) : current && !wide ? (
            // Narrow panel: the section's prompts in place of the list, with a way back
            <div className={styles.menuScroll}>
              <button type="button" className={styles.menuBack} onClick={() => setSection(null)}>
                ‹ All sections
              </button>
              <p className={styles.menuHeading}>{current.title}</p>
              {promptList(current.prompts.map((p) => ({p})))}
            </div>
          ) : (
            <div className={styles.menuColumns}>
              <ul className={`${styles.menuScroll} ${styles.menuSections}`} role="menu" aria-label="Prompt sections">
                {sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={section === s.id}
                      className={`${styles.menuSection} ${section === s.id ? styles.menuSectionOn : ''}`}
                      onClick={() => setSection(s.id)}
                      onMouseEnter={() => wide && setSection(s.id)}>
                      <span className={`${styles.promptIcon} sidebar-icon--${s.icon}`} aria-hidden="true" />
                      <span className={styles.promptTitle}>{s.title}</span>
                      <span className={styles.promptCount}>{s.prompts.length}</span>
                      <span className={styles.menuArrow} aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* Wide panel: the hovered or clicked section's prompts, beside the list */}
              {current && <div className={`${styles.menuScroll} ${styles.menuFlyout}`}>{promptList(current.prompts.map((p) => ({p})))}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
