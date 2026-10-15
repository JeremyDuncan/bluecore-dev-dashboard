// @ts-check
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import {themes as prismThemes} from 'prism-react-renderer';

// Edit these for your project / GitHub Pages deployment.
const GITHUB_ORG = 'JeremyDuncan';
const REPO_NAME = 'bluecore-dev-dashboard';

// "Last updated" dates: imported pages carry their source's date in front matter (last_update).
// Other pages use git history once this folder is in a git repo, and the file's date until then.
const inGitRepo = (() => {
  try {
    execSync('git rev-parse --is-inside-work-tree', {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();
const fileDates = {
  initialize: () => {},
  getFileCreationInfo: async (_filePath) => null,
  getFileLastUpdateInfo: async (filePath) => {
    try {
      return {timestamp: fs.statSync(filePath).mtimeMs, author: null};
    } catch {
      return null;
    }
  },
};

// Synced and local-only sections (GitHub docs, Project Status, Figma design notes) only get
// navbar/footer links when their folder exists, so a site built without them shows no trace.
const hasSection = (dir) => fs.existsSync(new URL(`./docs/${dir}`, import.meta.url));
const ifSection = (dir, item) => (hasSection(dir) ? [item] : []);

// The bluecore-stack repo docs (environment setup, testing, local development): developers' starting
// point, so it gets its own navbar link and a sidebar link right under Welcome.
const STACK_DIR = 'blue-core-repos/bluecore-stack';
const STACK_URL = `/${STACK_DIR}/`;

// Live GitHub data and the Notes page come from the MCP container (mcp/live-api.mjs, notes-api.mjs).
// Empty (the public deploy) = Project Status shows its snapshot and there are no notes.
const LIVE_API_URL = process.env.LIVE_API_URL ?? 'http://localhost:3001/api';

// Sidebar icon for each top-level section, by its folder under docs/ (drawn in src/css/custom.css,
// .sidebar-icon--<name>). Sections not listed get a folder icon.
const SIDEBAR_ICONS = {
  intro: 'home',
  guides: 'guides',
  'getting-started': 'guides',
  'project-status': 'status',
  'blue-core-repos': 'repos',
  'other-repos': 'repos',
  'blue-core-wiki': 'wiki',
  design: 'design',
  'google-drive': 'drive',
  box: 'box',
  reference: 'code',
};

// The docs/ folder a top-level sidebar item comes from ("guides" for a category of guides)
function sectionDir(item) {
  if (item.type === 'doc') return item.id.split('/')[0];
  if (item.type !== 'category') return null;
  const id = item.link?.id ?? item.link?.slug?.replace(/^\//, '') ?? item.items.map(sectionDir).find(Boolean);
  return id?.split('/')[0] ?? null;
}

// Sections with their own sidebar (sidebars.js), left out of the docs sidebar
const SEPARATE_SECTIONS = ['project-status', 'guides'];

// Sections with their own sidebar (Guides, Project Status) start with a link back to the docs and a
// header saying what the section is
function sectionHead(title, text) {
  return [
    {type: 'link', label: 'Back to the docs', href: '/', className: 'section-sidebar-back'},
    {
      type: 'html',
      value: `<span class="section-sidebar-title">${title}</span><span class="section-sidebar-text">${text}</span>`,
      className: 'section-sidebar-head',
    },
  ];
}

// The Project Status sidebar, from the sync's _data/nav.json (the same list as the icon bar on each
// page): a header saying what the section is, then each page with its icon, and the test suites under
// Tests with their latest result. Falls back to the plain folder listing if there's no nav.json yet.
function statusSidebar(items, docIds) {
  let nav;
  try {
    nav = JSON.parse(fs.readFileSync(new URL('./docs/project-status/_data/nav.json', import.meta.url), 'utf8'));
  } catch {
    return items;
  }
  const docId = (p) => (p.href.replace(/\/$/, '') === '/project-status' ? 'project-status/index' : p.href.replace(/^\//, ''));
  const exists = (p) => docIds.has(docId(p));
  const page = (p, extra = {}) => ({type: 'doc', id: docId(p), label: p.label, className: `sidebar-icon sidebar-icon--status-${p.icon}`, ...extra});
  return [
    ...sectionHead('Project Status', 'Live GitHub activity for the Blue Core repositories: issues, pull requests, test runs and releases.'),
    ...nav
      .filter((p) => !p.group && exists(p))
      .map((p) => {
        const members = nav.filter((m) => m.group === p.id && exists(m));
        if (!members.length) return page(p);
        return {
          type: 'category',
          label: p.label,
          link: {type: 'doc', id: docId(p)},
          className: `sidebar-icon sidebar-icon--status-${p.icon}`,
          items: members.map((m) => ({type: 'doc', id: docId(m), label: m.label, className: `status-result status-result--${m.status ?? 'none'}`})),
        };
      }),
  ];
}

function withIcon(item) {
  const dir = sectionDir(item);
  if (!dir) return item;
  const icon = SIDEBAR_ICONS[dir] ?? (item.type === 'category' ? 'folder' : 'page');
  return {...item, className: [item.className, 'sidebar-icon', `sidebar-icon--${icon}`].filter(Boolean).join(' ')};
}

// Defaults target GitHub Pages; Docker sets SITE_URL/BASE_URL to serve at the root.
const BASE_URL = process.env.BASE_URL ?? `/${REPO_NAME}/`;
// Navbar activeBaseRegex is tested against the full path, base URL included ("/bluecore-dev-dashboard/…")
const activeRegex = (pattern) => `^${BASE_URL}${pattern}`;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Blue Core Developer Dashboard',
  tagline: 'Everything a developer needs, in one place',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
    // A preset *name*: Docusaurus rejects the object getVcsPreset() returns (its functions fail the arity check).
    // Production builds only: in dev, the git preset returns a placeholder ("Oct 14, 2018 by Author") for
    // every page, which the "Possibly out of date" notice would take at face value; file dates are real.
    experimental_vcs: inGitRepo && process.env.NODE_ENV === 'production' ? 'default-v1' : fileDates,
  },

  url: process.env.SITE_URL ?? `https://${GITHUB_ORG.toLowerCase()}.github.io`,
  baseUrl: BASE_URL,
  organizationName: GITHUB_ORG,
  projectName: REPO_NAME,

  // Imported READMEs / Google Docs often contain links we can't resolve; warn instead of failing the build.
  onBrokenLinks: 'warn',
  markdown: {
    // .md files are parsed as plain CommonMark (safe for imported content), .mdx as MDX.
    format: 'detect',
    // Render ```mermaid code blocks as diagrams (used across the Blue Core docs).
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Links to other sites open in a new tab
  clientModules: ['./src/clientModules/externalLinks.js'],

  customFields: {
    contactEmail: 'contact@bluecore.info', // shown in the footer (from the Blue Core design)
    // Live GitHub data for the Project Status pages, served by the MCP container. Empty = snapshot only.
    liveApiUrl: LIVE_API_URL,
    // "Ask the docs" chat helper (chat/server.mjs, `make chat`), which uses your Claude Code CLI. Empty = no chat box.
    chatApiUrl: process.env.CHAT_API_URL ?? 'http://localhost:3002',
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/', // docs are the homepage
          sidebarPath: './sidebars.js',
          // "Last updated on … by …" from each page's last_update (set by the sync from the source)
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
          editUrl: `https://github.com/${GITHUB_ORG}/${REPO_NAME}/tree/main/`,
          // A category whose _category_.json sets customProps.hideItems shows as a single link to its
          // index page. Project Status uses it: its pages link to each other with icons (StatusNav).
          async sidebarItemsGenerator({defaultSidebarItemsGenerator, ...args}) {
            const flatten = (items) =>
              items.map((item) =>
                item.type !== 'category' ? item : {...item, items: item.customProps?.hideItems ? [] : flatten(item.items)},
              );
            if (args.item.dirName === 'project-status') {
              return statusSidebar(await defaultSidebarItemsGenerator(args), new Set(args.docs.map((d) => d.id)));
            }
            if (args.item.dirName === 'guides') {
              return [...sectionHead('Guides', 'How this site works: where its content comes from, the live GitHub data, and adding or changing docs.'), ...(await defaultSidebarItemsGenerator(args))];
            }
            // The docs sidebar leaves out the sections with their own sidebar (sidebars.js)
            const items = flatten(await defaultSidebarItemsGenerator(args))
              .filter((item) => !SEPARATE_SECTIONS.includes(sectionDir(item)))
              .map(withIcon);
            if (!hasSection(STACK_DIR)) return items;
            const stack = {type: 'link', label: 'Bluecore Stack: start here', href: STACK_URL, className: 'sidebar-featured sidebar-icon--stack'};
            const welcome = items.findIndex((item) => item.type === 'doc' && item.id === 'intro');
            return welcome === -1 ? [stack, ...items] : [...items.slice(0, welcome + 1), stack, ...items.slice(welcome + 1)];
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      // Free, fully offline search index built at build time (no Algolia account needed).
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        docsRouteBasePath: '/',
        indexBlog: false,
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // The preview card when a link is shared (Slack, Teams, …): og:image / twitter:image, made absolute
      // with url + baseUrl. Slack doesn't show SVGs here, so it's a 1200×630 PNG.
      image: 'img/blue-core-social-card.png',
      metadata: [
        {property: 'og:image:width', content: '1200'},
        {property: 'og:image:height', content: '630'},
        {property: 'og:image:alt', content: 'Blue Core Developer Dashboard: docs, repos and live project status in one place'},
        {property: 'og:site_name', content: 'Blue Core Developer Dashboard'},
      ],
      colorMode: {
        respectPrefersColorScheme: true,
      },
      // Opening a sidebar section (by clicking it or by going to one of its pages) closes the other
      // open sections at the same level, so only the current one stays expanded. hideable: a button at
      // the bottom of the sidebar hides it (and an arrow brings it back) for more reading room.
      docs: {
        sidebar: {autoCollapseCategories: true, hideable: true},
      },
      // Header and footer follow the Blue Core design in Figma (styles in src/css/custom.css).
      navbar: {
        // Shown beside the logo as a two-line lockup (custom.css: .navbar__title)
        title: 'Developer Dashboard',
        logo: {
          alt: 'Blue Core',
          src: 'img/blue-core-logo.svg',
          srcDark: 'img/blue-core-logo-dark.svg',
          width: 163,
          height: 35,
        },
        items: [
          // Each link has an icon (className: navbar-icon + the icon's sidebar-icon--<name>, src/css/custom.css)
          ...ifSection(STACK_DIR, {to: STACK_URL, label: 'Bluecore Stack', position: 'right', className: 'navbar-icon sidebar-icon--stack'}),
          // Not active on the Bluecore Stack pages, which have their own link
          ...ifSection('blue-core-repos', {to: '/blue-core-repos', label: 'Repos', position: 'right', className: 'navbar-icon sidebar-icon--repos', activeBaseRegex: activeRegex('blue-core-repos(?!/bluecore-stack)')}),
          ...ifSection('blue-core-wiki', {to: '/blue-core-wiki', label: 'Wiki', position: 'right', className: 'navbar-icon sidebar-icon--wiki'}),
          // Project Status and Notes aren't docs: set apart from the doc links by a divider
          ...(hasSection('project-status') || LIVE_API_URL
            ? [{type: 'html', value: '<span class="navbar-divider" aria-hidden="true"></span>', position: 'right'}]
            : []),
          ...ifSection('project-status', {to: '/project-status', label: 'Project Status', position: 'right', className: 'navbar-icon sidebar-icon--status'}),
          // Your notes vault (src/pages/notes.js): local only, so not on the public site
          ...(LIVE_API_URL ? [{to: '/notes', label: 'Notes', position: 'right', className: 'navbar-icon sidebar-icon--notes'}] : []),
          {href: 'https://github.com/blue-core-lod', label: 'GitHub', position: 'right', className: 'navbar-icon sidebar-icon--github'},
          // Guides: a small "?" with a tooltip rather than a full link (the label shows in the phone menu)
          ...ifSection('guides', {
            to: '/guides',
            html: '<span class="navbar-help-label">Guides</span>',
            position: 'right',
            className: 'navbar-help',
            'aria-label': 'Guides: how this site works',
          }),
        ],
      },
      // Rendered by src/theme/Footer (quick links, copyright line and the Blue Core icon).
      footer: {
        links: [
          {label: 'Docs', to: '/'},
          ...ifSection('blue-core-repos', {label: 'Repos', to: '/blue-core-repos'}),
          ...ifSection('blue-core-wiki', {label: 'Wiki', to: '/blue-core-wiki'}),
          ...ifSection('project-status', {label: 'Project Status', to: '/project-status'}),
          ...ifSection('design', {label: 'Design', to: '/design'}),
          {label: 'GitHub', href: 'https://github.com/blue-core-lod'},
        ],
        copyright: `© ${new Date().getFullYear()} Blue Core`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['ruby', 'bash', 'json', 'yaml'],
      },
    }),
};

export default config;
