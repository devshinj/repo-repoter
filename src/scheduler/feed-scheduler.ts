// src/scheduler/feed-scheduler.ts
import cron, { type ScheduledTask } from "node-cron";
import Database from "better-sqlite3";
import { kstCronOptions } from "@/core/date-utils";
import { getDb } from "@/infra/db/connection";
import { getActiveUsersWithRepos, getRepositoriesByUser } from "@/infra/db/repository";
import { getCredentialById } from "@/infra/db/credential";
import { fetchRssCommits } from "@/infra/rss/rss-client";
import {
  insertRssCommits,
  getUnprocessedRssCommits,
  insertFeedEntry,
  markRssCommitsProcessed,
  getLatestMilestoneSummary,
} from "@/infra/db/feed-repository";
import { getRepositoryProjectId } from "@/infra/db/project-repository";
import { getActiveMilestonesByScope } from "@/infra/db/milestone-repository";
import { buildBriefingPrompt, buildMilestoneSummaryPrompt, type LogicraftActivity } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";
import { listItems, activityItemTypes } from "@/infra/logicraft/logicraft-client";
import { getLogicraftApiKey } from "@/infra/db/logicraft";
import { decrypt } from "@/infra/crypto/token-encryption";
import type { GitProviderMeta } from "@/core/types";
import type { RssCommit } from "@/core/feed/feed-types";

let cronTask: ScheduledTask | null = null;

export function startFeedScheduler(): void {
  if (cronTask) return;
  console.log("[FeedScheduler] 3시간 주기 RSS 수집 시작");
  cronTask = cron.schedule("0 */3 * * *", () => {
    runFeedCycle().catch((err) => console.error("[FeedScheduler] cycle error:", err));
  }, kstCronOptions);
}

export async function runFeedCycle(): Promise<void> {
  const db = getDb();
  // getActiveUsersWithRepos returns string[] (user IDs)
  const userIds = getActiveUsersWithRepos(db);

  for (const userId of userIds) {
    try {
      await refreshFeedForUser(userId);
    } catch (err) {
      console.error(`[FeedScheduler] user ${userId} error:`, err);
    }
  }
}

export async function refreshFeedForUser(userId: string): Promise<{ newEntries: number }> {
  const db = getDb();
  // getRepositoriesByUser already filters is_active = 1
  const repos = getRepositoriesByUser(db, userId);
  let newEntries = 0;

  // Step 0: LogiCraft 활동 수집 (있으면)
  const logicraftActivities = await collectLogicraftActivities(db, userId);

  // Step 1: RSS 수집 — 전 저장소 RSS fetch → rss_commits에 저장
  //         RSS 실패(private 저장소 등) 시 commit_cache fallback
  for (const repo of repos) {
    try {
      const meta = resolveProviderMeta(repo);
      if (!meta) continue;
      const result = await fetchRssCommits(
        repo.id,
        meta,
        repo.owner,
        repo.repo,
        repo.branch
      );
      if (result.commits.length > 0) {
        insertRssCommits(db, result.commits);
      } else {
        // RSS에서 커밋을 못 가져온 경우 commit_cache fallback
        const cacheCommits = getRecentCacheAsRss(db, repo.id);
        if (cacheCommits.length > 0) {
          insertRssCommits(db, cacheCommits);
        }
      }
      // 브랜치 자동 교정: 404 fallback으로 다른 브랜치에서 성공한 경우 DB 업데이트
      if (result.correctedBranch) {
        db.prepare("UPDATE repositories SET branch = ? WHERE id = ?").run(result.correctedBranch, repo.id);
        repo.branch = result.correctedBranch;
      }
    } catch (err) {
      console.warn(`[FeedScheduler] RSS fetch failed for repo ${repo.id}:`, err);
      // RSS 자체가 예외인 경우에도 commit_cache fallback
      try {
        const cacheCommits = getRecentCacheAsRss(db, repo.id);
        if (cacheCommits.length > 0) {
          insertRssCommits(db, cacheCommits);
        }
      } catch { /* fallback도 실패하면 무시 */ }
    }
  }

  // Step 2: 브리핑 생성 — 프로젝트/저장소별로 미처리 커밋을 모아서 LLM 요약
  // 프로젝트에 속한 저장소는 프로젝트 단위로 묶고, 나머지는 저장소 단위
  const projectRepoMap = new Map<number, number[]>(); // projectId → repoIds
  const standaloneRepoIds: number[] = [];

  for (const repo of repos) {
    const projectId = getRepositoryProjectId(db, repo.id);
    if (projectId) {
      const list = projectRepoMap.get(projectId) ?? [];
      list.push(repo.id);
      projectRepoMap.set(projectId, list);
    } else {
      standaloneRepoIds.push(repo.id);
    }
  }

  // 프로젝트 단위 브리핑
  for (const [projectId, repoIds] of projectRepoMap) {
    const allCommits: RssCommit[] = [];
    for (const repoId of repoIds) {
      allCommits.push(...getUnprocessedRssCommits(db, repoId));
    }
    if (allCommits.length === 0) continue;

    const project = db
      .prepare("SELECT name FROM projects WHERE id = ?")
      .get(projectId) as { name: string } | undefined;
    const milestones = getActiveMilestonesByScope(db, "project", projectId);
    const previousSummary = getLatestMilestoneSummary(db, userId, "project", projectId) ?? undefined;
    const prompt = buildBriefingPrompt({
      scopeName: project?.name ?? "Unknown",
      commits: allCommits,
      milestones,
      previousMilestoneSummary: previousSummary,
      logicraftActivities,
    });
    const briefing = await generateText(prompt);

    let milestoneSummary: string | null = null;
    if (milestones.length > 0) {
      const summaryPrompt = buildMilestoneSummaryPrompt({
        milestones,
        commits: allCommits,
        previousSummary,
      });
      milestoneSummary = await generateText(summaryPrompt);
    }
    const shas = allCommits.map((c) => c.sha);
    const dates = allCommits.map((c) => c.committedAt).sort();

    const entryId = insertFeedEntry(db, {
      userId,
      scopeType: "project",
      scopeId: projectId,
      briefing,
      milestoneSummary: milestoneSummary ?? undefined,
      commitShas: shas,
      groupSuggestion: undefined,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
    });

    for (const repoId of repoIds) {
      const repoShas = allCommits
        .filter((c) => c.repositoryId === repoId)
        .map((c) => c.sha);
      if (repoShas.length > 0) {
        markRssCommitsProcessed(db, repoShas, repoId, entryId);
      }
    }
    newEntries++;
  }

  // 저장소 단위 브리핑
  for (const repoId of standaloneRepoIds) {
    const commits = getUnprocessedRssCommits(db, repoId);
    if (commits.length === 0) continue;

    const repo = repos.find((r: { id: number }) => r.id === repoId);
    const scopeName = repo ? (repo.label || `${repo.owner}/${repo.repo}`) : "Unknown";
    const milestones = getActiveMilestonesByScope(db, "repository", repoId);
    const previousSummary = getLatestMilestoneSummary(db, userId, "repository", repoId) ?? undefined;
    const prompt = buildBriefingPrompt({ scopeName, commits, milestones, previousMilestoneSummary: previousSummary, logicraftActivities });
    const briefing = await generateText(prompt);

    let milestoneSummary: string | null = null;
    if (milestones.length > 0) {
      const summaryPrompt = buildMilestoneSummaryPrompt({
        milestones,
        commits,
        previousSummary,
      });
      milestoneSummary = await generateText(summaryPrompt);
    }
    const shas = commits.map((c) => c.sha);
    const dates = commits.map((c) => c.committedAt).sort();

    const entryId = insertFeedEntry(db, {
      userId,
      scopeType: "repository",
      scopeId: repoId,
      briefing,
      milestoneSummary: milestoneSummary ?? undefined,
      commitShas: shas,
      groupSuggestion: undefined,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
    });

    markRssCommitsProcessed(db, shas, repoId, entryId);
    newEntries++;
  }

  return { newEntries };
}

