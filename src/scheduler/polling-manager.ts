// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import {
  getActiveUsersWithRepos,
  getRepositoriesByUser,
  updateLastSyncedSha,
  insertSyncLogForUser,
  getLatestCacheDate,
  insertCommitCache,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { pullRepository, getCommitsSince, getCommitDiff, getBranches, getCommitsForCache } from "@/infra/git/git-client";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import {
  createCommitLogPage,
  createDailyTaskPage,
  isCommitAlreadySynced,
  isDailyTaskExists,
  updateDailyTaskPage,
} from "@/infra/notion/notion-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import type { CommitRecord } from "@/core/types";

let db: Database.Database | null = null;
let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(process.cwd(), "data", "tracker.db"));
    createTables(db);
    migrateSchema(db);
  }
  return db;
}

export function getSchedulerStatus() {
  return {
    isRunning,
    lastRunAt,
    nextRunAt: cronTask ? null : null,
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

export async function runSyncCycle(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Sync already in progress, skipping");
    return;
  }

  isRunning = true;
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

        const notionCred = getCredentialByUserAndProvider(database, userId, "notion");
        if (!notionCred || !notionCred.metadata) {
          console.log(`[Scheduler] User ${userId}: no notion credential, skipping`);
          continue;
        }

        const notionMeta = JSON.parse(notionCred.metadata);
        const notionConfig = {
          apiKey: decrypt(notionCred.credential),
          commitDbId: notionMeta.notionCommitDbId,
          taskDbId: notionMeta.notionTaskDbId,
        };

        const repos = getRepositoriesByUser(database, userId);

        for (const repo of repos) {
          if (!repo.clone_path) continue;

          try {
            await pullRepository(repo.clone_path);

            // --- 캐시 빌드 (증분) ---
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
              continue;
            }

            console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${commits.length} new commits`);

            // 커밋 로그 동기화
            for (const commit of commits) {
              const alreadySynced = await isCommitAlreadySynced(notionConfig, commit.sha);
              if (!alreadySynced) {
                await createCommitLogPage(notionConfig, commit);
              }
            }

            // 모호한 커밋 보강
            const enrichedCommits = await enrichAmbiguousCommits(commits, repo.clone_path);

            // 그룹핑 + 분석 + 태스크 생성
            const groups = groupCommitsByDateAndProject(enrichedCommits);
            let tasksCreated = 0;
            for (const group of groups) {
              const tasks = await analyzeCommits(group.commits, group.project, group.date);
              for (const task of tasks) {
                const existingPageId = await isDailyTaskExists(notionConfig, task.project, task.date);
                if (existingPageId) {
                  await updateDailyTaskPage(notionConfig, existingPageId, task);
                } else {
                  await createDailyTaskPage(notionConfig, task);
                  tasksCreated++;
                }
              }
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
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
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
