import type { RemoteRepository } from "@/core/types";

export interface ApiCommit {
  sha: string;
  message: string;
  author: string;
  date: string;           // ISO 8601
  additions: number;
  deletions: number;
  filesChanged: string[];
}

export interface ApiBranch {
  name: string;
  isDefault: boolean;
}

export interface ListCommitsOptions {
  branch?: string;
  since?: string;   // ISO 8601
  author?: string;
  perPage?: number;
  page?: number;
}

export interface GitProviderClient {
  listRepos(): Promise<RemoteRepository[]>;
  listBranches(owner: string, repo: string): Promise<ApiBranch[]>;
  listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]>;
  getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit>;
  getCommitDiff(owner: string, repo: string, sha: string): Promise<string>;
  getRepoLanguage(owner: string, repo: string): Promise<string | null>;
}
