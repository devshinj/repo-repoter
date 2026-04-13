// src/infra/git/git-client.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { access, rm } from "fs/promises";
import type { CommitRecord } from "@/core/types";
import { buildAuthenticatedUrl, parseGitUrl } from "@/infra/git/parse-git-url";

const execFileAsync = promisify(execFile);

export class RepoNotFoundError extends Error {
  constructor(repoPath: string) {
    super(`Bare repository not found: ${repoPath}`);
    this.name = "RepoNotFoundError";
  }
}

async function assertRepoExists(repoPath: string): Promise<void> {
  try {
    await access(repoPath);
  } catch {
    throw new RepoNotFoundError(repoPath);
  }
}

const logFormat = "--format=%H%n%an%n%aI%n%s%n---END---";

export async function cloneRepository(cloneUrl: string, destPath: string, token: string): Promise<void> {
  // 이전 실패로 남은 디렉토리가 있으면 제거
  try {
    await access(destPath);
    await rm(destPath, { recursive: true, force: true });
  } catch { /* 디렉토리 없으면 무시 */ }

  const authUrl = buildAuthenticatedUrl(cloneUrl, token);
  await execFileAsync("git", ["clone", "--bare", authUrl, destPath], { timeout: 120_000 });
  // bare clone은 fetch refspec이 없으므로 수동 추가
  await execFileAsync(
    "git",
    ["--git-dir", destPath, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
    { timeout: 5_000 }
  );
  // 첫 fetch로 remote tracking refs 생성
  await execFileAsync(
    "git",
    ["--git-dir", destPath, "fetch", "origin"],
    { timeout: 60_000 }
  );
}

export async function pullRepository(repoPath: string): Promise<void> {
  await assertRepoExists(repoPath);
  await execFileAsync(
    "git",
    ["--git-dir", repoPath, "fetch", "origin"],
    { timeout: 60_000 }
  );
}

export async function getCommitsSince(
  repoPath: string,
  branch: string,
  cloneUrl: string,
  sinceSha?: string | null
): Promise<CommitRecord[]> {
  // bare repo에서 refs/remotes/origin/{branch} 또는 refs/heads/{branch} 모두 시도
  let ref: string;
  try {
    await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
    ref = `origin/${branch}`;
  } catch {
    // fallback: bare clone이 refs/heads에 직접 저장한 경우
    ref = branch;
  }

  const range = sinceSha ? `${sinceSha}..${ref}` : ref;
  const args = ["--git-dir", repoPath, "log", range, logFormat, "--numstat"];

  const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (!stdout.trim()) return [];

  const { owner, repo: repoName } = parseGitUrl(cloneUrl);
  return parseGitLog(stdout, owner, repoName, branch);
}

export async function getBranches(repoPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["--git-dir", repoPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"],
    { timeout: 10_000 }
  );
  if (!stdout.trim()) {
    // fallback: bare clone이 refs/heads에 직접 저장한 경우
    const { stdout: headStdout } = await execFileAsync(
      "git",
      ["--git-dir", repoPath, "for-each-ref", "--format=%(refname:short)", "refs/heads/"],
      { timeout: 10_000 }
    );
    return headStdout.trim().split("\n").filter(Boolean);
  }
  return stdout.trim().split("\n").filter(Boolean).map((ref) => ref.replace("origin/", ""));
}

export interface BranchCommitSummary {
  branch: string;
  commits: { sha: string; message: string; author: string; date: string }[];
}

export async function getCommitsForDate(
  repoPath: string,
  branches: string[],
  date: string,
  authors?: string[]
): Promise<BranchCommitSummary[]> {
  // --since/--until은 committer date + UTC 기준이라 author date(로컬 시간대)와 불일치.
  // 전후 1일 여유를 두고 가져온 뒤 author date 문자열로 필터링한다.
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevStr = prevDate.toISOString().slice(0, 10);
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 2);
  const nextStr = nextDate.toISOString().slice(0, 10);

  const results: BranchCommitSummary[] = [];
  const seenShas = new Set<string>();

  for (const branch of branches) {
    let ref: string;
    try {
      await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
      ref = `origin/${branch}`;
    } catch {
      ref = branch;
    }

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["--git-dir", repoPath, "log", ref, `--since=${prevStr}`, `--until=${nextStr}`, ...(authors?.map((a) => `--author=${a}`) ?? []), "--format=%H%n%an%n%aI%n%s%n---ENTRY---"],
        { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 }
      );

      if (!stdout.trim()) continue;

      const commits: BranchCommitSummary["commits"] = [];
      const entries = stdout.split("---ENTRY---").filter((e) => e.trim());
      for (const entry of entries) {
        const lines = entry.trim().split("\n");
        if (lines.length < 4) continue;
        const sha = lines[0];
        const authorDate = lines[2].slice(0, 10); // YYYY-MM-DD (로컬 시간대)
        if (authorDate !== date) continue;
        if (seenShas.has(sha)) continue;
        seenShas.add(sha);
        commits.push({ sha, author: lines[1], date: lines[2], message: lines[3] });
      }

      if (commits.length > 0) {
        results.push({ branch, commits });
      }
    } catch {
      // 무시
    }
  }

  return results;
}

