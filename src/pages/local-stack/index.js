// /local-stack: your bluecore-stack checkout as a control panel, one page per section (src/components/LocalStack).
// Only works with the local MCP server and the helper on this machine; the public site has no Workspace menu.
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackPage() {
  return (
    <Layout title="Local Stack" description="Your local Bluecore stack: services, logs, tests, data, set up, jobs and troubleshooting">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="overview" />}</BrowserOnly>
    </Layout>
  );
}
