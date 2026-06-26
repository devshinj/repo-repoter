// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import { kstCronOptions } from "@/core/date-utils";
import {
  getActiveUsersWithRepos, getRepositoriesByUser,
  updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage,
  trySyncStart, updateSyncStatus, getCachedShas,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { createGitProvider, inferProviderMeta } from "@/infra/git-provider";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/llm/llm-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { decrypt } from "@/infra/crypto/token-encryption";
import type { CommitRecord, GitProviderMeta } from "@/core/types";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;
let syncStartedAt: string | null = null;

const repoSyncConcurrency = 3;
const detailConcurrency = 5;
const maxCommitsPerSync = 1000;

export interface SyncResult {
  commitsProcessed: number;
  tasksCreated: number;
}

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

/**
 * 단일 저장소 동기화. 원자적 잠금(trySyncStart)으로 동시 실행 방지.
 * 이미 동기화 중이면 null 반환.
 */
export async function syncOneRepo(userId: string, repo: any): Promise<SyncResult | null> {
  if (!await trySyncStart(repo.id)) {
    console.log(`[Sync] ${repo.owner}/${repo.repo}: already syncing, skipped`);
    return null;
  }

  try {
    const gitCred = repo.credential_id
      ? await getCredentialById(repo.credential_id)
      : await getCredentialByUserAndProvider(userId, "git");
    if (!gitCred) throw new Error("Git credential not found for sync");

    const token = decrypt(gitCred.credential);
    const meta: GitProviderMeta = gitCred.metadata
      ? JSON.parse(gitCred.metadata)
      : inferProviderMeta(repo.clone_url);

    const provider = createGitProvider(meta, token);

    // Language
    try {
      const language = await provider.getRepoLanguage(repo.owner, repo.repo);
      await updatePrimaryLanguage(repo.id, language);
    } catch { /* non-critical */ }

    // Incremental sync
    const latestDate = await getLatestCacheDate(repo.id);
    const sinceDate = latestDate
      ? new Date(new Date(latestDate).getTime() - 86400000).toISOString()
      : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

    // 전체 브랜치 동기화 (stats inline + 캐시 체크로 API 부하 최소화)
    const branches = await provider.listBranches(repo.owner, repo.repo);
    const branchNames = branches.map(b => b.name);
    const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

    const seenShas = new Set<string>();
    const newCacheCommits: CacheCommit[] = [];
    const newCommitRecords: CommitRecord[] = [];

    for (const br of targetBranches) {
      let page = 1;
      while (true) {
        if (seenShas.size >= maxCommitsPerSync) break;

        const commits = await provider.listCommits(repo.owner, repo.repo, {
          branch: br, since: sinceDate, perPage: 100, page,
        });
        if (commits.length === 0) break;

        const newCommits = commits.filter(c => !seenShas.has(c.sha));
        // 이미 캐시된 SHA는 스킵
        const cached = await getCachedShas(repo.id, newCommits.map(c => c.sha));
        const uncachedCommits = newCommits.filter(c => !cached.has(c.sha));

        // listCommits에서 stats를 이미 가져온 커밋은 detail 호출 스킵
        const needsDetail = uncachedCommits.filter(c => !c.statsLoaded);
        const alreadyDetailed = uncachedCommits.filter(c => c.statsLoaded);

        const fetched = await pMapFulfilled(
          needsDetail,
          (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
          detailConcurrency
        );

        const detailed = [...alreadyDetailed, ...fetched];

        // 캐시된 커밋도 seenShas에 추가 (중복 방지)
        for (const c of newCommits) seenShas.add(c.sha);

        for (const c of detailed) {
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
      const inserted = await insertCommitCache(newCacheCommits);
      if (inserted > 0) console.log(`[Sync] ${repo.owner}/${repo.repo}: cached ${inserted} new commits`);
    }

    if (newCommitRecords.length === 0) {
      console.log(`[Sync] ${repo.owner}/${repo.repo}: no new commits`);
      await insertSyncLogForUser({
        repositoryId: repo.id, userId, status: "success",
        commitsProcessed: 0, tasksCreated: 0, errorMessage: null,
      });
      await updateSyncStatus(repo.id, "ready");
      return { commitsProcessed: 0, tasksCreated: 0 };
    }

    console.log(`[Sync] ${repo.owner}/${repo.repo}: found ${newCommitRecords.length} new commits`);

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

    await updateLastSyncedSha(repo.id, newCommitRecords[0].sha);
    await insertSyncLogForUser({
      repositoryId: repo.id, userId, status: "success",
      commitsProcessed: newCommitRecords.length, tasksCreated, errorMessage: null,
    });
    console.log(`[Sync] ${repo.owner}/${repo.repo}: synced ${newCommitRecords.length} commits, created ${tasksCreated} tasks`);

    await updateSyncStatus(repo.id, "ready");
    return { commitsProcessed: newCommitRecords.length, tasksCreated };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await insertSyncLogForUser({
      repositoryId: repo.id, userId, status: "error",
      commitsProcessed: 0, tasksCreated: 0, errorMessage: errorMsg,
    });
    await updateSyncStatus(repo.id, "error");
    console.error(`[Sync] ${repo.owner}/${repo.repo}: failed -`, errorMsg);
    throw err;
  }
}

export async function runSyncCycle(): Promise<void> {
  if (isRunning) { console.log("[Scheduler] Sync already in progress, skipping"); return; }
  isRunning = true;
  syncStartedAt = new Date().toISOString();

  try {
    const userIds = await getActiveUsersWithRepos();
    for (const userId of userIds) {
      try {
        const allRepos = await getRepositoriesByUser(userId);
        const repos = allRepos.filter((r: any) => r.sync_status === "ready" || r.sync_status === "error");
        await pMap(repos, (repo: any) => syncOneRepo(userId, repo).catch(() => {}), repoSyncConcurrency);
      } catch (error) {
        console.error(`[Scheduler] User ${userId}: failed -`, error);
      }
    }
    lastRunAt = new Date().toISOString();
  } finally {
    isRunning = false;
    syncStartedAt = null;
  }
}

export function startScheduler(intervalMin: number = 15): void {
  if (cronTask) { console.log("[Scheduler] Already running"); return; }
  runSyncCycle().catch(console.error);
  cronTask = cron.schedule(`*/${intervalMin} * * * *`, () => { runSyncCycle().catch(console.error); }, kstCronOptions);
  console.log(`[Scheduler] Started with ${intervalMin}min interval`);
}

export function stopScheduler(): void {
  if (cronTask) { cronTask.stop(); cronTask = null; console.log("[Scheduler] Stopped"); }
}
