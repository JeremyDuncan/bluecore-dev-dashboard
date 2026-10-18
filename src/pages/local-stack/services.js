// /local-stack/services: the services section of the Local Stack pages (src/components/LocalStack).
import React from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LocalStack from '@site/src/components/LocalStack';

export default function LocalStackServicesPage() {
  return (
    <Layout title="Services · Local Stack" description="The containers of your local Bluecore stack, and starting and stopping it">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading your stack…</div>}>{() => <LocalStack section="services" />}</BrowserOnly>
    </Layout>
  );
}
