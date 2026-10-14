// Opens links to other sites (GitHub, the deployed environments, Google Drive, …) in a new tab, so
// readers don't lose their place here. One listener covers every link, including those in imported
// Markdown, in components and in SVG charts (e.g. the run chart's bars); a link that already sets its
// own target is left alone.
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';

if (ExecutionEnvironment.canUseDOM) {
  document.addEventListener(
    'click',
    (event) => {
      const a = event.target.closest?.('a[href]');
      if (!a || a.getAttribute('target') || a.hasAttribute('download')) return;
      // An SVG link's href is an SVGAnimatedString, not a URL string
      let url;
      try {
        url = new URL(a.href?.baseVal ?? a.getAttribute('href') ?? a.getAttribute('xlink:href'), window.location.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    },
    true, // before the browser follows the link
  );
}