export async function getDetailedCommitsForDate(
  repoPath: string,
  branch: string,
  cloneUrl: string,
  date: string,
  authors?: string[]
): Promise<CommitRecord[]> {
  let ref: string;
  try {
    await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
    ref = `origin/${branch}`;
  } catch {
    ref = branch;
  }

  // 전후 1일 여유로 가져온 뒤 author date로 필터
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 2);

  const args = [
    "--git-dir", repoPath, "log", ref,
    `--since=${prevDate.toISOString().slice(0, 10)}`,
    `--until=${nextDate.toISOString().slice(0, 10)}`,
    ...(authors?.map((a) => `--author=${a}`) ?? []),
    logFormat, "--numstat",
  ];

  const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (!stdout.trim()) return [];

  const { owner, repo: repoName } = parseGitUrl(cloneUrl);
  const allCommits = parseGitLog(stdout, owner, repoName, branch);

  // author date 기준 필터
  return allCommits.filter((c) => c.date.slice(0, 10) === date);
}

export async function getCommitCountsByDate(
  repoPath: string,
  branches: string[],
  since?: string,
  until?: string,
  authors?: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const seenShas = new Set<string>();

  for (const branch of branches) {
    let ref: string;
    try {
      await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
      ref = `origin/${branch}`;
    } catch {
      ref = branch;
    }

    const args = ["--git-dir", repoPath, "log", ref, "--format=%H %aI"];
    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);
    if (authors?.length) args.push(...authors.map((a) => `--author=${a}`));

    try {
      const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      for (const line of stdout.trim().split("\n")) {
        if (!line) continue;
        const sha = line.slice(0, 40);
        if (seenShas.has(sha)) continue;
        seenShas.add(sha);
        const date = line.slice(41, 51); // YYYY-MM-DD
        counts[date] = (counts[date] || 0) + 1;
      }
    } catch {
      // 브랜치가 유효하지 않으면 무시
    }
  }

  return counts;
}

export async function getRecentCommits(
  repoPath: string,
  branch: string,
  cloneUrl: string,
  limit: number = 50
): Promise<CommitRecord[]> {
  let ref: string;
  try {
    await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
    ref = `origin/${branch}`;
  } catch {
    ref = branch;
  }

  const args = ["--git-dir", repoPath, "log", ref, `-${limit}`, logFormat, "--numstat"];
  const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (!stdout.trim()) return [];

  const { owner, repo: repoName } = parseGitUrl(cloneUrl);
  return parseGitLog(stdout, owner, repoName, branch);
}

