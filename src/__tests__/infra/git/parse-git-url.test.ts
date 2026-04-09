import { describe, it, expect } from "vitest";
import { parseGitUrl, buildAuthenticatedUrl } from "@/infra/git/parse-git-url";

describe("parseGitUrl", () => {
  it("should parse GitHub HTTPS URL", () => {
    const result = parseGitUrl("https://github.com/octocat/hello-world.git");
    expect(result).toEqual({ host: "github.com", owner: "octocat", repo: "hello-world" });
  });

  it("should parse GitHub URL without .git suffix", () => {
    const result = parseGitUrl("https://github.com/octocat/hello-world");
    expect(result).toEqual({ host: "github.com", owner: "octocat", repo: "hello-world" });
  });

  it("should parse GitLab URL", () => {
    const result = parseGitUrl("https://gitlab.com/group/project.git");
    expect(result).toEqual({ host: "gitlab.com", owner: "group", repo: "project" });
  });

  it("should parse Gitea self-hosted URL", () => {
    const result = parseGitUrl("https://gitea.company.com/team/repo.git");
    expect(result).toEqual({ host: "gitea.company.com", owner: "team", repo: "repo" });
  });

  it("should parse URL with nested groups (GitLab subgroups)", () => {
    const result = parseGitUrl("https://gitlab.com/group/subgroup/project.git");
    expect(result).toEqual({ host: "gitlab.com", owner: "group/subgroup", repo: "project" });
  });

  it("should throw on invalid URL", () => {
    expect(() => parseGitUrl("not-a-url")).toThrow();
  });

  it("should throw on non-HTTPS URL", () => {
    expect(() => parseGitUrl("git@github.com:owner/repo.git")).toThrow();
  });
});

describe("buildAuthenticatedUrl", () => {
  it("should insert token into GitHub URL", () => {
    const result = buildAuthenticatedUrl("https://github.com/octocat/hello-world.git", "ghp_token123");
    expect(result).toBe("https://ghp_token123@github.com/octocat/hello-world.git");
  });

  it("should insert token into GitLab URL", () => {
    const result = buildAuthenticatedUrl("https://gitlab.com/group/project.git", "glpat-abc");
    expect(result).toBe("https://glpat-abc@gitlab.com/group/project.git");
  });

  it("should handle URL without .git suffix", () => {
    const result = buildAuthenticatedUrl("https://github.com/owner/repo", "token");
    expect(result).toBe("https://token@github.com/owner/repo");
  });
});
