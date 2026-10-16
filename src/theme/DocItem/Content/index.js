// Adds a notice at the top of pages whose source hasn't changed in over a year, so stale
// docs stand out. The date comes from last_update (set by the sync) or the file's history.
//
// Guides (docs under HERO_SECTIONS) get the site's page header (PageHero) in place of the plain title:
// the section and sidebar path as its eyebrow, front matter `description` as its lead, and `hero_actions`
// ([{label, to | href, primary, needs}]) as buttons. `hero: false` opts a page out, and pages with
// `hide_title: true` draw their own. This replaces the original DocItem/Content (a title plus the
// MDX), so a page using the header must not start with its own `# Title`.
import React from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc, useSidebarBreadcrumbs} from '@docusaurus/plugin-content-docs/client';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import DocNotes from '@site/src/components/Notes/DocNotes';
import PageHero from '@site/src/components/PageHero';
import styles from './styles.module.css';

const STALE_AFTER_DAYS = 365;
// Docusaurus's stand-in date when it skips git history (dev mode): not a real date
const PLACEHOLDER_TIMESTAMP = 1539502055000;
// Doc folder → the section name that starts the header's eyebrow
const HERO_SECTIONS = {'guides/': 'Guides'};

function Title() {
  const {metadata, frontMatter, contentTitle} = useDoc();
  const crumbs = useSidebarBreadcrumbs() ?? [];
  // As Docusaurus: no title when the page hides it or has its own # heading
  if (frontMatter.hide_title || contentTitle !== undefined) return null;
  const section = Object.entries(HERO_SECTIONS).find(([dir]) => metadata.id.startsWith(dir))?.[1];
  if (section && frontMatter.hero !== false) {
    const path = crumbs.filter((c) => c.type === 'category').map((c) => c.label);
    const eyebrow = [section, ...path.filter((label) => label !== section)].join(' · ');
    return (
      <PageHero
        eyebrow={eyebrow}
        title={metadata.title}
        lead={frontMatter.description}
        actions={frontMatter.hero_actions ?? []}
      />
    );
  }
  return (
    <header>
      <Heading as="h1">{metadata.title}</Heading>
    </header>
  );
}

export default function ContentWrapper({children}) {
  const {metadata} = useDoc();
  const updated = metadata.lastUpdatedAt === PLACEHOLDER_TIMESTAMP ? null : metadata.lastUpdatedAt;
  const ageDays = updated ? (Date.now() - updated) / 86400000 : 0;
  return (
    <>
      {ageDays > STALE_AFTER_DAYS && (
        <p className={styles.stale} suppressHydrationWarning>
          <strong>Possibly out of date:</strong> last updated{' '}
          {new Date(updated).toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'})}
          {metadata.lastUpdatedBy ? ` by ${metadata.lastUpdatedBy}` : ''}, over {Math.floor(ageDays / 365)}{' '}
          {Math.floor(ageDays / 365) === 1 ? 'year' : 'years'} ago.
        </p>
      )}
      <div className={clsx(ThemeClassNames.docs.docMarkdown, 'markdown')}>
        <Title />
        <MDXContent>{children}</MDXContent>
      </div>
      {/* Your notes that link to this page (local only: needs the notes API) */}
      <DocNotes title={metadata.title} />
    </>
  );
}
