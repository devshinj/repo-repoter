// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import {
  getActiveUsersWithRepos,
  getRepositoriesByUser,
  updateLastSyncedSha,
  insertSyncLogForUser,
  getLatestCacheDate,
  insertCommitCache,
  updatePrimaryLanguage,
  type CacheCommit,
} from "@/infra/db/repository";
import { fetchRepoLanguage } from "@/infra/github/github-client";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { pullRepository, getCommitsSince, getCommitDiff, getBranches, getCommitsForCache, cloneRepository, RepoNotFoundError } from "@/infra/git/git-client";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { decrypt } from "@/infra/crypto/token-encryption";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord } from "@/core/types";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;
let syncStartedAt: string | null = null;

const repoSyncConcurrency = 3;

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

export function getSchedulerStatus() {
  return {
    isRunning,
    lastRunAt,
    syncStartedAt,
    scheduled: cronTask !== null,
    intervalMin: 15,
  };
}

async function enrichAmbiguousCommits(commits: CommitRecord[], repoPath: string): Promise<CommitRecord[]> {
  const enriched: CommitRecord[] = [];
  for (const commit of commits) {
    if (isAmbiguousCommitMessage(commit.message)) {
      const diff = await getCommitDiff(repoPath, commit.sha);
      const summary = await analyzeCommitWithDiff(commit, diff);
      enriched.push({ ...commit, message: summary });
    } else {
      enriched.push(commit);
    }
  }
  return enriched;
}

async function recloneRepo(database: ReturnType<typeof getDb>, userId: string, repo: any): Promise<void> {
  const gitCred = repo.credential_id
    ? getCredentialById(database, repo.credential_id)
    : getCredentialByUserAndProvider(database, userId, "git");
  if (!gitCred) throw new Error("Git credential not found for re-clone");
  const token = decrypt(gitCred.credential);
  await mkdir(dirname(repo.clone_path), { recursive: true });
  await cloneRepository(repo.clone_url, repo.clone_path, token);
  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: re-cloned successfully`);
}

async function syncOneRepo(database: ReturnType<typeof getDb>, userId: string, repo: any): Promise<void> {
  try {
    await pullRepository(repo.clone_path);
  } catch (err) {
    if (err instanceof RepoNotFoundError) {
      console.warn(`[Scheduler] ${repo.owner}/${repo.repo}: bare repo missing, re-cloning...`);
      await recloneRepo(database, userId, repo);
    } else {
      throw err;
    }
  }

  // language 갱신
  try {
    const gitCred = repo.credential_id
      ? getCredentialById(database, repo.credential_id)
      : getCredentialByUserAndProvider(database, userId, "git");
    const langToken = gitCred ? decrypt(gitCred.credential) : undefined;
    const language = await fetchRepoLanguage(repo.owner, repo.repo, langToken);
    updatePrimaryLanguage(database, repo.id, language);
  } catch (langErr) {
    console.error(`[Scheduler] ${repo.owner}/${repo.repo}: language fetch failed -`, langErr);
  }

  // 캐시 빌드 (증분)
  try {
    const branches = await getBranches(repo.clone_path);
    const latestDate = getLatestCacheDate(database, repo.id);
    const cacheCommits = await getCommitsForCache(repo.clone_path, branches, latestDate ?? undefined);
    if (cacheCommits.length > 0) {
      const rows: CacheCommit[] = cacheCommits.map(c => ({
        sha: c.sha,
        repositoryId: repo.id,
        branch: c.branch,
        author: c.author,
        message: c.message,
        committedDate: c.committedDate,
        committedAt: c.committedAt,
      }));
      const inserted = insertCommitCache(database, rows);
      if (inserted > 0) {
        console.log(`[Scheduler] ${repo.owner}/${repo.repo}: cached ${inserted} new commits`);
      }
    }
  } catch (cacheErr) {
    console.error(`[Scheduler] ${repo.owner}/${repo.repo}: cache build failed -`, cacheErr);
  }

  const commits = await getCommitsSince(repo.clone_path, repo.branch, repo.clone_url, repo.last_synced_sha);

  if (commits.length === 0) {
    console.log(`[Scheduler] ${repo.owner}/${repo.repo}: no new commits`);
    insertSyncLogForUser(database, {
      repositoryId: repo.id,
      userId,
      status: "success",
      commitsProcessed: 0,
      tasksCreated: 0,
      errorMessage: null,
    });
    return;
  }

  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${commits.length} new commits`);

  // 모호한 커밋 보강
  const enrichedCommits = await enrichAmbiguousCommits(commits, repo.clone_path);

  // 그룹핑 + Gemini 분석 (직렬 — Gemini rate limit 보호)
  const groups = groupCommitsByDateAndProject(enrichedCommits);
  let tasksCreated = 0;
  for (const group of groups) {
    const tasks = await analyzeCommits(group.commits, group.project, group.date);
    tasksCreated += tasks.length;
  }

  updateLastSyncedSha(database, repo.id, commits[0].sha);
  insertSyncLogForUser(database, {
    repositoryId: repo.id,
    userId,
    status: "success",
    commitsProcessed: commits.length,
    tasksCreated,
    errorMessage: null,
  });

  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: synced ${commits.length} commits, created ${tasksCreated} tasks`);
}

export async function runSyncCycle(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Sync already in progress, skipping");
    return;
  }

  isRunning = true;
  syncStartedAt = new Date().toISOString();
  const database = getDb();

  try {
    const userIds = getActiveUsersWithRepos(database);

    for (const userId of userIds) {
      try {
        // 사용자 자격증명 로드
        const gitCred = getCredentialByUserAndProvider(database, userId, "git");
        if (!gitCred) {
          console.log(`[Scheduler] User ${userId}: no git credential, skipping`);
          continue;
        }

        const repos = getRepositoriesByUser(database, userId).filter((r: any) => r.clone_path);

        const results = await pMap(repos, (repo: any) => syncOneRepo(database, userId, repo), repoSyncConcurrency);

        for (let i = 0; i < results.length; i++) {
          if (results[i].status === "rejected") {
            const repo = repos[i];
            const errorMsg = (results[i] as PromiseRejectedResult).reason?.message ?? String((results[i] as PromiseRejectedResult).reason);
            insertSyncLogForUser(database, {
              repositoryId: repo.id,
              userId,
              status: "error",
              commitsProcessed: 0,
              tasksCreated: 0,
              errorMessage: errorMsg,
            });
            console.error(`[Scheduler] ${repo.owner}/${repo.repo}: sync failed -`, errorMsg);
          }
        }
      } catch (error) {
        console.error(`[Scheduler] User ${userId}: failed -`, error);
      }
    }

    lastRunAt = new Date().toISOString();
  } finally {
    isRunning = false;
  }
}

export function startScheduler(intervalMin: number = 15): void {
  if (cronTask) {
    console.log("[Scheduler] Already running");
    return;
  }

  runSyncCycle().catch(console.error);

  cronTask = cron.schedule(`*/${intervalMin} * * * *`, () => {
    runSyncCycle().catch(console.error);
  });

  console.log(`[Scheduler] Started with ${intervalMin}min interval`);
}

export function stopScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[Scheduler] Stopped");
  }
}
