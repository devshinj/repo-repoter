// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import { kstCronOptions, isoToKstDate, kstDayStartIso } from "@/core/date-utils";
import {
  getActiveUsersWithRepos, getRepositoriesByUser,
  updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage,
  trySyncStart, updateSyncStatus, getCachedShas,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { createGitProvider, inferProviderMeta, type GitProviderClient } from "@/infra/git-provider";
import { decrypt } from "@/infra/crypto/token-encryption";
import type { GitProviderMeta } from "@/core/types";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;
let syncStartedAt: string | null = null;

const repoSyncConcurrency = 3;
const detailConcurrency = 5;
const maxCommitsPerSync = 1000;
export const maxCommitsPerBackfill = 5000;

export interface SyncResult {
  commitsProcessed: number;
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

export function getSchedulerStatus() {
  return { isRunning, lastRunAt, syncStartedAt, scheduled: cronTask !== null, intervalMin: 15 };
}

export interface FetchCommitsOptions {
  since: string;
  until?: string;
  maxCommits: number;
}

/**
 * 전체 브랜치의 커밋을 마지막 페이지까지 조회해 캐시에 없는 커밋만 반환.
 * 서버별 페이지 크기 상한(Gitea 기본 50건)이 달라 "빈 페이지"가 나올 때까지 읽는다.
 */
export async function fetchUncachedCommits(
  provider: GitProviderClient,
  repo: { id: number; owner: string; repo: string; branch: string },
  options: FetchCommitsOptions,
): Promise<{ cacheCommits: CacheCommit[] }> {
  const branches = await provider.listBranches(repo.owner, repo.repo);
  const branchNames = branches.map(b => b.name);
  const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

  const seenShas = new Set<string>();
  const cacheCommits: CacheCommit[] = [];

  for (const br of targetBranches) {
    let page = 1;
    while (seenShas.size < options.maxCommits) {
      const commits = await provider.listCommits(repo.owner, repo.repo, {
        branch: br, since: options.since, until: options.until, perPage: 100, page,
      });
      if (commits.length === 0) break;

      const newCommits = commits.filter(c => !seenShas.has(c.sha));
      // 다른 브랜치에서 이미 본 이력만 남았으면 이 브랜치는 종료
      if (newCommits.length === 0) break;
      for (const c of newCommits) seenShas.add(c.sha);

      // 이미 캐시된 SHA는 스킵
      const cached = await getCachedShas(repo.id, newCommits.map(c => c.sha));
      const uncachedCommits = newCommits.filter(c => !cached.has(c.sha));

      // listCommits에서 stats를 이미 가져온 커밋은 detail 호출 스킵.
      // detail 조회 실패 시 커밋을 버리지 않고 목록 정보로 저장 (증분 동기화 특성상 버리면 영구 누락)
      const needsDetail = uncachedCommits.filter(c => !c.statsLoaded);
      const alreadyDetailed = uncachedCommits.filter(c => c.statsLoaded);
      const settled = await pMap(
        needsDetail,
        (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
        detailConcurrency
      );
      const fetched = settled.map((r, i) => r.status === "fulfilled" ? r.value : needsDetail[i]);

      for (const c of [...alreadyDetailed, ...fetched]) {
        cacheCommits.push({
          sha: c.sha, repositoryId: repo.id, branch: br,
          author: c.author, message: c.message,
          committedDate: isoToKstDate(c.date), committedAt: c.date,
          additions: c.additions, deletions: c.deletions, filesChanged: c.filesChanged,
        });
      }
      page++;
    }
  }

  return { cacheCommits };
}

async function createProviderForRepo(userId: string, repo: any): Promise<GitProviderClient> {
  const gitCred = repo.credential_id
    ? await getCredentialById(repo.credential_id)
    : await getCredentialByUserAndProvider(userId, "git");
  if (!gitCred) throw new Error("Git credential not found for sync");

  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata
    ? (typeof gitCred.metadata === "string" ? JSON.parse(gitCred.metadata) : gitCred.metadata)
    : inferProviderMeta(repo.clone_url);

  return createGitProvider(meta, token);
}

/**
 * 지정 기간의 커밋을 다시 조회해 캐시 구멍을 메운다 (LLM 분석 없음).
 * 이미 동기화 중이면 null 반환. 반환값은 새로 캐시된 커밋 수.
 */
export async function backfillRepoCommits(
  userId: string,
  repo: any,
  range: { since: string; until?: string },
): Promise<number | null> {
  if (!await trySyncStart(repo.id)) {
    console.log(`[Backfill] ${repo.owner}/${repo.repo}: already syncing, skipped`);
    return null;
  }

  try {
    const provider = await createProviderForRepo(userId, repo);
    const { cacheCommits } = await fetchUncachedCommits(provider, repo, {
      since: range.since, until: range.until, maxCommits: maxCommitsPerBackfill,
    });
    const inserted = await insertCommitCache(cacheCommits);
    await insertSyncLogForUser({
      repositoryId: repo.id, userId, status: "success",
      commitsProcessed: inserted, tasksCreated: 0, errorMessage: null,
    });
    await updateSyncStatus(repo.id, "ready");
    console.log(`[Backfill] ${repo.owner}/${repo.repo}: cached ${inserted} commits (since ${range.since}${range.until ? `, until ${range.until}` : ""})`);
    return inserted;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await insertSyncLogForUser({
      repositoryId: repo.id, userId, status: "error",
      commitsProcessed: 0, tasksCreated: 0, errorMessage: `[Backfill] ${errorMsg}`,
    });
    await updateSyncStatus(repo.id, "error");
    console.error(`[Backfill] ${repo.owner}/${repo.repo}: failed -`, errorMsg);
    throw err;
  }
}

/**
 * 특정 KST 날짜 전후(전날~이틀 뒤) 구간을 재조회해 해당 날짜의 캐시 누락분을 채운다.
 * 저장소별 실패는 건너뛴다(sync_logs에 기록됨). 반환값은 새로 캐시된 커밋 수.
 */
export async function backfillReposForDate(userId: string, repos: any[], kstDate: string): Promise<number> {
  let total = 0;
  for (const repo of repos) {
    try {
      const inserted = await backfillRepoCommits(userId, repo, {
        since: kstDayStartIso(kstDate, -1),
        until: kstDayStartIso(kstDate, 2),
      });
      total += inserted ?? 0;
    } catch { /* backfillRepoCommits가 sync_logs에 에러 기록 */ }
  }
  return total;
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
    const provider = await createProviderForRepo(userId, repo);

    // Language
    try {
      const language = await provider.getRepoLanguage(repo.owner, repo.repo);
      await updatePrimaryLanguage(repo.id, language);
    } catch { /* non-critical */ }

    // Incremental sync
    const latestDate = await getLatestCacheDate(repo.id);
    const sinceDate = latestDate
      ? kstDayStartIso(latestDate, -1)
      : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

    // 전체 브랜치 동기화 (stats inline + 캐시 체크로 API 부하 최소화)
    const { cacheCommits: newCacheCommits } = await fetchUncachedCommits(
      provider, repo, { since: sinceDate, maxCommits: maxCommitsPerSync },
    );

    const inserted = await insertCommitCache(newCacheCommits);
    if (newCacheCommits.length > 0) await updateLastSyncedSha(repo.id, newCacheCommits[0].sha);
    await insertSyncLogForUser({
      repositoryId: repo.id, userId, status: "success",
      commitsProcessed: inserted, tasksCreated: 0, errorMessage: null,
    });
    console.log(`[Sync] ${repo.owner}/${repo.repo}: ${inserted > 0 ? `cached ${inserted} new commits` : "no new commits"}`);

    await updateSyncStatus(repo.id, "ready");
    return { commitsProcessed: inserted };
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
