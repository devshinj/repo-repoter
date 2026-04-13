// src/infra/github/github-client.ts
import { Octokit } from "@octokit/rest";
import type { CommitRecord } from "@/core/types";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

export async function fetchCommitsSince(
  owner: string,
  repo: string,
  branch: string,
  sinceSha: string | null
): Promise<CommitRecord[]> {
  const client = getOctokit();

  const params: Parameters<typeof client.rest.repos.listCommits>[0] = {
    owner,
    repo,
    sha: branch,
    per_page: 100,
  };

  const { data: commits } = await client.rest.repos.listCommits(params);

  // sinceSha 이후의 커밋만 필터링
  let filtered = commits;
  if (sinceSha) {
    const idx = commits.findIndex((c) => c.sha === sinceSha);
    filtered = idx === -1 ? commits : commits.slice(0, idx);
  }

  // 각 커밋의 상세 정보 (파일 목록) 가져오기
  const detailed = await Promise.all(
    filtered.map(async (c) => {
      const { data } = await client.rest.repos.getCommit({ owner, repo, ref: c.sha });
      return data;
    })
  );

  return buildCommitRecords(detailed, owner, repo, branch);
}

export function buildCommitRecords(
  apiCommits: any[],
  owner: string,
  repo: string,
  branch: string
): CommitRecord[] {
  return apiCommits.map((c) => {
    const files = c.files || [];
    return {
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || "unknown",
      date: c.commit.author?.date || new Date().toISOString(),
      repoOwner: owner,
      repoName: repo,
      branch,
      filesChanged: files.map((f: any) => f.filename),
      additions: files.reduce((sum: number, f: any) => sum + (f.additions || 0), 0),
      deletions: files.reduce((sum: number, f: any) => sum + (f.deletions || 0), 0),
    };
  });
}

export async function fetchRepoLanguage(owner: string, repo: string, token?: string): Promise<string | null> {
  try {
    const client = token ? new Octokit({ auth: token }) : getOctokit();
    const { data } = await client.rest.repos.get({ owner, repo });
    return data.language ?? null;
  } catch {
    return null;
  }
}

export async function fetchCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
  const client = getOctokit();
  const { data } = await client.rest.repos.getCommit({
    owner,
    repo,
    ref: sha,
    mediaType: { format: "diff" },
  });
  return data as unknown as string;
}
