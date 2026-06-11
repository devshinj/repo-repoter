import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

export function normalizeGitLabRepo(apiRepo: any): RemoteRepository {
  return {
    name: apiRepo.name,
    owner: apiRepo.namespace?.path || apiRepo.namespace?.name || "",
    fullName: apiRepo.path_with_namespace,
    cloneUrl: apiRepo.http_url_to_repo,
    defaultBranch: apiRepo.default_branch || "main",
    language: null,
    isPrivate: apiRepo.visibility === "private",
    description: apiRepo.description ?? null,
  };
}

export async function listGitLabRepos(apiBase: string, token: string): Promise<RemoteRepository[]> {
  const repos: RemoteRepository[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${apiBase}/projects?membership=true&per_page=100&order_by=updated_at&page=${page}`,
      { headers: { "PRIVATE-TOKEN": token } },
    );

    if (!res.ok) {
      throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    repos.push(...data.map(normalizeGitLabRepo));
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

export class GitLabProvider implements GitProviderClient {
  private apiBase: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.headers = { "PRIVATE-TOKEN": token };
  }

  private encodeProject(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listGitLabRepos(this.apiBase, Object.values(this.headers)[0]);
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const projectId = this.encodeProject(owner, repo);
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${this.apiBase}/projects/${projectId}/repository/branches?per_page=100&page=${page}`, { headers: this.headers });
      if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      branches.push(...data.map((b: any) => ({ name: b.name, isDefault: b.default ?? false })));
      if (data.length < 100) break;
      page++;
    }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const projectId = this.encodeProject(owner, repo);
    const params = new URLSearchParams();
    if (options?.branch) params.set("ref_name", options.branch);
    if (options?.since) params.set("since", options.since);
    params.set("per_page", String(options?.perPage ?? 100));
    if (options?.page) params.set("page", String(options.page));
    const res = await fetch(`${this.apiBase}/projects/${projectId}/repository/commits?${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const data = await res.json();
    return (data as any[]).map((c: any) => ({
      sha: c.id, message: c.message || "", author: c.author_name || "unknown",
      date: c.authored_date || c.created_at || new Date().toISOString(),
      additions: 0, deletions: 0, filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const projectId = this.encodeProject(owner, repo);
    const commitRes = await fetch(`${this.apiBase}/projects/${projectId}/repository/commits/${sha}`, { headers: this.headers });
    if (!commitRes.ok) throw new Error(`GitLab API error: ${commitRes.status}`);
    const commitData = await commitRes.json();
    const diffRes = await fetch(`${this.apiBase}/projects/${projectId}/repository/commits/${sha}/diff`, { headers: this.headers });
    let files: string[] = [];
    if (diffRes.ok) {
      const diffData = await diffRes.json();
      if (Array.isArray(diffData)) files = diffData.map((d: any) => d.new_path || d.old_path);
    }
    return {
      sha: commitData.id, message: commitData.message || "", author: commitData.author_name || "unknown",
      date: commitData.authored_date || commitData.created_at || new Date().toISOString(),
      additions: commitData.stats?.additions ?? 0, deletions: commitData.stats?.deletions ?? 0, filesChanged: files,
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const projectId = this.encodeProject(owner, repo);
    const res = await fetch(`${this.apiBase}/projects/${projectId}/repository/commits/${sha}/diff`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) return data.map((d: any) => d.diff || "").join("\n");
    return JSON.stringify(data);
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const projectId = this.encodeProject(owner, repo);
      const res = await fetch(`${this.apiBase}/projects/${projectId}/languages`, { headers: this.headers });
      if (!res.ok) return null;
      const data = await res.json();
      const entries = Object.entries(data) as [string, number][];
      if (entries.length === 0) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    } catch { return null; }
  }
}
