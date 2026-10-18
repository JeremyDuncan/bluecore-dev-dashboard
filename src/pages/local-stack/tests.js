// /local-stack/tests: the tests section of the Local Stack pages (src/components/LocalStack).
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackTestsPage() {
  return (
    <Layout title="Tests · Local Stack" description="Run your local Bluecore stack's integration and workflow tests">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="tests" />}</BrowserOnly>
    </Layout>
  );
}
