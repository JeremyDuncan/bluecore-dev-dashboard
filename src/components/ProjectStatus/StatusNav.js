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
  pulls: (
    <>
      <circle cx="6" cy="5.5" r="2.2" />
      <circle cx="6" cy="18.5" r="2.2" />
      <circle cx="18" cy="18.5" r="2.2" />
      <path d="M6 7.7v8.6M18 16.3V9.5a3 3 0 0 0-3-3h-4" />
      <path d="M13 4.2l-2.3 2.3 2.3 2.3" />
    </>
  ),
  drift: (
    <>
      <path d="M4 8h13M14 4.5L17.5 8 14 11.5" />
      <path d="M20 16H9M12 12.5L8.5 16l3.5 3.5" />
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

const RESULT = {success: 'passed', failure: 'failed'};

// One link with its tooltip (shown on hover and keyboard focus, linked with aria-describedby)
function NavLink({page: p, active, sub}) {
  const tipId = `status-tip-${p.id}`;
  return (
    <li className={styles.statusNavItem}>
      <Link
        to={p.href}
        className={`${styles.statusNavLink} ${sub ? styles.statusSubLink : ''} ${active ? styles.statusNavActive : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-describedby={tipId}
      >
        {sub ? (
          <span className={`${styles.resultDot} ${styles[`result_${p.status}`] ?? ''}`} aria-hidden="true" />
        ) : (
          <StatusIcon name={p.icon} />
        )}
        <span className={sub ? undefined : styles.statusNavLabel}>{p.label}</span>
        {sub && RESULT[p.status] && <span className={styles.srOnly}> (latest run {RESULT[p.status]})</span>}
      </Link>
      <span role="tooltip" id={tipId} className={styles.statusTip}>
        <strong>{p.title}</strong>
        {p.description}
      </span>
    </li>
  );
}

// Row of icon links at the top of each Project Status page. Pages with a `group` (each test suite,
// group "tests") get a second row, shown on the group's page and on every page in the group.
export default function StatusNav({pages, current}) {
  const page = pages.find((p) => p.id === current);
  const group = page?.group ?? (pages.some((p) => p.group === current) ? current : null);
  const members = group ? pages.filter((p) => p.group === group) : [];
  return (
    <nav className={styles.statusNav} aria-label="Project Status pages">
      <p className={styles.statusNavIntro}>Live GitHub activity for the Blue Core repositories (a dashboard, not documentation).</p>
      <ul>
        {pages
          .filter((p) => !p.group)
          .map((p) => (
            <NavLink key={p.id} page={p} active={p.id === current || p.id === group} />
          ))}
      </ul>
      {members.length > 0 && (
        <ul className={styles.statusSubNav} aria-label={`${pages.find((p) => p.id === group)?.title ?? 'Section'} pages`}>
          {members.map((p) => (
            <NavLink key={p.id} page={p} active={p.id === current} sub />
          ))}
        </ul>
      )}
    </nav>
  );
}

// Cards on the /project-status overview page: one per page, with the same icon and description.
export function StatusOverview({pages}) {
  return (
    <ul className={styles.statusCards}>
      {pages
        .filter((p) => p.id !== 'overview' && !p.group)
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
