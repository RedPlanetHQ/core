import axios from 'axios';

export async function getGithubData(url: string, accessToken: string) {
  return (
    await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  ).data;
}

const SEARCH_PAGE_SIZE = 100;
const SEARCH_RESULT_LIMIT = 1000;
const MAX_SEARCH_RETRY_DELAY_MS = 65_000;

export const searchLanes = ['prs', 'issues', 'comments', 'assigned'] as const;
export type SearchLane = (typeof searchLanes)[number];

interface SearchItem {
  id: number;
  number: number;
  title: string;
  html_url?: string;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
  repository_url?: string;
  repository?: { full_name?: string };
}

interface SearchPage {
  items: SearchItem[];
  total_count?: number;
}

async function getSearchPage(url: string, accessToken: string): Promise<SearchPage> {
  try {
    return await getGithubData(url, accessToken);
  } catch (error) {
    if (!axios.isAxiosError(error)) throw error;
    const response = error.response;
    if (response?.status !== 403 && response?.status !== 429) throw error;

    const headers = response.headers;
    let delay = Number.NaN;
    if (headers?.['retry-after'] != null) {
      delay = Number(headers['retry-after']) * 1_000;
    } else if (String(headers?.['x-ratelimit-remaining']) === '0') {
      // GitHub reports the primary rate limit reset in epoch seconds.
      delay = Math.max(0, Number(headers?.['x-ratelimit-reset']) * 1_000 - Date.now()) + 1_000;
    } else if (response.status === 429 || /secondary rate limit/i.test(response.data?.message)) {
      delay = 60_000;
    }

    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_SEARCH_RETRY_DELAY_MS) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return getGithubData(url, accessToken);
  }
}

/**
 * Get user events (PRs, issues, comments) and issues assigned to the user by themselves.
 */
export async function getUserEvents(
  username: string,
  page: number,
  accessToken: string,
  since: string,
  activeLanes: readonly SearchLane[],
) {
  const formattedDate = encodeURIComponent(since.split('T')[0]);
  const queries: Record<SearchLane, string> = {
    prs: `author:${username}+type:pr+created:>=${formattedDate}&sort=created`,
    issues: `author:${username}+type:issue+created:>=${formattedDate}&sort=created`,
    comments: `commenter:${username}+updated:>=${formattedDate}&sort=updated`,
    assigned: `assignee:${username}+author:${username}+type:issue+updated:>=${formattedDate}&sort=updated`,
  };
  const pages = new Map<SearchLane, SearchPage>();
  for (const lane of activeLanes) {
    const url = `https://api.github.com/search/issues?q=${queries[lane]}&order=desc&page=${page}&per_page=${SEARCH_PAGE_SIZE}`;
    pages.set(lane, await getSearchPage(url, accessToken));
  }

  const prsResponse = pages.get('prs');
  const issuesResponse = pages.get('issues');
  const commentsResponse = pages.get('comments');
  const assignedIssuesResponse = pages.get('assigned');

  // Filter function to exclude items older than the exact since timestamp
  const filterBySince = (item: SearchItem) => {
    const itemDate = new Date(item.created_at || item.updated_at);
    const sinceDate = new Date(since);
    return itemDate >= sinceDate;
  };

  // Search API items expose `repository_url` (e.g. https://api.github.com/repos/owner/repo)
  // but no `repository` object. Derive `repository.full_name` so downstream code can
  // read it the same way as the notifications endpoint.
  const repoFromUrl = (url?: string) =>
    url ? url.replace('https://api.github.com/repos/', '') : undefined;
  const withRepo = (item: SearchItem) => {
    const fullName = repoFromUrl(item.repository_url);
    return fullName
      ? { ...item, repository: { ...(item.repository || {}), full_name: fullName } }
      : item;
  };

  const issues = issuesResponse?.items ?? [];
  const authoredIssueIds = new Set(issues.map((issue) => issue.id));
  const results = [
    ...(prsResponse?.items ?? [])
      .filter(filterBySince)
      .map((item) => ({ ...withRepo(item), type: 'pr' })),
    ...issues
      .filter((item) => !item.pull_request && filterBySince(item))
      .map((item) => ({ ...withRepo(item), type: 'issue' })),
    ...(commentsResponse?.items ?? []).filter(filterBySince).map((item) => ({
      ...withRepo(item),
      type: item.pull_request ? 'pr_comment' : 'issue_comment',
    })),
    ...(assignedIssuesResponse?.items ?? [])
      .filter((item) => !authoredIssueIds.has(item.id) && filterBySince(item))
      .map((item) => ({ ...withRepo(item), type: 'self_assigned_issue' })),
  ];

  // Sort by created_at descending
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const pageEnd = page * SEARCH_PAGE_SIZE;
  const remainingLanes: SearchLane[] = [];
  for (const [lane, response] of pages) {
    if (
      pageEnd < SEARCH_RESULT_LIMIT &&
      response.items.length === SEARCH_PAGE_SIZE &&
      (response.total_count == null || response.total_count > pageEnd)
    ) {
      remainingLanes.push(lane);
    }
  }
  return { events: results, remainingLanes };
}
