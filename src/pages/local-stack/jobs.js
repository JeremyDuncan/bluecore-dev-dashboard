// /local-stack/jobs: the jobs section of the Local Stack pages (src/components/LocalStack).
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackJobsPage() {
  return (
    <Layout title="Jobs · Local Stack" description="Scripts run on your local Bluecore stack and their output">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="jobs" />}</BrowserOnly>
    </Layout>
  );
}
