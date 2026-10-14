// Cards for the Welcome page (docs/intro.mdx). Icons use the same shapes as the navbar and sidebar
// (the sidebar-icon--<name> classes in src/css/custom.css), so a section looks the same everywhere.
import React from 'react';
import Link from '@docusaurus/Link';
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
