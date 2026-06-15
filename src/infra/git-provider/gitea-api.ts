import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

export function normalizeGiteaRepo(apiRepo: any): RemoteRepository {
  return {
    name: apiRepo.name,
    owner: apiRepo.owner.login,
    fullName: apiRepo.full_name,
    cloneUrl: apiRepo.clone_url,
    defaultBranch: apiRepo.default_branch,
    language: apiRepo.language || null,
    isPrivate: apiRepo.private,
    description: apiRepo.description ?? null,
  };
}

export async function listGiteaRepos(apiBase: string, token: string): Promise<RemoteRepository[]> {
  const repos: RemoteRepository[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${apiBase}/user/repos?page=${page}&limit=50&sort=updated`, {
      headers: { Authorization: `token ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Gitea API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    repos.push(...data.map(normalizeGiteaRepo));
    if (data.length < 50) break;
    page++;
  }

  return repos;
}

export class GiteaProvider implements GitProviderClient {
  private apiBase: string;
  private token: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.token = token;
    this.headers = { Authorization: `token ${token}` };
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listGiteaRepos(this.apiBase, this.token);
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/branches?page=${page}&limit=50`, { headers: this.headers });
      if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      branches.push(...data.map((b: any) => ({ name: b.name, isDefault: false })));
      if (data.length < 50) break;
      page++;
    }
    try {
      const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}`, { headers: this.headers });
      if (res.ok) {
        const repoInfo = await res.json();
        for (const b of branches) b.isDefault = b.name === repoInfo.default_branch;
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params = new URLSearchParams();
    if (options?.branch) params.set("sha", options.branch);
    if (options?.since) params.set("since", options.since);
    params.set("limit", String(options?.perPage ?? 50));
    if (options?.page) params.set("page", String(options.page));
    params.set("stat", "true");
    const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/commits?${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    const data = await res.json();
    return (data as any[]).map((c: any) => ({
      sha: c.sha, message: c.commit?.message || "", author: c.commit?.author?.name || "unknown",
      date: c.commit?.author?.date || c.created || new Date().toISOString(),
      additions: c.stats?.additions ?? 0,
      deletions: c.stats?.deletions ?? 0,
      filesChanged: Array.isArray(c.files) ? c.files.map((f: any) => f.filename).filter(Boolean) : [],
      statsLoaded: true,
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/git/commits/${sha}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    const data = await res.json();
    return {
      sha: data.sha, message: data.message || data.commit?.message || "",
      author: data.author?.login || data.commit?.author?.name || "unknown",
      date: data.created || data.commit?.author?.date || new Date().toISOString(),
      additions: data.stats?.additions ?? 0,
      deletions: data.stats?.deletions ?? 0,
      filesChanged: [],
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/git/commits/${sha}.diff`, { headers: this.headers });
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    return res.text();
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/languages`, { headers: this.headers });
      if (!res.ok) return null;
      const data = await res.json();
      const entries = Object.entries(data) as [string, number][];
      if (entries.length === 0) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    } catch { return null; }
  }
}
