import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

export function normalizeBitbucketRepo(apiRepo: any): RemoteRepository {
  const cloneLink = apiRepo.links?.clone?.find((l: any) => l.name === "https");
  return {
    name: apiRepo.name,
    owner: apiRepo.workspace?.slug || apiRepo.owner?.username || "",
    fullName: apiRepo.full_name,
    cloneUrl: cloneLink?.href || "",
    defaultBranch: apiRepo.mainbranch?.name || "main",
    language: apiRepo.language || null,
    isPrivate: apiRepo.is_private,
    description: apiRepo.description ?? null,
  };
}

export async function listBitbucketRepos(apiBase: string, token: string): Promise<RemoteRepository[]> {
  const repos: RemoteRepository[] = [];
  let nextUrl: string | null = `${apiBase}/repositories?role=member&pagelen=100`;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: `Basic ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Bitbucket API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (Array.isArray(data.values)) {
      repos.push(...data.values.map(normalizeBitbucketRepo));
    }
    nextUrl = data.next || null;
  }

  return repos;
}

export class BitbucketProvider implements GitProviderClient {
  private apiBase: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.headers = { Authorization: `Basic ${token}` };
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listBitbucketRepos(this.apiBase, Object.values(this.headers)[0].replace("Basic ", ""));
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let nextUrl: string | null = `${this.apiBase}/repositories/${owner}/${repo}/refs/branches?pagelen=100`;
    while (nextUrl) {
      const res: Response = await fetch(nextUrl, { headers: this.headers });
      if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
      const data: any = await res.json();
      if (Array.isArray(data.values)) {
        branches.push(...data.values.map((b: any) => ({ name: b.name, isDefault: false })));
      }
      nextUrl = data.next || null;
    }
    try {
      const res = await fetch(`${this.apiBase}/repositories/${owner}/${repo}`, { headers: this.headers });
      if (res.ok) {
        const repoInfo = await res.json();
        const defaultName = repoInfo.mainbranch?.name;
        if (defaultName) for (const b of branches) b.isDefault = b.name === defaultName;
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params = new URLSearchParams();
    if (options?.branch) params.set("include", options.branch);
    params.set("pagelen", String(options?.perPage ?? 30));
    if (options?.page) params.set("page", String(options.page));
    if (options?.since) params.set("q", `date > ${options.since.slice(0, 10)}`);
    const res = await fetch(`${this.apiBase}/repositories/${owner}/${repo}/commits?${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
    const data = await res.json();
    return (data.values as any[] || []).map((c: any) => ({
      sha: c.hash, message: c.message || "",
      author: c.author?.raw?.split("<")[0]?.trim() || c.author?.user?.display_name || "unknown",
      date: c.date || new Date().toISOString(),
      additions: 0, deletions: 0, filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const commitRes = await fetch(`${this.apiBase}/repositories/${owner}/${repo}/commit/${sha}`, { headers: this.headers });
    if (!commitRes.ok) throw new Error(`Bitbucket API error: ${commitRes.status}`);
    const commitData = await commitRes.json();
    const diffRes = await fetch(`${this.apiBase}/repositories/${owner}/${repo}/diffstat/${sha}`, { headers: this.headers });
    let files: string[] = [];
    let additions = 0, deletions = 0;
    if (diffRes.ok) {
      const diffData = await diffRes.json();
      if (Array.isArray(diffData.values)) {
        for (const entry of diffData.values) {
          files.push(entry.new?.path || entry.old?.path || "");
          additions += entry.lines_added || 0;
          deletions += entry.lines_removed || 0;
        }
      }
    }
    return {
      sha: commitData.hash, message: commitData.message || "",
      author: commitData.author?.raw?.split("<")[0]?.trim() || "unknown",
      date: commitData.date || new Date().toISOString(),
      additions, deletions, filesChanged: files.filter(Boolean),
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/repositories/${owner}/${repo}/diff/${sha}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
    return res.text();
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiBase}/repositories/${owner}/${repo}`, { headers: this.headers });
      if (!res.ok) return null;
      const data = await res.json();
      return data.language || null;
    } catch { return null; }
  }
}
