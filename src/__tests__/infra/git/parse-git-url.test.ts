import { describe, it, expect } from "vitest";
import { parseGitUrl, buildAuthEnv } from "@/infra/git/parse-git-url";

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

  it("should parse HTTP URL with custom port (self-hosted Gitea)", () => {
    const result = parseGitUrl("http://gitea.cudodev.synology.me:5001/infra_dev/cuvia_tta_web.git");
    expect(result).toEqual({ host: "gitea.cudodev.synology.me:5001", owner: "infra_dev", repo: "cuvia_tta_web" });
  });

  it("should throw on invalid URL", () => {
    expect(() => parseGitUrl("not-a-url")).toThrow();
  });

  it("should throw on SSH URL", () => {
    expect(() => parseGitUrl("git@github.com:owner/repo.git")).toThrow();
  });
});

describe("buildAuthEnv", () => {
  it("should return GIT_CONFIG env vars with Basic auth header", () => {
    const env = buildAuthEnv("mytoken");
    const encoded = Buffer.from("oauth2:mytoken").toString("base64");
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
    });
  });
});
