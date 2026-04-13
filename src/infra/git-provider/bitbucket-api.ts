import type { RemoteRepository } from "@/core/types";

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
