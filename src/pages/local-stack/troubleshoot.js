// /local-stack/troubleshoot: the troubleshoot section of the Local Stack pages (src/components/LocalStack).
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackTroubleshootPage() {
  return (
    <Layout title="Troubleshoot · Local Stack" description="Find what is wrong with your local Bluecore stack">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="troubleshoot" />}</BrowserOnly>
    </Layout>
  );
}
