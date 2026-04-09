// src/infra/git/git-client.ts
import { execFile } from "child_process";
import { promisify } from "util";
import type { CommitRecord } from "@/core/types";
import { buildAuthenticatedUrl, parseGitUrl } from "@/infra/git/parse-git-url";

const execFileAsync = promisify(execFile);

const logFormat = "--format=%H%n%an%n%aI%n%s%n---END---";

export async function cloneRepository(cloneUrl: string, destPath: string, token: string): Promise<void> {
  const authUrl = buildAuthenticatedUrl(cloneUrl, token);
  await execFileAsync("git", ["clone", "--bare", authUrl, destPath], { timeout: 120_000 });
}

export async function pullRepository(repoPath: string): Promise<void> {
  await execFileAsync("git", ["--git-dir", repoPath, "fetch", "origin"], { timeout: 60_000 });
}

export async function getCommitsSince(
  repoPath: string,
  branch: string,
  cloneUrl: string,
  sinceSha?: string | null
): Promise<CommitRecord[]> {
  const range = sinceSha ? `${sinceSha}..origin/${branch}` : `origin/${branch}`;
  const args = ["--git-dir", repoPath, "log", range, logFormat, "--numstat"];

  const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (!stdout.trim()) return [];

  const { owner, repo: repoName } = parseGitUrl(cloneUrl);
  return parseGitLog(stdout, owner, repoName, branch);
}

export async function getCommitDiff(repoPath: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["--git-dir", repoPath, "diff", `${sha}^..${sha}`],
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

function parseGitLog(output: string, owner: string, repoName: string, branch: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  const entries = output.split("---END---\n").filter((e) => e.trim());

  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    if (lines.length < 4) continue;

    const sha = lines[0];
    const author = lines[1];
    const date = lines[2];
    const message = lines[3];

    const statLines = lines.slice(4).filter((l) => l.trim());
    let additions = 0;
    let deletions = 0;
    const filesChanged: string[] = [];

    for (const statLine of statLines) {
      const match = statLine.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        additions += match[1] === "-" ? 0 : parseInt(match[1], 10);
        deletions += match[2] === "-" ? 0 : parseInt(match[2], 10);
        filesChanged.push(match[3]);
      }
    }

    commits.push({
      sha,
      message,
      author,
      date,
      repoOwner: owner,
      repoName,
      branch,
      filesChanged,
      additions,
      deletions,
    });
  }

  return commits;
}
