// src/infra/git-provider/index.ts
import type { GitProviderMeta } from "@/core/types";
import type { GitProviderClient } from "@/infra/git-provider/types";
import { GitHubProvider } from "@/infra/git-provider/github-api";
import { GiteaProvider } from "@/infra/git-provider/gitea-api";
import { GitLabProvider } from "@/infra/git-provider/gitlab-api";
import { BitbucketProvider } from "@/infra/git-provider/bitbucket-api";

/** clone_url에서 호스트를 추출하여 provider 메타 추론. metadata가 없을 때 fallback으로 사용 */
export function inferProviderMeta(cloneUrl?: string): GitProviderMeta {
  if (!cloneUrl) return { type: "github", host: "github.com", apiBase: "https://api.github.com" };
  try {
    const host = new URL(cloneUrl).hostname;
    if (host === "github.com") {
      return { type: "github", host, apiBase: "https://api.github.com" };
    }
    if (host.includes("gitlab")) {
      return { type: "gitlab", host, apiBase: `https://${host}/api/v4` };
    }
    if (host.includes("bitbucket")) {
      return { type: "bitbucket", host, apiBase: `https://api.bitbucket.org/2.0` };
    }
    // github.com이 아닌 나머지는 self-hosted → Gitea로 추정
    return { type: "gitea", host, apiBase: `https://${host}/api/v1` };
  } catch {
    return { type: "github", host: "github.com", apiBase: "https://api.github.com" };
  }
}

export function createGitProvider(meta: GitProviderMeta, token: string): GitProviderClient {
  switch (meta.type) {
    case "github":
      return new GitHubProvider(token);
    case "gitea":
      return new GiteaProvider(meta.apiBase, token);
    case "gitlab":
      return new GitLabProvider(meta.apiBase, token);
    case "bitbucket":
      return new BitbucketProvider(meta.apiBase, token);
    default:
      throw new Error(`Unsupported git provider: ${(meta as any).type}`);
  }
}

export type { GitProviderClient } from "@/infra/git-provider/types";
export type { ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";