function resolveProviderMeta(repo: {
  credential_id?: number;
  id: number;
}): GitProviderMeta | null {
  if (!repo.credential_id) return null;
  const db = getDb();
  const cred = getCredentialById(db, repo.credential_id);
  if (!cred?.metadata) return null;
  try {
    const meta =
      typeof cred.metadata === "string" ? JSON.parse(cred.metadata) : cred.metadata;
    return meta as GitProviderMeta;
  } catch {
    return null;
  }
}

/**
 * 사용자의 LogiCraft 매핑에서 최근 활동을 수집.
 * API 키가 없거나 매핑이 없으면 빈 배열 반환.
 */
async function collectLogicraftActivities(
  db: Database.Database,
  userId: string,
): Promise<LogicraftActivity[]> {
  const keyRow = getLogicraftApiKey(db, userId);
  if (!keyRow) return [];

  const mappings = db.prepare(
    "SELECT logicraft_project_id, logicraft_project_name FROM hrms_logicraft_mappings WHERE user_id = ?",
  ).all(userId) as { logicraft_project_id: string; logicraft_project_name: string }[];
  if (mappings.length === 0) return [];

  const apiKey = decrypt(keyRow.encrypted_key);
  const activities: LogicraftActivity[] = [];

  for (const mapping of mappings) {
    for (const type of activityItemTypes) {
      try {
        const items = await listItems(apiKey, mapping.logicraft_project_id, type, { limit: 50 });
        // 최근 3일 이내 수정된 항목만
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 3);
        const cutoffStr = cutoff.toISOString();

        for (const item of items) {
          if (item.last_updated_at >= cutoffStr) {
            activities.push({
              type,
              title: item.title,
              updatedAt: item.last_updated_at,
            });
          }
        }
      } catch { /* 타입별 조회 실패 무시 */ }
    }
  }

  return activities;
}

/**
 * commit_cache에서 rss_commits에 아직 없는 최근 커밋을 RssCommit 형태로 변환.
 * private 저장소 등 RSS 접근 불가 시 fallback으로 사용.
 */
function getRecentCacheAsRss(db: Database.Database, repositoryId: number): RssCommit[] {
  const rows = db.prepare(`
    SELECT cc.sha, cc.author, cc.message, cc.committed_at
    FROM commit_cache cc
    WHERE cc.repository_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM rss_commits rc
        WHERE rc.repository_id = cc.repository_id AND rc.sha = cc.sha
      )
    ORDER BY cc.committed_at DESC
    LIMIT 50
  `).all(repositoryId) as { sha: string; author: string; message: string; committed_at: string }[];

  return rows.map((r) => ({
    repositoryId,
    sha: r.sha,
    authorName: r.author,
    message: r.message,
    committedAt: r.committed_at,
  }));
}

