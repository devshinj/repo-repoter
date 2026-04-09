import { describe, it, expect } from "vitest";
import { buildCommitRecords } from "@/infra/github/github-client";

describe("buildCommitRecords", () => {
  it("extracts commit records from GitHub API response", () => {
    const apiResponse = [
      {
        sha: "abc123",
        commit: {
          message: "feat: add login page",
          author: { name: "JAESEOK", date: "2026-04-09T10:00:00Z" },
        },
        files: [
          { filename: "src/app/login/page.tsx", additions: 50, deletions: 0 },
          { filename: "src/lib/auth.ts", additions: 20, deletions: 5 },
        ],
      },
    ];

    const records = buildCommitRecords(apiResponse, "devshinj", "my-app", "main");
    expect(records).toHaveLength(1);
    expect(records[0].sha).toBe("abc123");
    expect(records[0].message).toBe("feat: add login page");
    expect(records[0].author).toBe("JAESEOK");
    expect(records[0].filesChanged).toEqual(["src/app/login/page.tsx", "src/lib/auth.ts"]);
    expect(records[0].additions).toBe(70);
    expect(records[0].deletions).toBe(5);
  });

  it("handles commits with no files array", () => {
    const apiResponse = [
      {
        sha: "def456",
        commit: {
          message: "initial commit",
          author: { name: "JAESEOK", date: "2026-04-09T09:00:00Z" },
        },
      },
    ];

    const records = buildCommitRecords(apiResponse, "devshinj", "my-app", "main");
    expect(records[0].filesChanged).toEqual([]);
    expect(records[0].additions).toBe(0);
    expect(records[0].deletions).toBe(0);
  });
});