export async function getCommitDiff(repoPath: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["--git-dir", repoPath, "diff-tree", "-p", "--root", sha],
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

export interface CacheableCommit {
  sha: string;
  branch: string;
  author: string;
  message: string;
  committedDate: string;   // YYYY-MM-DD
  committedAt: string;     // ISO 8601
}

export async function getCommitsForCache(
  repoPath: string,
  branches: string[],
  since?: string
): Promise<CacheableCommit[]> {
  const commits: CacheableCommit[] = [];
  const seenShas = new Set<string>();

  for (const branch of branches) {
    let ref: string;
    try {
      await execFileAsync("git", ["--git-dir", repoPath, "rev-parse", "--verify", `origin/${branch}`], { timeout: 5_000 });
      ref = `origin/${branch}`;
    } catch {
      ref = branch;
    }

    const args = ["--git-dir", repoPath, "log", ref, "--format=%H%n%an%n%aI%n%s%n---END---"];
    if (since) args.push(`--since=${since}`);

    try {
      const { stdout } = await execFileAsync("git", args, { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
      if (!stdout.trim()) continue;

      const entries = stdout.split("---END---").filter(e => e.trim());
      for (const entry of entries) {
        const lines = entry.trim().split("\n");
        if (lines.length < 4) continue;
        const sha = lines[0];
        if (seenShas.has(sha)) continue;
        seenShas.add(sha);
        commits.push({
          sha,
          branch,
          author: lines[1],
          message: lines[3],
          committedDate: lines[2].slice(0, 10),
          committedAt: lines[2],
        });
      }
    } catch {
      // 브랜치 오류 무시
    }
  }

  return commits;
}

function parseGitLog(output: string, owner: string, repoName: string, branch: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  // ---END--- 뒤에 numstat이 오고, 그 다음 커밋의 sha가 온다.
  // split 후 각 entry에는: [numstat of prev commit]\n{sha}\n{author}\n{date}\n{msg}
  // 첫 entry에는 numstat 없이 sha부터 시작.
  const entries = output.split("---END---").filter((e) => e.trim());

  for (const entry of entries) {
    const lines = entry.trim().split("\n").filter((l) => l !== "");

    // numstat 행(탭 포함)과 메타데이터 행을 분리
    // SHA는 40자 hex로 시작하는 행
    const shaIndex = lines.findIndex((l) => /^[0-9a-f]{40}$/.test(l));
    if (shaIndex === -1 || shaIndex + 3 >= lines.length) {
      // 마지막 entry가 numstat만 있는 경우 → 이전 커밋에 붙여야 하지만
      // 첫 entry가 아니면 이전 커밋의 numstat
      if (commits.length > 0) {
        const prevCommit = commits[commits.length - 1];
        for (const line of lines) {
          const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (match) {
            prevCommit.additions += match[1] === "-" ? 0 : parseInt(match[1], 10);
            prevCommit.deletions += match[2] === "-" ? 0 : parseInt(match[2], 10);
            prevCommit.filesChanged.push(match[3]);
          }
        }
      }
      continue;
    }

    // SHA 앞의 행은 이전 커밋의 numstat
    if (shaIndex > 0 && commits.length > 0) {
      const prevCommit = commits[commits.length - 1];
      for (let i = 0; i < shaIndex; i++) {
        const match = lines[i].match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (match) {
          prevCommit.additions += match[1] === "-" ? 0 : parseInt(match[1], 10);
          prevCommit.deletions += match[2] === "-" ? 0 : parseInt(match[2], 10);
          prevCommit.filesChanged.push(match[3]);
        }
      }
    }

    const sha = lines[shaIndex];
    const author = lines[shaIndex + 1];
    const date = lines[shaIndex + 2];
    const message = lines[shaIndex + 3];

    commits.push({
      sha,
      message,
      author,
      date,
      repoOwner: owner,
      repoName,
      branch,
      filesChanged: [],
      additions: 0,
      deletions: 0,
    });

    // SHA 이후 4행 다음부터 이 커밋의 numstat (---END--- 전까지, 즉 entry 끝까지)
    for (let i = shaIndex + 4; i < lines.length; i++) {
      const match = lines[i].match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const current = commits[commits.length - 1];
        current.additions += match[1] === "-" ? 0 : parseInt(match[1], 10);
        current.deletions += match[2] === "-" ? 0 : parseInt(match[2], 10);
        current.filesChanged.push(match[3]);
      }
    }
  }

  return commits;
}
