// /notebooks: Jupyter notebooks for debugging the Bluecore stack (src/components/Notebooks). Only works
// with the local MCP server and JupyterLab running; the public site has no Notebooks link.
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Notebooks from '@site/src/components/Notebooks';

export default function NotebooksPage() {
  return (
    <Layout title="Notebooks" description="Jupyter notebooks for debugging and troubleshooting the Bluecore stack">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading notebooks…</div>}>{() => <Notebooks />}</BrowserOnly>
    </Layout>
  );
}
