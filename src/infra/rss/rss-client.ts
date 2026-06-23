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

export async function fetchRssCommits(
  repositoryId: number,
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): Promise<RssCommit[]> {
  const url = buildRssUrl(meta, owner, repo, branch);

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/atom+xml, application/rss+xml, application/xml" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[RSS] ${url} returned ${response.status}`);
      return [];
    }

    const xml = await response.text();

    // Atom 피드인지 RSS 피드인지 판별
    if (xml.includes("<feed") && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
      return parseAtomFeed(xml, repositoryId);
    }
    if (xml.includes("<rss") || xml.includes("<channel>")) {
      return parseRssFeed(xml, repositoryId);
    }

    // 알 수 없는 형식이면 Atom으로 시도
    return parseAtomFeed(xml, repositoryId);
  } catch (error) {
    console.warn(`[RSS] fetch failed for ${url}:`, error);
    return [];
  }
}
