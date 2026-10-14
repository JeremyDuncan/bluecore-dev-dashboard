// Opens links to other sites (GitHub, the deployed environments, Google Drive, …) in a new tab, so
// readers don't lose their place here. One listener covers every link, including those in imported
// Markdown and in components; a link that already sets its own target is left alone.
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';

if (ExecutionEnvironment.canUseDOM) {
  document.addEventListener(
    'click',
    (event) => {
      const a = event.target.closest?.('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      if (!/^https?:$/.test(a.protocol) || a.origin === window.location.origin) return;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    },
    true, // before the browser follows the link
  );
}
