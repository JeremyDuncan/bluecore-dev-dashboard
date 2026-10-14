// Icon navigation between the Project Status pages (replaces the sidebar dropdown), and the
// overview cards on /project-status. `pages` comes from _data/nav.json, written by the sync
// (scripts/sync/project-status.mjs), so it only lists the pages this build has: the public
// site has no project board.
import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

const PATHS = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4" width="4.5" height="15" rx="1" />
      <rect x="9.75" y="4" width="4.5" height="9" rx="1" />
      <rect x="16" y="4" width="4.5" height="12" rx="1" />
    </>
  ),
  issues: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </>
  ),
  tests: (
    <>
      <path d="M9 3.5h6M10 3.5v6.2L4.8 18.4A1.5 1.5 0 0 0 6.1 20.5h11.8a1.5 1.5 0 0 0 1.3-2.1L14 9.7V3.5" />
      <path d="M7.4 14.5h9.2" />
    </>
  ),
  releases: (
    <>
      <path d="M20.3 13.3l-7 7a1.6 1.6 0 0 1-2.3 0L3.5 12.8V3.5h9.3l7.5 7.5a1.6 1.6 0 0 1 0 2.3z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </>
  ),
};

export function StatusIcon({name, size = 22}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.overview}
    </svg>
  );
}

// Row of icon links at the top of each Project Status page. Each link has a tooltip (on hover and
// keyboard focus) that says what the page shows, linked with aria-describedby for screen readers.
export default function StatusNav({pages, current}) {
  return (
    <nav className={styles.statusNav} aria-label="Project Status pages">
      <ul>
        {pages.map((p) => {
          const tipId = `status-tip-${p.id}`;
          const active = p.id === current;
          return (
            <li key={p.id} className={styles.statusNavItem}>
              <Link
                to={p.href}
                className={`${styles.statusNavLink} ${active ? styles.statusNavActive : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-describedby={tipId}
              >
                <StatusIcon name={p.icon} />
                <span className={styles.statusNavLabel}>{p.label}</span>
              </Link>
              <span role="tooltip" id={tipId} className={styles.statusTip}>
                <strong>{p.title}</strong>
                {p.description}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Cards on the /project-status overview page: one per page, with the same icon and description.
export function StatusOverview({pages}) {
  return (
    <ul className={styles.statusCards}>
      {pages
        .filter((p) => p.id !== 'overview')
        .map((p) => (
          <li key={p.id}>
            <Link to={p.href} className={styles.statusCard}>
              <span className={styles.statusCardIcon}>
                <StatusIcon name={p.icon} size={28} />
              </span>
              <span>
                <strong className={styles.statusCardTitle}>{p.title}</strong>
                <span className={styles.statusCardText}>{p.description}</span>
              </span>
            </Link>
          </li>
        ))}
    </ul>
  );
}
