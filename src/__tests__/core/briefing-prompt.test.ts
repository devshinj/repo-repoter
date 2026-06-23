import { describe, it, expect } from "vitest";
import {
  buildBriefingPrompt,
  buildMilestoneParsePrompt,
  parseMilestoneParseResponse,
  buildGroupSuggestionPrompt,
  parseGroupSuggestionResponse,
} from "@/core/feed/briefing-prompt";
import type { RssCommit } from "@/core/feed/feed-types";
import type { Milestone } from "@/core/project/project-types";

describe("buildBriefingPrompt", () => {
  it("should include commits grouped by author", () => {
    const commits: RssCommit[] = [
      {
        repositoryId: 1,
        sha: "a1",
        authorName: "jaeseok",
        message: "feat: 로그인",
        committedAt: "2026-06-23T10:00:00Z",
      },
      {
        repositoryId: 1,
        sha: "a2",
        authorName: "minsu",
        message: "fix: 버그",
        committedAt: "2026-06-23T11:00:00Z",
      },
    ];
    const prompt = buildBriefingPrompt({ scopeName: "MyProject", commits, milestones: [] });
    expect(prompt).toContain("jaeseok");
    expect(prompt).toContain("minsu");
    expect(prompt).toContain("feat: 로그인");
    expect(prompt).toContain("MyProject");
  });

  it("should include milestone context when milestones exist", () => {
    const milestone: Milestone = {
      id: 1,
      userId: "u1",
      projectId: 1,
      repositoryId: null,
      title: "MVP 출시",
      rawInput: "다음달까지 MVP",
      deadline: "2026-07-05",
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const prompt = buildBriefingPrompt({
      scopeName: "MyProject",
      commits: [
        {
          repositoryId: 1,
          sha: "a1",
          authorName: "x",
          message: "m",
          committedAt: "2026-06-23T10:00:00Z",
        },
      ],
      milestones: [milestone],
    });
    expect(prompt).toContain("MVP 출시");
    expect(prompt).toContain("2026-07-05");
  });
});

describe("buildMilestoneParsePrompt", () => {
  it("should include raw input and current date", () => {
    const prompt = buildMilestoneParsePrompt(
      "다음 주 금요일까지 로그인 완성",
      "2026-06-23",
      [{ id: 1, name: "MyProject" }],
      [{ id: 10, name: "frontend-app" }]
    );
    expect(prompt).toContain("다음 주 금요일까지 로그인 완성");
    expect(prompt).toContain("2026-06-23");
    expect(prompt).toContain("MyProject");
    expect(prompt).toContain("frontend-app");
  });
});

describe("parseMilestoneParseResponse", () => {
  it("should parse valid JSON response", () => {
    const response = JSON.stringify({
      title: "로그인 페이지 완성",
      deadline: "2026-06-27",
      suggested_scope: {
        type: "repository",
        id: 10,
        name: "frontend-app",
        confidence: "high",
      },
    });
    const result = parseMilestoneParseResponse(response);
    expect(result.title).toBe("로그인 페이지 완성");
    expect(result.deadline).toBe("2026-06-27");
    expect(result.suggestedScope?.type).toBe("repository");
  });

  it("should handle code-fenced JSON", () => {
    const response =
      "```json\n" +
      JSON.stringify({
        title: "Test",
        deadline: null,
        suggested_scope: null,
      }) +
      "\n```";
    const result = parseMilestoneParseResponse(response);
    expect(result.title).toBe("Test");
  });
});

describe("buildGroupSuggestionPrompt", () => {
  it("should include repository info", () => {
    const prompt = buildGroupSuggestionPrompt([
      {
        id: 1,
        name: "frontend-app",
        language: "TypeScript",
        recentMessages: ["feat: UI"],
      },
      {
        id: 2,
        name: "frontend-design",
        language: "TypeScript",
        recentMessages: ["fix: 색상"],
      },
    ]);
    expect(prompt).toContain("frontend-app");
    expect(prompt).toContain("frontend-design");
  });
});

describe("parseGroupSuggestionResponse", () => {
  it("should return null for 'null' response", () => {
    expect(parseGroupSuggestionResponse("null")).toBeNull();
  });

  it("should parse valid suggestion", () => {
    const response = JSON.stringify({
      suggestion: "프론트엔드 관련 저장소",
      repositories: [
        { id: 1, name: "frontend-app" },
        { id: 2, name: "frontend-design" },
      ],
    });
    const result = parseGroupSuggestionResponse(response);
    expect(result?.suggestion).toBe("프론트엔드 관련 저장소");
    expect(result?.repositories).toHaveLength(2);
  });
});
