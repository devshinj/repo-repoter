import { describe, it, expect } from "vitest";
import { buildCommitLogProperties, buildDailyTaskProperties } from "@/infra/notion/notion-client";
import type { CommitRecord, DailyTask } from "@/core/types";

describe("buildCommitLogProperties", () => {
  it("maps CommitRecord to Notion properties", () => {
    const commit: CommitRecord = {
      sha: "abc123def",
      message: "feat: add login page",
      author: "JAESEOK",
      date: "2026-04-09T10:00:00Z",
      repoOwner: "devshinj",
      repoName: "my-app",
      branch: "main",
      filesChanged: ["src/app/login/page.tsx", "src/lib/auth.ts"],
      additions: 70,
      deletions: 5,
    };

    const props = buildCommitLogProperties(commit);
    expect(props.Title.title[0].text.content).toBe("feat: add login page");
    expect(props.Project.select.name).toBe("my-app");
    expect(props.Date.date.start).toBe("2026-04-09T10:00:00Z");
    expect(props.Author.rich_text[0].text.content).toBe("JAESEOK");
    expect(props["Commit SHA"].rich_text[0].text.content).toBe("abc123def");
    expect(props.Branch.select.name).toBe("main");
  });
});

describe("buildDailyTaskProperties", () => {
  it("maps DailyTask to Notion properties", () => {
    const task: DailyTask = {
      title: "사용자 인증 시스템 구현",
      description: "로그인 페이지를 추가하고 리다이렉트 버그를 수정함",
      date: "2026-04-09",
      project: "my-app",
      complexity: "Medium",
      commitShas: ["abc123", "def456"],
    };

    const props = buildDailyTaskProperties(task);
    expect(props["제목"].title[0].text.content).toBe("사용자 인증 시스템 구현");
    expect(props["작업 설명"].rich_text[0].text.content).toBe("로그인 페이지를 추가하고 리다이렉트 버그를 수정함");
    expect(props["작업일"].date.start).toBe("2026-04-09");
    expect(props["프로젝트"].select.name).toBe("my-app");
    expect(props["작업 복잡도"].select.name).toBe("Medium");
  });
});
