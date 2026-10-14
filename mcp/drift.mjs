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

// Build date and labels of a public ghcr.io image (e.g. "ghcr.io/blue-core-lod/sinopia:latest"), or null
export async function imageInfo(ref) {
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
    return {created: config.created ?? null, labels: config.config?.Labels ?? {}};
  } catch {
    return null;
  }
}

export const imageBuiltAt = async (ref) => (await imageInfo(ref))?.created ?? null;

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
  const [release, imageMeta, head, publish] = await Promise.all([
    latestRelease(org, svc.repo, token),
    imageInfo(image),
    rest(`https://api.github.com/repos/${org}/${svc.repo}/commits/${encodeURIComponent(branch)}`, token).catch(() => null),
    rest(`https://api.github.com/repos/${org}/${svc.repo}/actions/workflows/${svc.publishWorkflow ?? 'publish.yml'}/runs?per_page=1`, token)
      .then((d) => d.workflow_runs?.[0] ?? null)
      .catch(() => null),
  ]);
  const compare = release
    ? await rest(`https://api.github.com/repos/${org}/${svc.repo}/compare/${encodeURIComponent(release.tag_name)}...${encodeURIComponent(branch)}`, token).catch(() => null)
    : null;
  const headDate = head?.commit?.committer?.date ?? null;
  const builtAt = imageMeta?.created ?? null;

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

// --- Deployed environments (e.g. dev.bcld.info, stage.bcld.info) ---------------------------------

// GET a JSON health/version endpoint on a deployed site: {up, version, body} (never throws)
async function probe(url) {
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(10000), redirect: 'manual', headers: {'User-Agent': 'bluecore-dev-dashboard'}});
    const up = res.status < 500;
    const body = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
    return {up, status: res.status, version: body?.version ?? null, body};
  } catch (err) {
    return {up: false, status: null, version: null, error: err.name === 'TimeoutError' ? 'timed out' : err.message};
  }
}

// One service on one environment: the deployed version compared with the releases
function deployedStatus(svc, result, releases) {
  if (!result.up) return {status: 'down', summary: `Not reachable${result.error ? ` (${result.error})` : result.status ? ` (HTTP ${result.status})` : ''}.`};
  if (result.status === 404) return {status: 'unknown', deployed: null, summary: `No version endpoint at ${svc.health} yet (HTTP 404).`};
  if (result.status >= 400) return {status: 'unknown', deployed: null, summary: `The version endpoint returned HTTP ${result.status}.`};
  const deployed = result.version;
  if (!deployed) return {status: 'unknown', deployed: null, summary: 'The health endpoint answers but reports no version.'};
  const latest = releases[0];
  const index = releases.findIndex((r) => clean(r.tag) === clean(deployed));
  if (latest && clean(latest.tag) === clean(deployed)) return {status: 'ok', deployed, summary: `Runs the latest release, ${latest.tag}.`};
  if (index > 0) {
    const missing = releases.slice(0, index);
    return {
      status: 'behind',
      deployed,
      missing: missing.map((r) => ({tag: r.tag, url: r.url, publishedAt: r.publishedAt})),
      summary: `${missing.length} release${missing.length === 1 ? '' : 's'} behind: ${missing.map((r) => r.tag).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} deployed.`,
    };
  }
  if (latest && compareVersions(deployed, latest.tag) > 0) return {status: 'ahead', deployed, summary: `Runs ${deployed}, newer than the latest release (${latest.tag}): an unreleased build.`};
  return {status: 'unknown', deployed, summary: `Runs ${deployed}, which isn't one of the last ${releases.length} releases.`};
}

async function environmentDrift(env, services, serviceRows, releasesByRepo) {
  const base = env.url.replace(/\/$/, '');
  const rows = [];
  for (const svc of services) {
    if (!svc.health) continue;
    const result = await probe(`${base}${svc.health}`);
    rows.push({name: svc.name, repo: svc.repo, healthUrl: `${base}${svc.health}`, ...deployedStatus(svc, result, releasesByRepo[svc.repo] ?? [])});
  }
  return {name: env.name, url: env.url, reachable: rows.some((r) => r.status !== 'down'), services: rows};
}

