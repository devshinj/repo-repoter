import type { RssCommit } from "@/core/feed/feed-types";

/**
 * GitHub/GitLab Atom 피드를 파싱하여 RssCommit 배열로 변환한다.
 * 외부 XML 라이브러리 없이 정규식 기반으로 처리한다.
 * Atom entry의 id에서 SHA를 추출한다.
 */
export function parseAtomFeed(xml: string, repositoryId: number): RssCommit[] {
  const commits: RssCommit[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const id = extractTag(block, "id");
    const title = extractTag(block, "title");
    const updated = extractTag(block, "updated");
    const author = extractTag(block, "name"); // <author><name>...</name></author>

    // SHA 추출: Atom id 형식 "tag:github.com,...:Grit::Commit/SHA" 또는 URL 끝
    const sha = extractShaFromAtomId(id) ?? extractShaFromLink(block);
    if (!sha || !title) continue;

    commits.push({
      repositoryId,
      sha,
      authorName: author || "unknown",
      message: decodeXmlEntities(title),
      committedAt: updated || new Date().toISOString(),
    });
  }

  return commits;
}

/**
 * Gitea RSS 피드를 파싱하여 RssCommit 배열로 변환한다.
 * item의 link에서 SHA를 추출한다.
 */
export function parseRssFeed(xml: string, repositoryId: number): RssCommit[] {
  const commits: RssCommit[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const author = extractTag(block, "author") || extractTag(block, "dc:creator");

    const sha = link ? extractShaFromUrl(link) : null;
    if (!sha || !title) continue;

    commits.push({
      repositoryId,
      sha,
      authorName: author || "unknown",
      message: decodeXmlEntities(title),
      committedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    });
  }

  return commits;
}

function extractTag(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "i");
  const match = regex.exec(xml);
  return match?.[1]?.trim() || null;
}

function extractShaFromAtomId(id: string | null): string | null {
  if (!id) return null;
  // GitHub: "tag:github.com,2008:Grit::Commit/abc123..."
  const commitMatch = /Commit\/([a-f0-9]+)$/i.exec(id);
  if (commitMatch) return commitMatch[1];
  // GitLab: 일반적으로 URL 또는 해시
  const hashMatch = /([a-f0-9]{7,40})$/i.exec(id);
  return hashMatch?.[1] || null;
}

function extractShaFromLink(block: string): string | null {
  const linkMatch = /href="([^"]*commit[^"]*)"/i.exec(block);
  return linkMatch ? extractShaFromUrl(linkMatch[1]) : null;
}

function extractShaFromUrl(url: string): string | null {
  const match = /\/commit\/([a-f0-9]+)/i.exec(url);
  return match?.[1] || null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
