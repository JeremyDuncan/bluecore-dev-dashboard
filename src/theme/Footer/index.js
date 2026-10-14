// Blue Core site footer (Figma: Styles and Components → Footer, Display=Desktop/Mobile).
// Links and copyright come from themeConfig.footer; the contact email from customFields.
import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useThemeConfig} from '@docusaurus/theme-common';
import styles from './styles.module.css';

export default function Footer() {
  const {footer} = useThemeConfig();
  const {siteConfig} = useDocusaurusContext();
  const email = siteConfig.customFields?.contactEmail;
  const icon = useBaseUrl('/img/blue-core-icon.svg');
  const iconDark = useBaseUrl('/img/blue-core-icon-dark.svg');
  if (!footer) return null;

  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <div className={styles.linksAndText}>
          <nav className={styles.quicklinks} aria-label="Footer">
            {(footer.links ?? []).map((link) => (
              <Link key={link.label} className={styles.quicklink} to={link.to} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <p className={styles.meta}>
            {footer.copyright}
            {email && (
              <>
                <span className={styles.separator} aria-hidden="true">•</span>
                <a href={`mailto:${email}`}>{email}</a>
              </>
            )}
          </p>
        </div>
        <Link to="/" className={styles.icon} aria-label="Blue Core docs home">
          <img src={icon} alt="" width="47" height="50" className={styles.iconLight} />
          <img src={iconDark} alt="" width="47" height="50" className={styles.iconDark} />
        </Link>
      </div>
    </footer>
  );
}
