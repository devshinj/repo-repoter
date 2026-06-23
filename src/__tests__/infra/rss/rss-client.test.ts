import { describe, it, expect } from "vitest";
import { buildRssUrl } from "@/infra/rss/rss-client";
import type { GitProviderMeta } from "@/core/types";

describe("buildRssUrl", () => {
  it("should build GitHub Atom URL", () => {
    const meta: GitProviderMeta = {
      type: "github",
      host: "github.com",
      apiBase: "https://api.github.com",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://github.com/owner/repo/commits/main.atom"
    );
  });

  it("should build GitHub URL with custom host", () => {
    const meta: GitProviderMeta = {
      type: "github",
      host: "github.enterprise.com",
      apiBase: "https://github.enterprise.com/api/v3",
    };
    expect(buildRssUrl(meta, "myorg", "myrepo", "develop")).toBe(
      "https://github.enterprise.com/myorg/myrepo/commits/develop.atom"
    );
  });

  it("should build GitLab Atom URL", () => {
    const meta: GitProviderMeta = {
      type: "gitlab",
      host: "gitlab.com",
      apiBase: "https://gitlab.com/api/v4",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://gitlab.com/owner/repo/-/commits/main?format=atom"
    );
  });

  it("should build GitLab self-hosted URL", () => {
    const meta: GitProviderMeta = {
      type: "gitlab",
      host: "gitlab.internal.com",
      apiBase: "https://gitlab.internal.com/api/v4",
    };
    expect(buildRssUrl(meta, "team", "project", "feat/new")).toBe(
      "https://gitlab.internal.com/team/project/-/commits/feat/new?format=atom"
    );
  });

  it("should build Gitea RSS URL", () => {
    const meta: GitProviderMeta = {
      type: "gitea",
      host: "gitea.internal.com",
      apiBase: "https://gitea.internal.com/api/v1",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://gitea.internal.com/owner/repo.rss"
    );
  });

  it("should build Gitea URL (branch is ignored for RSS)", () => {
    const meta: GitProviderMeta = {
      type: "gitea",
      host: "git.example.com",
      apiBase: "https://git.example.com/api/v1",
    };
    expect(buildRssUrl(meta, "user", "project", "develop")).toBe(
      "https://git.example.com/user/project.rss"
    );
  });

  it("should build Bitbucket RSS URL", () => {
    const meta: GitProviderMeta = {
      type: "bitbucket",
      host: "bitbucket.org",
      apiBase: "https://api.bitbucket.org/2.0",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://bitbucket.org/owner/repo/rss"
    );
  });

  it("should handle trailing slashes in host", () => {
    const meta: GitProviderMeta = {
      type: "github",
      host: "github.com/",
      apiBase: "https://api.github.com",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://github.com/owner/repo/commits/main.atom"
    );
  });

  it("should use HTTP for localhost", () => {
    const meta: GitProviderMeta = {
      type: "gitea",
      host: "localhost:3000",
      apiBase: "http://localhost:3000/api/v1",
    };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "http://localhost:3000/owner/repo.rss"
    );
  });
});
