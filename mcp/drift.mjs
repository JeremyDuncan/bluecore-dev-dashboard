// Version drift: for each service the stack runs, its latest release compared with the image the
// stack actually uses, and for each shared library (bluecore-models), the latest release compared
// with the version each service locks. Answers "why does it work in my repo but fail in the stack?"
//
// Config: projectStatus.versionDrift in docs-sources.json. Image build dates come from the GitHub
// container registry, which serves public images without a token.
import {fetchFile, rest} from './github.mjs';

// `image: ${BLUECORE_API_IMAGE:-ghcr.io/blue-core-lod/bluecore_api:latest}` → {var, default}
export function composeImages(text) {
  const images = {};
  for (const [, name, ref] of text.matchAll(/image:\s*\$\{(\w+):-([^}\s]+)\}/g)) images[name] = ref;
  return images;
}

// Build date of a public ghcr.io image (e.g. "ghcr.io/blue-core-lod/sinopia:latest"), or null
export async function imageBuiltAt(ref) {
  const m = ref?.match(/^ghcr\.io\/([^:@]+)(?::([^@]+))?$/);
  if (!m) return null;
  const [, name, tag = 'latest'] = m;
  try {
    const {token} = await (await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`)).json();
    const auth = {Authorization: `Bearer ${token}`};
    const accept = 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json';
    let manifest = await (await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {headers: {...auth, Accept: accept}})).json();
    if (manifest.manifests) {
      // Multi-platform image: read the first platform's manifest
      manifest = await (await fetch(`https://ghcr.io/v2/${name}/manifests/${manifest.manifests[0].digest}`, {headers: {...auth, Accept: accept}})).json();
    }
    const config = await (await fetch(`https://ghcr.io/v2/${name}/blobs/${manifest.config.digest}`, {headers: auth})).json();
    return config.created ?? null;
  } catch {
    return null;
  }
}

// Version locked for a package in a uv.lock file
export function uvLockVersion(text, pkg) {
  return text.match(new RegExp(`\\[\\[package\\]\\]\\s*\\nname = "${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\nversion = "([^"]+)"`))?.[1] ?? null;
}

