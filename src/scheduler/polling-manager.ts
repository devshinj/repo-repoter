// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import {
  getActiveUsersWithRepos, getRepositoriesByUser,
  updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { createGitProvider } from "@/infra/git-provider";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { decrypt } from "@/infra/crypto/token-encryption";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord, GitProviderMeta } from "@/core/types";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;
let syncStartedAt: string | null = null;

const repoSyncConcurrency = 3;
const detailConcurrency = 5;

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

async function pMapFulfilled<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}

export function getSchedulerStatus() {
  return { isRunning, lastRunAt, syncStartedAt, scheduled: cronTask !== null, intervalMin: 15 };
}

async function syncOneRepo(database: ReturnType<typeof getDb>, userId: string, repo: any): Promise<void> {
  const gitCred = repo.credential_id
    ? getCredentialById(database, repo.credential_id)
    : getCredentialByUserAndProvider(database, userId, "git");
  if (!gitCred) throw new Error("Git credential not found for sync");

  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata
    ? JSON.parse(gitCred.metadata)
    : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

  const provider = createGitProvider(meta, token);

  // Language
  try {
    const language = await provider.getRepoLanguage(repo.owner, repo.repo);
    updatePrimaryLanguage(database, repo.id, language);
  } catch { /* non-critical */ }

  // Incremental sync
  const latestDate = getLatestCacheDate(database, repo.id);
  const sinceDate = latestDate
    ? new Date(new Date(latestDate).getTime() - 86400000).toISOString()
    : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

  const branches = await provider.listBranches(repo.owner, repo.repo);
  const branchNames = branches.map(b => b.name);
  const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

  const seenShas = new Set<string>();
  const newCacheCommits: CacheCommit[] = [];
  const newCommitRecords: CommitRecord[] = [];

  for (const br of targetBranches) {
    let page = 1;
    while (true) {
      const commits = await provider.listCommits(repo.owner, repo.repo, {
        branch: br, since: sinceDate, perPage: 100, page,
      });
      if (commits.length === 0) break;

      const newCommits = commits.filter(c => !seenShas.has(c.sha));
      const detailed = await pMapFulfilled(
        newCommits,
        (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
        detailConcurrency
      );

      for (const c of detailed) {
        if (seenShas.has(c.sha)) continue;
        seenShas.add(c.sha);
        newCacheCommits.push({
          sha: c.sha, repositoryId: repo.id, branch: br,
          author: c.author, message: c.message,
          committedDate: c.date.slice(0, 10), committedAt: c.date,
          additions: c.additions, deletions: c.deletions, filesChanged: c.filesChanged,
        });
        newCommitRecords.push({
          sha: c.sha, message: c.message, author: c.author, date: c.date,
          repoOwner: repo.owner, repoName: repo.repo, branch: br,
          filesChanged: c.filesChanged, additions: c.additions, deletions: c.deletions,
        });
      }
      if (commits.length < 100) break;
      page++;
    }
  }

  // Cache
  if (newCacheCommits.length > 0) {
    const inserted = insertCommitCache(database, newCacheCommits);
    if (inserted > 0) console.log(`[Scheduler] ${repo.owner}/${repo.repo}: cached ${inserted} new commits`);
  }

  if (newCommitRecords.length === 0) {
    console.log(`[Scheduler] ${repo.owner}/${repo.repo}: no new commits`);
    insertSyncLogForUser(database, {
      repositoryId: repo.id, userId, status: "success",
      commitsProcessed: 0, tasksCreated: 0, errorMessage: null,
    });
    return;
  }

  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${newCommitRecords.length} new commits`);

  // Enrich ambiguous commits
  const enrichedCommits: CommitRecord[] = [];
  for (const commit of newCommitRecords) {
    if (isAmbiguousCommitMessage(commit.message)) {
      try {
        const diff = await provider.getCommitDiff(repo.owner, repo.repo, commit.sha);
        const summary = await analyzeCommitWithDiff(commit, diff);
        enrichedCommits.push({ ...commit, message: summary });
      } catch { enrichedCommits.push(commit); }
    } else {
      enrichedCommits.push(commit);
    }
  }

  // Group + analyze
  const groups = groupCommitsByDateAndProject(enrichedCommits);
  let tasksCreated = 0;
  for (const group of groups) {
    const tasks = await analyzeCommits(group.commits, group.project, group.date);
    tasksCreated += tasks.length;
  }

  updateLastSyncedSha(database, repo.id, newCommitRecords[0].sha);
  insertSyncLogForUser(database, {
    repositoryId: repo.id, userId, status: "success",
    commitsProcessed: newCommitRecords.length, tasksCreated, errorMessage: null,
  });
  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: synced ${newCommitRecords.length} commits, created ${tasksCreated} tasks`);
}

export async function runSyncCycle(): Promise<void> {
  if (isRunning) { console.log("[Scheduler] Sync already in progress, skipping"); return; }
  isRunning = true;
  syncStartedAt = new Date().toISOString();
  const database = getDb();

  try {
    const userIds = getActiveUsersWithRepos(database);
    for (const userId of userIds) {
      try {
        const repos = getRepositoriesByUser(database, userId).filter((r: any) => r.sync_status === "ready");
        const results = await pMap(repos, (repo: any) => syncOneRepo(database, userId, repo), repoSyncConcurrency);
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === "rejected") {
            const repo = repos[i];
            const errorMsg = (results[i] as PromiseRejectedResult).reason?.message ?? String((results[i] as PromiseRejectedResult).reason);
            insertSyncLogForUser(database, {
              repositoryId: repo.id, userId, status: "error",
              commitsProcessed: 0, tasksCreated: 0, errorMessage: errorMsg,
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
  if (cronTask) { console.log("[Scheduler] Already running"); return; }
  runSyncCycle().catch(console.error);
  cronTask = cron.schedule(`*/${intervalMin} * * * *`, () => { runSyncCycle().catch(console.error); });
  console.log(`[Scheduler] Started with ${intervalMin}min interval`);
}

export function stopScheduler(): void {
  if (cronTask) { cronTask.stop(); cronTask = null; console.log("[Scheduler] Stopped"); }
}
