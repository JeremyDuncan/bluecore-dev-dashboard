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

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Blue Core Docs',
  tagline: 'Everything a developer needs, in one place',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
    // A preset *name*: Docusaurus rejects the object getVcsPreset() returns (its functions fail the arity check)
    experimental_vcs: inGitRepo ? 'default-v1' : fileDates,
  },

  // Defaults target GitHub Pages; Docker sets SITE_URL/BASE_URL to serve at the root.
  url: process.env.SITE_URL ?? `https://${GITHUB_ORG.toLowerCase()}.github.io`,
  baseUrl: process.env.BASE_URL ?? `/${REPO_NAME}/`,
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

  customFields: {
    contactEmail: 'contact@bluecore.info', // shown in the footer (from the Blue Core design)
    // Live GitHub data for the Project Status pages, served by the MCP container. Empty = snapshot only.
    liveApiUrl: process.env.LIVE_API_URL ?? 'http://localhost:3001/api',
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
      colorMode: {
        respectPrefersColorScheme: true,
      },
      // Header and footer follow the Blue Core design in Figma (styles in src/css/custom.css).
      navbar: {
        logo: {
          alt: 'Blue Core',
          src: 'img/blue-core-logo.svg',
          srcDark: 'img/blue-core-logo-dark.svg',
          width: 163,
          height: 35,
        },
        items: [
          {to: '/', label: 'Docs', position: 'right', activeBaseRegex: '^/$'},
          ...ifSection('blue-core-repos', {to: '/blue-core-repos', label: 'Repos', position: 'right'}),
          ...ifSection('blue-core-wiki', {to: '/blue-core-wiki', label: 'Wiki', position: 'right'}),
          ...ifSection('project-status', {to: '/project-status', label: 'Status', position: 'right'}),
          {href: 'https://github.com/blue-core-lod', label: 'GitHub', position: 'right'},
        ],
      },
      // Rendered by src/theme/Footer (quick links, copyright line and the Blue Core icon).
      footer: {
        links: [
          {label: 'Docs', to: '/'},
          ...ifSection('blue-core-repos', {label: 'Repos', to: '/blue-core-repos'}),
          ...ifSection('blue-core-wiki', {label: 'Wiki', to: '/blue-core-wiki'}),
          ...ifSection('project-status', {label: 'Status', to: '/project-status'}),
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