const clean = (v) => v?.replace(/^v/, '') ?? null;
// Simple numeric version compare: 0.36.0 < 0.36.1 (pre-release suffixes are ignored)
export function compareVersions(a, b) {
  const pa = clean(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = clean(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const latestRelease = (org, repo, token) =>
  rest(`https://api.github.com/repos/${org}/${repo}/releases/latest`, token).catch(() => null);

async function serviceDrift(org, svc, images, token) {
  const info = await rest(`https://api.github.com/repos/${org}/${svc.repo}`, token);
  const branch = svc.branch ?? info.default_branch;
  const image = images[svc.imageVar] ?? null;
  const tag = image?.split(':').pop() ?? null;
  const [release, builtAt, head, publish] = await Promise.all([
    latestRelease(org, svc.repo, token),
    imageBuiltAt(image),
    rest(`https://api.github.com/repos/${org}/${svc.repo}/commits/${encodeURIComponent(branch)}`, token).catch(() => null),
    rest(`https://api.github.com/repos/${org}/${svc.repo}/actions/workflows/${svc.publishWorkflow ?? 'publish.yml'}/runs?per_page=1`, token)
      .then((d) => d.workflow_runs?.[0] ?? null)
      .catch(() => null),
  ]);
  const compare = release
    ? await rest(`https://api.github.com/repos/${org}/${svc.repo}/compare/${encodeURIComponent(release.tag_name)}...${encodeURIComponent(branch)}`, token).catch(() => null)
    : null;
  const headDate = head?.commit?.committer?.date ?? null;

  // Verdict, most serious first
  let status = 'ok';
  let summary;
  const unreleased = compare?.ahead_by ?? 0;
  if (tag && tag !== 'latest' && release && clean(tag) !== clean(release.tag_name)) {
    status = 'behind';
    summary = `The stack pins ${tag}, but the latest release is ${release.tag_name}.`;
  } else if (publish && publish.conclusion === 'failure') {
    status = 'behind';
    summary = `The last image publish failed (${publish.created_at.slice(0, 10)}), so the stack may run an older image.`;
  } else if (svc.imageTracksBranch) {
    if (builtAt && headDate && new Date(headDate) - new Date(builtAt) > 10 * 60000) {
      status = 'warning';
      summary = `The image is older than the latest commit on ${branch}.`;
    } else {
      summary = release ? `The stack runs the latest release, ${release.tag_name}.` : `The stack runs the latest build of ${branch}.`;
    }
  } else if (release && builtAt && new Date(release.published_at) - new Date(builtAt) > 10 * 60000) {
    status = 'behind';
    summary = `The image was built before the latest release (${release.tag_name}), so the stack runs an older version.`;
  } else if (unreleased > 0) {
    status = 'warning';
    summary = `${unreleased} commit${unreleased === 1 ? '' : 's'} on ${branch} ${unreleased === 1 ? "isn't" : "aren't"} released yet, so the stack doesn't have ${unreleased === 1 ? 'it' : 'them'}.`;
  } else if (!release) {
    status = 'warning';
    summary = `No release yet: the image is built from ${branch}.`;
  } else {
    summary = `The stack runs the latest release, ${release.tag_name}.`;
  }

  return {
    name: svc.name,
    repo: svc.repo,
    imageVar: svc.imageVar,
    imageTracksBranch: Boolean(svc.imageTracksBranch),
    image,
    tag,
    imageBuiltAt: builtAt,
    branch,
    release: release && {tag: release.tag_name, url: release.html_url, publishedAt: release.published_at},
    unreleased: compare
      ? {
          count: unreleased,
          url: compare.html_url,
          commits: (compare.commits ?? []).slice(-5).reverse().map((c) => ({sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0], date: c.commit.committer?.date})),
        }
      : null,
    headCommitAt: headDate,
    publish: publish && {conclusion: publish.conclusion, status: publish.status, createdAt: publish.created_at, url: publish.html_url},
    status,
    summary,
  };
}

async function libraryDrift(org, lib, token) {
  const [release, publish] = await Promise.all([
    latestRelease(org, lib.repo, token),
    rest(`https://api.github.com/repos/${org}/${lib.repo}/actions/workflows/${lib.publishWorkflow ?? 'publish.yml'}/runs?per_page=1`, token)
      .then((d) => d.workflow_runs?.[0] ?? null)
      .catch(() => null),
  ]);
  const latest = clean(release?.tag_name);
  const users = [];
  for (const repo of lib.usedBy ?? []) {
    // What the service's latest release locks (that's what its image has), and what main locks now
    const svcRelease = await latestRelease(org, repo, token);
    const read = (ref) =>
      fetchFile({org, repo, path: 'uv.lock', ref}, token)
        .then((f) => uvLockVersion(f.text ?? '', lib.package ?? lib.repo))
        .catch(() => null);
    const [inRelease, onMain] = await Promise.all([svcRelease ? read(svcRelease.tag_name) : null, read(undefined)]);
    const behind = (v) => Boolean(v && latest && compareVersions(v, latest) < 0);
    users.push({repo, releaseTag: svcRelease?.tag_name ?? null, inRelease, onMain, behind: behind(inRelease) || behind(onMain)});
  }
  // The version each service's image contains (its release), or main's when it has no release
  for (const u of users) u.version = u.inRelease ?? u.onMain;
  const versions = [...new Set(users.map((u) => u.version).filter(Boolean))];
  const mismatch = versions.length > 1;
  for (const u of users) u.mismatch = mismatch;
  const behind = users.filter((u) => u.behind).map((u) => u.repo);
  // Same wording as the page: "Latest release, v0.36.1 (bluecore_api and bluecore-workflows are using 0.36.0)"
  const known = users.filter((u) => u.version);
  const using = mismatch
    ? known.map((u) => `${u.repo} is using ${u.version}`).join(', ')
    : `${known.map((u) => u.repo).join(' and ')} ${known.length === 1 ? 'is' : 'are'} using ${versions[0]}`;
  let status = 'ok';
  let summary = `Latest release, ${release?.tag_name ?? 'none yet'}.`;
  if (mismatch) {
    // Services in the same stack sharing data through different model versions: the riskiest case
    status = 'behind';
    summary = `Latest release, ${release?.tag_name ?? 'none yet'} (${using}: the services use different versions).`;
  } else if (behind.length) {
    status = 'warning';
    summary = `Latest release, ${release.tag_name} (${using}).`;
  }
  return {
    name: lib.name,
    repo: lib.repo,
    release: release && {tag: release.tag_name, url: release.html_url, publishedAt: release.published_at},
    publish: publish && {conclusion: publish.conclusion, status: publish.status, createdAt: publish.created_at, url: publish.html_url},
    latest,
    users,
    mismatch,
    status,
    summary,
  };
}

export async function fetchVersionDrift({org, stack, services = [], libraries = []}, token) {
  let images = {};
  for (const file of stack?.files ?? ['compose.yaml']) {
    const f = await fetchFile({org, repo: stack.repo, path: file}, token).catch(() => null);
    images = {...images, ...composeImages(f?.text ?? '')};
  }
  const serviceRows = [];
  for (const svc of services) serviceRows.push(await serviceDrift(org, svc, images, token).catch((err) => ({...svc, status: 'unknown', summary: err.message})));
  const libraryRows = [];
  for (const lib of libraries) libraryRows.push(await libraryDrift(org, lib, token).catch((err) => ({...lib, status: 'unknown', summary: err.message})));
  // Show on each service which version of each shared library it uses
  for (const svc of serviceRows) {
    svc.libraries = libraryRows
      .map((lib) => {
        const u = lib.users?.find((x) => x.repo === svc.repo);
        return u && {name: lib.name, version: u.version, latest: lib.latest, behind: u.behind, mismatch: u.mismatch};
      })
      .filter(Boolean);
  }
  return {org, stackRepo: stack?.repo, services: serviceRows, libraries: libraryRows, fetchedAt: new Date().toISOString()};
}
