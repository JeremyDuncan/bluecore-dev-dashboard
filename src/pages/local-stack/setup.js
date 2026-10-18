// /local-stack/setup: the setup section of the Local Stack pages (src/components/LocalStack).
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackSetupPage() {
  return (
    <Layout title="Set up · Local Stack" description="Install and update the Bluecore repos, and the Keycloak realm">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="setup" />}</BrowserOnly>
    </Layout>
  );
}
