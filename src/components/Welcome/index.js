// Cards for the Welcome page (docs/intro.mdx). Icons use the same shapes as the navbar and sidebar
// (the sidebar-icon--<name> classes in src/css/custom.css), so a section looks the same everywhere.
import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useAllDocsData} from '@docusaurus/plugin-content-docs/client';
import styles from './styles.module.css';

export function Icon({name, size = 22}) {
  return <span className={`${styles.icon} sidebar-icon--${name}`} style={{width: size, height: size}} aria-hidden="true" />;
}

// A heading for one part of the page: icon, title and a one-line explanation
export function Part({icon, title, children}) {
  return (
    <div className={styles.part}>
      <span className={styles.partIcon}>
        <Icon name={icon} size={26} />
      </span>
      <div>
        <h2 className={styles.partTitle}>{title}</h2>
        {children && <div className={styles.partText}>{children}</div>}
      </div>
    </div>
  );
}

export function Cards({children, columns = 3}) {
  return <div className={`${styles.cards} ${styles[`cols${columns}`] ?? ''}`}>{children}</div>;
}

// One card: the whole card is the link
export function Card({icon, title, to, meta, children}) {
  return (
    <Link to={to} className={styles.card}>
      <span className={styles.cardHead}>
        <Icon name={icon} />
        <strong>{title}</strong>
      </span>
      <div className={styles.cardText}>{children}</div>
      {meta && <span className={styles.cardMeta}>{meta}</span>}
    </Link>
  );
}

// The "start here" panel: a highlighted box with a list of links
export function Featured({icon, title, to, children}) {
  return (
    <div className={styles.featured}>
      <Link to={to} className={styles.featuredTitle}>
        <Icon name={icon} size={26} />
        {title}
      </Link>
      <div className={styles.featuredBody}>{children}</div>
    </div>
  );
}

// Only when the site runs locally: `needs="live"` (Notes and live data, from the MCP container),
// `needs="chat"` (Ask the docs) or `needs="notebooks"` (Jupyter Notebooks, JUPYTER_NOTEBOOK=true). The
// public build sets the URLs empty, so these never show there. `off`: instead, only on a local site where
// that feature is off (e.g. how to turn notebooks on).
export function LocalOnly({needs = 'live', off = false, children}) {
  const {siteConfig} = useDocusaurusContext();
  const f = siteConfig.customFields ?? {};
  const on = needs === 'chat' ? f.chatApiUrl : needs === 'notebooks' ? f.notebooks : f.liveApiUrl;
  if (off) return f.liveApiUrl && !on ? children : null;
  return on ? children : null;
}

const allDocs = (data) => Object.values(data).flatMap((plugin) => plugin.versions.flatMap((v) => v.docs));

// Only when a docs section exists (a folder under docs/, e.g. "google-drive", or one page such as
// "project-status/blue-core-mvp-board"). Local-only sections (Drive, Box, Figma notes, the private
// board) are missing on the public site and on machines without the source files.
export function IfDocs({section, children}) {
  const docs = allDocs(useAllDocsData());
  return docs.some((d) => d.id === section || d.id.startsWith(`${section}/`)) ? children : null;
}

// A card linking to a section that has no landing page of its own: it opens the section's top page
// (its index, or the page nearest the top of the folder). Nothing when the section doesn't exist.
export function SectionCard({section, ...card}) {
  const docs = allDocs(useAllDocsData()).filter((d) => d.id === section || d.id.startsWith(`${section}/`));
  if (!docs.length) return null;
  const depth = (d) => d.id.split('/').length - (/(^|\/)index$/.test(d.id) ? 1 : 0);
  const top = [...docs].sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id))[0];
  return <Card {...card} to={top.path} />;
}

// A card that opens the "Ask the docs" chat box (src/components/AskDocs) instead of a page
export function ChatCard({icon, title, meta, children}) {
  return (
    <button type="button" className={`${styles.card} ${styles.cardButton}`} onClick={() => window.dispatchEvent(new Event('ask-docs:open'))}>
      <span className={styles.cardHead}>
        <Icon name={icon} />
        <strong>{title}</strong>
      </span>
      <div className={styles.cardText}>{children}</div>
      {meta && <span className={styles.cardMeta}>{meta}</span>}
    </button>
  );
}
