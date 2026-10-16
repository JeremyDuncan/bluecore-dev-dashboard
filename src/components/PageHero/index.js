// The header of the site's main pages, as on the Notes page: a soft panel with a large, light title, a
// short lead, buttons, and optionally a row of numbers under it. Used by the Welcome, Guides, MCP tools,
// Project Status, Notes and Notebooks pages. In a doc page, set `hide_title: true` in its front matter
// and pass the title here instead.
//
//   <PageHero title="Guides" lead="…" actions={[{label: 'New', to: '/x', icon: <PlusIcon />, primary: true}]}
//             stats={[{icon: <NoteIcon />, value: 12, label: 'notes', to: '/notes?view=tags'}]} />
//
// An action takes `to` (a page), `href` (another site), or `event` (a window event, e.g. 'ask-docs:open');
// `needs: 'chat' | 'live' | 'notebooks'` shows it only where that local feature exists (as LocalOnly).
import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './styles.module.css';

function Action({label, to, href, event, icon, primary, needs}) {
  const f = useDocusaurusContext().siteConfig.customFields ?? {};
  if (needs && !{chat: f.chatApiUrl, live: f.liveApiUrl, notebooks: f.notebooks}[needs]) return null;
  const className = `button ${primary ? 'button--primary' : 'button--secondary'} ${styles.action}`;
  const body = (
    <>
      {icon}
      {label}
    </>
  );
  if (event)
    return (
      <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(event))}>
        {body}
      </button>
    );
  return (
    <Link className={className} {...(href ? {href} : {to})}>
      {body}
    </Link>
  );
}

export function Stat({icon, value, label, to, tone}) {
  const body = (
    <>
      <span className={`${styles.statIcon} ${tone === 'bad' ? styles.statIconBad : ''}`}>{icon}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className={`${styles.stat} ${styles.statLink}`}>
      {body}
    </Link>
  ) : (
    <div className={styles.stat}>{body}</div>
  );
}

export default function PageHero({title, eyebrow, lead, actions = [], stats = [], children}) {
  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1 className={styles.title}>{title}</h1>
        {lead && <p className={styles.lead}>{lead}</p>}
        {children}
        {actions.filter(Boolean).length > 0 && (
          <div className={styles.actions}>
            {actions.filter(Boolean).map((a) => (
              <Action key={a.label} {...a} />
            ))}
          </div>
        )}
      </header>
      {stats.length > 0 && (
        <div className={styles.stats}>
          {stats.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
      )}
    </div>
  );
}
