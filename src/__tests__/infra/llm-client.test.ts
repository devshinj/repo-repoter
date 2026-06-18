// src/__tests__/infra/llm-client.test.ts
import { describe, it, expect } from "vitest";
import { buildAnalysisPrompt, parseAnalysisResponse, buildHrmsTaskPrompt, parseHrmsTaskResponse } from "@/infra/llm/llm-client";
import type { CommitRecord } from "@/core/types";

const sampleCommits: CommitRecord[] = [
  {
    sha: "abc123",
    message: "feat: add user login page",
    author: "JAESEOK",
    date: "2026-04-09T10:00:00Z",
    repoOwner: "devshinj",
    repoName: "my-app",
    branch: "main",
    filesChanged: ["src/app/login/page.tsx", "src/lib/auth.ts"],
    additions: 70,
    deletions: 5,
  },
  {
    sha: "def456",
    message: "fix: resolve auth redirect bug",
    author: "JAESEOK",
    date: "2026-04-09T14:00:00Z",
    repoOwner: "devshinj",
    repoName: "my-app",
    branch: "main",
    filesChanged: ["src/lib/auth.ts"],
    additions: 10,
    deletions: 3,
  },
];

describe("buildAnalysisPrompt", () => {
  it("builds a structured prompt for Gemini", () => {
    const prompt = buildAnalysisPrompt(sampleCommits, "my-app", "2026-04-09");
    expect(prompt).toContain("my-app");
    expect(prompt).toContain("2026-04-09");
    expect(prompt).toContain("feat: add user login page");
    expect(prompt).toContain("fix: resolve auth redirect bug");
    expect(prompt).toContain("JSON");
  });
});

describe("parseAnalysisResponse", () => {
  it("parses valid Gemini JSON response", () => {
    const response = JSON.stringify({
      tasks: [
        {
          title: "사용자 인증 시스템 구현",
          description: "로그인 페이지를 추가하고 인증 리다이렉트 버그를 수정함",
          complexity: "Medium",
        },
      ],
    });

    const tasks = parseAnalysisResponse(response, "my-app", "2026-04-09", ["abc123", "def456"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("사용자 인증 시스템 구현");
    expect(tasks[0].project).toBe("my-app");
    expect(tasks[0].date).toBe("2026-04-09");
    expect(tasks[0].complexity).toBe("Medium");
    expect(tasks[0].commitShas).toEqual(["abc123", "def456"]);
  });

  it("handles response with markdown code fences", () => {
    const response = '```json\n{"tasks":[{"title":"테스트","description":"설명","complexity":"Low"}]}\n```';
    const tasks = parseAnalysisResponse(response, "my-app", "2026-04-09", ["abc123"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("테스트");
  });
});

describe("buildHrmsTaskPrompt", () => {
  it("builds prompt with multiple repos and estimated time", () => {
    const prompt = buildHrmsTaskPrompt("CUVIA", "2026-06-10", [
      {
        repoName: "cuvia-frontend",
        commits: [sampleCommits[0]],
      },
      {
        repoName: "cuvia-backend",
        commits: [sampleCommits[1]],
      },
    ], 120);

    expect(prompt).toContain("2026-06-10");
    expect(prompt).toContain("cuvia-frontend");
    expect(prompt).toContain("cuvia-backend");
    expect(prompt).toContain("120");
    expect(prompt).toContain("TITLE:");
    expect(prompt).toContain("추상화·의역 금지");
    expect(prompt).toContain("feat: add user login page");
  });

  it("handles single repo", () => {
    const prompt = buildHrmsTaskPrompt("LogiCraft", "2026-06-10", [
      { repoName: "logicraft", commits: sampleCommits },
    ], 60);

    expect(prompt).toContain("logicraft");
    expect(prompt).toContain("2건");
    expect(prompt).toContain("feat: add user login page");
    expect(prompt).toContain("fix: resolve auth redirect bug");
  });
});

describe("parseHrmsTaskResponse", () => {
  it("extracts title and description", () => {
    const text = "TITLE: HRMS 업무 자동 등록 구현\n\n- 태스크 생성 API 연동\n- 스케줄러 구현";
    const result = parseHrmsTaskResponse(text);
    expect(result.title).toBe("HRMS 업무 자동 등록 구현");
    expect(result.description).toContain("태스크 생성 API 연동");
  });

  it("falls back to default title when TITLE: is missing", () => {
    const text = "- 작업 내용 1\n- 작업 내용 2";
    const result = parseHrmsTaskResponse(text);
    expect(result.title).toBe("업무 수행");
    expect(result.description).toContain("작업 내용 1");
  });
});
