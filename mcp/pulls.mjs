// Open pull requests across the org's repos, for the "Pull Requests" Project Status page and the
// list_pull_requests MCP tool. One GraphQL query per repo (the same repos as the issues page:
// projectStatus.issues filters, so private repos stay out), normalized with a review status, the CI
// result of the latest commit, and a stale flag.
import {graphql, listRepos} from './github.mjs';

const PULLS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt updatedAt
        additions deletions changedFiles
        headRefName baseRefName mergeable reviewDecision
        author { login }
        labels(first: 10) { nodes { name color } }
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
        latestOpinionatedReviews(first: 10) { nodes { state author { login } } }
        comments { totalCount }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
      }
    }
  }
}`;

// "needs review" | "changes requested" | "approved" | "draft". Branch protection sets reviewDecision;
// without it, the latest review per person decides.
export function reviewStatus(pr) {
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes requested';
  const states = (pr.latestOpinionatedReviews?.nodes ?? []).map((r) => r.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'needs review';
}

// GitHub's rollup of every check on the latest commit → "passing" | "failing" | "running" | null
const CI = {SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running'};

export async function fetchPullRequests({org, staleDays = 14, ...repoFilter}, token) {
  const repos = await listRepos(org, token, repoFilter);
  const now = Date.now();
  const pulls = [];
  for (const repo of repos) {
    let after = null;
    do {
      const data = await graphql(PULLS_QUERY, {owner: org, name: repo.name, after}, token);
      const page = data.repository?.pullRequests;
      if (!page) break;
      for (const pr of page.nodes) {
        const idleDays = Math.floor((now - new Date(pr.updatedAt).getTime()) / 86400000);
        pulls.push({
          repo: repo.name,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author?.login ?? 'ghost',
          draft: pr.isDraft,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
          ageDays: Math.floor((now - new Date(pr.createdAt).getTime()) / 86400000),
          idleDays,
          stale: idleDays >= staleDays,
          review: reviewStatus(pr),
          reviewers: (pr.reviewRequests?.nodes ?? []).map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.name).filter(Boolean),
          reviewedBy: (pr.latestOpinionatedReviews?.nodes ?? []).map((r) => ({login: r.author?.login, state: r.state})),
          ci: CI[pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? null,
          conflicts: pr.mergeable === 'CONFLICTING',
          labels: (pr.labels?.nodes ?? []).map((l) => ({name: l.name, color: l.color})),
          comments: pr.comments?.totalCount ?? 0,
          size: {additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles},
          branch: pr.headRefName,
          base: pr.baseRefName,
        });
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  }
  pulls.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first: what's waiting longest
  return {org, staleDays, repos: repos.map((r) => r.name), pulls, fetchedAt: new Date().toISOString()};
}