// Libraries on an environment, through the services that use them: the version locked in the
// release each service has deployed (locks: "repo@version" → library version)
function deployedLibraries(env, libraryRows, locks) {
  const rows = [];
  for (const lib of libraryRows) {
    for (const u of lib.users ?? []) {
      const svc = env.services.find((r) => r.repo === u.repo);
      if (!svc?.deployed) continue;
      const version = locks[`${lib.repo}:${u.repo}@${clean(svc.deployed)}`] ?? null;
      rows.push({
        name: lib.name,
        via: svc.name,
        viaRepo: u.repo,
        viaVersion: svc.deployed,
        version,
        latest: lib.latest,
        status: !version ? 'unknown' : lib.latest && compareVersions(version, lib.latest) < 0 ? 'behind' : 'ok',
      });
    }
  }
  // Services on the same site sharing data through different library versions: the riskiest case
  const mismatches = [];
  for (const name of new Set(rows.map((r) => r.name))) {
    const known = rows.filter((r) => r.name === name && r.version);
    if (new Set(known.map((r) => clean(r.version))).size < 2) continue;
    for (const r of known) {
      r.mismatch = true;
      r.status = 'mismatch';
    }
    mismatches.push({name, summary: `On ${env.name}, ${known.map((r) => `${r.via} uses ${name} ${r.version}`).join(' but ')}.`});
  }
  return {rows, mismatches};
}

export async function fetchVersionDrift({org, stack, services = [], libraries = [], environments = []}, token) {
  let images = {};
  for (const file of stack?.files ?? ['compose.yaml']) {
    const f = await fetchFile({org, repo: stack.repo, path: file}, token).catch(() => null);
    images = {...images, ...composeImages(f?.text ?? '')};
  }
  const serviceRows = [];
  for (const svc of services) serviceRows.push(await serviceDrift(org, svc, images, token).catch((err) => ({...svc, status: 'unknown', summary: err.message})));
  const libraryRows = [];
  for (const lib of libraries) libraryRows.push(await libraryDrift(org, lib, token).catch((err) => ({...lib, status: 'unknown', summary: err.message})));

  // Deployed environments: what each site reports, compared with the releases
  const environmentRows = [];
  if (environments.length) {
    const releasesByRepo = {};
    for (const repo of new Set(services.filter((svc) => svc.health).map((svc) => svc.repo))) {
      const list = await rest(`https://api.github.com/repos/${org}/${repo}/releases?per_page=30`, token).catch(() => []);
      releasesByRepo[repo] = list.filter((r) => !r.draft).map((r) => ({tag: r.tag_name, url: r.html_url, publishedAt: r.published_at}));
    }
    for (const env of environments) environmentRows.push(await environmentDrift(env, services, serviceRows, releasesByRepo));
    // Library versions locked in each deployed release (each tag read once)
    const locks = {};
    for (const lib of libraryRows) {
      for (const u of lib.users ?? []) {
        for (const env of environmentRows) {
          const svc = env.services.find((r) => r.repo === u.repo);
          const key = svc?.deployed && `${lib.repo}:${u.repo}@${clean(svc.deployed)}`;
          if (!key || key in locks) continue;
          const tag = releasesByRepo[u.repo]?.find((r) => clean(r.tag) === clean(svc.deployed))?.tag ?? svc.deployed;
          locks[key] = await fetchFile({org, repo: u.repo, path: 'uv.lock', ref: tag}, token)
            .then((f) => uvLockVersion(f.text ?? '', lib.package ?? lib.repo))
            .catch(() => null);
        }
      }
    }
    for (const env of environmentRows) {
      const {rows, mismatches} = deployedLibraries(env, libraryRows, locks);
      env.libraries = rows;
      env.libraryMismatches = mismatches;
    }
  }

  // Show on each service which version of each shared library it uses
  for (const svc of serviceRows) {
    svc.libraries = libraryRows
      .map((lib) => {
        const u = lib.users?.find((x) => x.repo === svc.repo);
        return u && {name: lib.name, version: u.version, latest: lib.latest, behind: u.behind, mismatch: u.mismatch};
      })
      .filter(Boolean);
  }
  return {org, stackRepo: stack?.repo, services: serviceRows, libraries: libraryRows, environments: environmentRows, fetchedAt: new Date().toISOString()};
}
