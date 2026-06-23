import { describe, it, expect } from "vitest";
import { parseAtomFeed, parseRssFeed } from "@/core/feed/rss-parser";

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Recent Commits to my-repo:main</title>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/abc1234567890</id>
    <title>feat: 로그인 페이지 구현</title>
    <updated>2026-06-23T10:30:00Z</updated>
    <author><name>jaeseok</name></author>
    <link rel="alternate" type="text/html" href="https://github.com/owner/repo/commit/abc1234567890"/>
  </entry>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/def4567890123</id>
    <title>fix: 세션 만료 버그 수정</title>
    <updated>2026-06-23T09:00:00Z</updated>
    <author><name>minsu</name></author>
    <link rel="alternate" type="text/html" href="https://github.com/owner/repo/commit/def4567890123"/>
  </entry>
</feed>`;

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>my-repo commits</title>
    <item>
      <title>refactor: 코드 정리</title>
      <link>https://gitea.example.com/owner/repo/commit/aaa1111</link>
      <pubDate>Mon, 23 Jun 2026 08:00:00 GMT</pubDate>
      <author>jiyoung</author>
    </item>
  </channel>
</rss>`;

describe("parseAtomFeed", () => {
  it("should parse GitHub Atom feed entries", () => {
    const commits = parseAtomFeed(sampleAtom, 1);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("abc1234567890");
    expect(commits[0].authorName).toBe("jaeseok");
    expect(commits[0].message).toBe("feat: 로그인 페이지 구현");
    expect(commits[0].repositoryId).toBe(1);
    expect(commits[1].sha).toBe("def4567890123");
    expect(commits[1].authorName).toBe("minsu");
  });

  it("should return empty array for empty feed", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    expect(parseAtomFeed(xml, 1)).toEqual([]);
  });

  it("should handle XML entities in message", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Grit::Commit/abc0def123</id>
    <title>fix: Test &amp; verify &lt;condition&gt;</title>
    <updated>2026-06-23T10:00:00Z</updated>
    <author><name>user</name></author>
    <link rel="alternate" type="text/html" href="https://github.com/owner/repo/commit/abc0def123"/>
  </entry>
</feed>`;
    const commits = parseAtomFeed(xml, 1);
    expect(commits[0].message).toBe("fix: Test & verify <condition>");
  });
});

describe("parseRssFeed", () => {
  it("should parse Gitea RSS feed items", () => {
    const commits = parseRssFeed(sampleRss, 2);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("aaa1111");
    expect(commits[0].authorName).toBe("jiyoung");
    expect(commits[0].message).toBe("refactor: 코드 정리");
    expect(commits[0].repositoryId).toBe(2);
  });

  it("should return empty array for empty RSS", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    expect(parseRssFeed(xml, 1)).toEqual([]);
  });

  it("should extract SHA from commit URL", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>docs: update README</title>
      <link>https://gitlab.com/user/project/commit/1234567890abcdef</link>
      <pubDate>Mon, 23 Jun 2026 10:00:00 GMT</pubDate>
      <author>alice</author>
    </item>
  </channel>
</rss>`;
    const commits = parseRssFeed(xml, 1);
    expect(commits[0].sha).toBe("1234567890abcdef");
  });

  it("should parse pubDate into ISO format", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>test commit</title>
      <link>https://example.com/repo/commit/abc123</link>
      <pubDate>Mon, 23 Jun 2026 15:30:45 GMT</pubDate>
      <author>user</author>
    </item>
  </channel>
</rss>`;
    const commits = parseRssFeed(xml, 1);
    const isoDate = new Date("Mon, 23 Jun 2026 15:30:45 GMT").toISOString();
    expect(commits[0].committedAt).toBe(isoDate);
  });
});
