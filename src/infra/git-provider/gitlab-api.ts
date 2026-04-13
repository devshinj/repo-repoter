import type { RemoteRepository } from "@/core/types";

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
