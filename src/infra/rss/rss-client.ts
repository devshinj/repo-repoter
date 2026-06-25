import type { GitProviderMeta } from "@/core/types";
import type { RssCommit } from "@/core/feed/feed-types";
import { parseAtomFeed, parseRssFeed } from "@/core/feed/rss-parser";

export function buildRssUrl(
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): string {
  const host = meta.host.replace(/\/$/, "");
  const protocol = host.includes("localhost") ? "http" : "https";

  switch (meta.type) {
    case "github":
      return `${protocol}://${host}/${owner}/${repo}/commits/${branch}.atom`;
    case "gitlab":
      return `${protocol}://${host}/${owner}/${repo}/-/commits/${branch}?format=atom`;
    case "gitea":
      return `${protocol}://${host}/${owner}/${repo}.rss`;
    case "bitbucket":
      return `${protocol}://${host}/${owner}/${repo}/rss`;
    default:
      return `${protocol}://${host}/${owner}/${repo}/commits/${branch}.atom`;
  }
}

export interface RssFetchResult {
  commits: RssCommit[];
  /** 원래 브랜치와 다른 브랜치에서 성공한 경우 해당 브랜치명 */
  correctedBranch?: string;
}

const branchFallbacks = ["main", "master", "develop"];

export async function fetchRssCommits(
  repositoryId: number,
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): Promise<RssFetchResult> {
  // 1차: 요청된 브랜치로 시도
  const result = await tryFetchRss(repositoryId, meta, owner, repo, branch);
  if (result.commits.length > 0 || result.status !== 404) {
    return { commits: result.commits };
  }

  // 2차: 404면 fallback 브랜치 시도
  for (const fallback of branchFallbacks) {
    if (fallback === branch) continue;
    const fallbackResult = await tryFetchRss(repositoryId, meta, owner, repo, fallback);
    if (fallbackResult.commits.length > 0 || fallbackResult.status === 200) {
      console.log(`[RSS] ${owner}/${repo}: branch corrected ${branch} → ${fallback}`);
      return { commits: fallbackResult.commits, correctedBranch: fallback };
    }
  }

  return { commits: [] };
}

async function tryFetchRss(
  repositoryId: number,
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): Promise<{ commits: RssCommit[]; status: number }> {
  const url = buildRssUrl(meta, owner, repo, branch);

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/atom+xml, application/rss+xml, application/xml" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[RSS] ${url} returned ${response.status}`);
      }
      return { commits: [], status: response.status };
    }

    const xml = await response.text();

    let commits: RssCommit[];
    if (xml.includes("<feed") && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
      commits = parseAtomFeed(xml, repositoryId);
    } else if (xml.includes("<rss") || xml.includes("<channel>")) {
      commits = parseRssFeed(xml, repositoryId);
    } else {
      commits = parseAtomFeed(xml, repositoryId);
    }

    return { commits, status: 200 };
  } catch (error) {
    console.warn(`[RSS] fetch failed for ${url}:`, error);
    return { commits: [], status: 0 };
  }
}
