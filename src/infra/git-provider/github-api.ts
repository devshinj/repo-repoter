import { Octokit } from "@octokit/rest";
import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

export function normalizeGitHubRepo(apiRepo: any): RemoteRepository {
  return {
    name: apiRepo.name,
    owner: apiRepo.owner.login,
    fullName: apiRepo.full_name,
    cloneUrl: apiRepo.clone_url,
    defaultBranch: apiRepo.default_branch,
    language: apiRepo.language ?? null,
    isPrivate: apiRepo.private,
    description: apiRepo.description ?? null,
  };
}

export async function listGitHubRepos(token: string): Promise<RemoteRepository[]> {
  const client = new Octokit({ auth: token });
  const repos: RemoteRepository[] = [];
  let page = 1;

  while (true) {
    const { data } = await client.rest.repos.listForAuthenticatedUser({
      visibility: "all",
      affiliation: "owner,collaborator,organization_member",
      sort: "updated",
      per_page: 100,
      page,
    });

    if (data.length === 0) break;
    repos.push(...data.map(normalizeGitHubRepo));
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

export class GitHubProvider implements GitProviderClient {
  private client: Octokit;

  constructor(token: string) {
    this.client = new Octokit({ auth: token });
  }

  async listRepos(): Promise<RemoteRepository[]> {
    const repos: RemoteRepository[] = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.rest.repos.listForAuthenticatedUser({
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
        per_page: 100,
        page,
      });
      if (data.length === 0) break;
      repos.push(...data.map(normalizeGitHubRepo));
      if (data.length < 100) break;
      page++;
    }
    return repos;
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.rest.repos.listBranches({
        owner, repo, per_page: 100, page,
      });
      if (data.length === 0) break;
      branches.push(...data.map((b: any) => ({ name: b.name, isDefault: false })));
      if (data.length < 100) break;
      page++;
    }
    try {
      const { data: repoInfo } = await this.client.rest.repos.get({ owner, repo });
      const defaultBranch = repoInfo.default_branch;
      for (const b of branches) {
        if (b.name === defaultBranch) b.isDefault = true;
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params: any = { owner, repo, per_page: options?.perPage ?? 100 };
    if (options?.branch) params.sha = options.branch;
    if (options?.since) params.since = options.since;
    if (options?.author) params.author = options.author;
    if (options?.page) params.page = options.page;

    const { data } = await this.client.rest.repos.listCommits(params);

    return data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || "unknown",
      date: c.commit.author?.date || new Date().toISOString(),
      additions: 0,
      deletions: 0,
      filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const { data } = await this.client.rest.repos.getCommit({ owner, repo, ref: sha });
    const files = data.files || [];
    return {
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name || "unknown",
      date: data.commit.author?.date || new Date().toISOString(),
      additions: files.reduce((sum: number, f: any) => sum + (f.additions || 0), 0),
      deletions: files.reduce((sum: number, f: any) => sum + (f.deletions || 0), 0),
      filesChanged: files.map((f: any) => f.filename),
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const { data } = await this.client.rest.repos.getCommit({
      owner, repo, ref: sha,
      mediaType: { format: "diff" },
    });
    return data as unknown as string;
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const { data } = await this.client.rest.repos.get({ owner, repo });
      return data.language ?? null;
    } catch {
      return null;
    }
  }
}
