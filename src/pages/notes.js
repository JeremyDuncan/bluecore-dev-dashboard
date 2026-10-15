// /notes: your notes vault (src/components/Notes). Only works with the local MCP server running;
// the public site has no Notes link and this page explains why.
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Notes from '@site/src/components/Notes';

export default function NotesPage() {
  return (
    <Layout title="Notes" description="Your notes: Markdown files you can also open in Obsidian">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading notes…</div>}>{() => <Notes />}</BrowserOnly>
    </Layout>
  );
}
