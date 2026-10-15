// The note's headings beside it on wide screens (like a docs page's table of contents), with the
// section you're reading highlighted. Shown when the note has at least three headings.
import React, {useEffect, useState} from 'react';
import {TextIcon} from './icons';
import styles from './styles.module.css';

// Headings rendered in `container` (NoteMarkdown gives them ids)
export function useOutline(containerRef, deps) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    setItems([...root.querySelectorAll('h1[id], h2[id], h3[id], h4[id]')].map((h) => ({id: h.id, text: h.textContent, level: Number(h.tagName[1])})));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}

export default function Outline({items, containerRef}) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !items.length) return undefined;
    // The last heading above the top quarter of the window is the current section
    const onScroll = () => {
      let current = items[0].id;
      for (const {id} of items) {
        const el = root.querySelector(`#${CSS.escape(id)}`);
        if (el && el.getBoundingClientRect().top < window.innerHeight / 4) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  }, [items, containerRef]);

  if (items.length < 3) return null;
  const top = Math.min(...items.map((i) => i.level));
  return (
    <nav className={styles.outline} aria-label="On this note">
      <p className={styles.outlineTitle}>
        <TextIcon size={13} /> On this note
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.id} style={{'--indent': item.level - top}}>
            <a
              href={`#${item.id}`}
              className={item.id === active ? styles.outlineActive : undefined}
              onClick={(e) => {
                e.preventDefault(); // scroll without changing the URL's ?note=… part
                containerRef.current?.querySelector(`#${CSS.escape(item.id)}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
                setActive(item.id);
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
