// src/infra/git-provider/index.ts
import type { GitProviderMeta } from "@/core/types";
import type { GitProviderClient } from "@/infra/git-provider/types";
import { GitHubProvider } from "@/infra/git-provider/github-api";
import { GiteaProvider } from "@/infra/git-provider/gitea-api";
import { GitLabProvider } from "@/infra/git-provider/gitlab-api";
import { BitbucketProvider } from "@/infra/git-provider/bitbucket-api";

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
