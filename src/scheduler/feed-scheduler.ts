// src/scheduler/feed-scheduler.ts
import cron, { type ScheduledTask } from "node-cron";
import { kstCronOptions, getKstToday } from "@/core/date-utils";
import { sql } from "@/infra/db/connection";
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
import { buildBriefingPrompt, buildMilestoneSummaryPrompt } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";
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
  const userIds = await getActiveUsersWithRepos();

  for (const userId of userIds) {
    try {
      await refreshFeedForUser(userId);
    } catch (err) {
      console.error(`[FeedScheduler] user ${userId} error:`, err);
    }
  }
}

export async function refreshFeedForUser(userId: string): Promise<{ newEntries: number }> {
  const repos = await getRepositoriesByUser(userId);
  let newEntries = 0;

  // Step 1: RSS 수집 — 전 저장소 RSS fetch → rss_commits에 저장
  //         RSS 실패(private 저장소 등) 시 commit_cache fallback
  for (const repo of repos) {
    try {
      const meta = await resolveProviderMeta(repo);
      if (!meta) continue;
      const result = await fetchRssCommits(
        repo.id,
        meta,
        repo.owner,
        repo.repo,
        repo.branch
      );
      if (result.commits.length > 0) {
        await insertRssCommits(result.commits);
      } else {
        // RSS에서 커밋을 못 가져온 경우 commit_cache fallback
        const cacheCommits = await getRecentCacheAsRss(repo.id);
        if (cacheCommits.length > 0) {
          await insertRssCommits(cacheCommits);
        }
      }
      // 브랜치 자동 교정: 404 fallback으로 다른 브랜치에서 성공한 경우 DB 업데이트
      if (result.correctedBranch) {
        await sql`UPDATE repositories SET branch = ${result.correctedBranch} WHERE id = ${repo.id}`;
        repo.branch = result.correctedBranch;
      }
    } catch (err) {
      console.warn(`[FeedScheduler] RSS fetch failed for repo ${repo.id}:`, err);
      // RSS 자체가 예외인 경우에도 commit_cache fallback
      try {
        const cacheCommits = await getRecentCacheAsRss(repo.id);
        if (cacheCommits.length > 0) {
          await insertRssCommits(cacheCommits);
        }
      } catch { /* fallback도 실패하면 무시 */ }
    }
  }

  // Step 2: 브리핑 생성 — 프로젝트/저장소별로 미처리 커밋을 모아서 LLM 요약
  // 프로젝트에 속한 저장소는 프로젝트 단위로 묶고, 나머지는 저장소 단위
  const projectRepoMap = new Map<number, number[]>(); // projectId → repoIds
  const standaloneRepoIds: number[] = [];

  for (const repo of repos) {
    const projectId = await getRepositoryProjectId(repo.id);
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
      allCommits.push(...await getUnprocessedRssCommits(repoId));
    }
    if (allCommits.length === 0) continue;

    const [projectRow] = await sql`SELECT name FROM projects WHERE id = ${projectId}` as any[];
    const milestones = await getActiveMilestonesByScope("project", projectId);
    const previousSummary = await getLatestMilestoneSummary(userId, "project", projectId) ?? undefined;
    const prompt = buildBriefingPrompt({
      scopeName: projectRow?.name ?? "Unknown",
      commits: allCommits,
      milestones,
      previousMilestoneSummary: previousSummary,
    });
    const briefing = await generateText(prompt);

    let milestoneSummary: string | null = null;
    if (milestones.length > 0) {
      const summaryPrompt = buildMilestoneSummaryPrompt({
        milestones,
        commits: allCommits,
        currentDate: getKstToday(),
        previousSummary,
      });
      milestoneSummary = await generateText(summaryPrompt);
    }
    const shas = allCommits.map((c) => c.sha);
    const dates = allCommits.map((c) => c.committedAt).sort();

    const entryId = await insertFeedEntry({
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
        await markRssCommitsProcessed(repoShas, repoId, entryId);
      }
    }
    newEntries++;
  }

  // 저장소 단위 브리핑
  for (const repoId of standaloneRepoIds) {
    const commits = await getUnprocessedRssCommits(repoId);
    if (commits.length === 0) continue;

    const repo = repos.find((r: { id: number }) => r.id === repoId);
    const scopeName = repo ? (repo.label || `${repo.owner}/${repo.repo}`) : "Unknown";
    const milestones = await getActiveMilestonesByScope("repository", repoId);
    const previousSummary = await getLatestMilestoneSummary(userId, "repository", repoId) ?? undefined;
    const prompt = buildBriefingPrompt({ scopeName, commits, milestones, previousMilestoneSummary: previousSummary });
    const briefing = await generateText(prompt);

    let milestoneSummary: string | null = null;
    if (milestones.length > 0) {
      const summaryPrompt = buildMilestoneSummaryPrompt({
        milestones,
        commits,
        currentDate: getKstToday(),
        previousSummary,
      });
      milestoneSummary = await generateText(summaryPrompt);
    }
    const shas = commits.map((c) => c.sha);
    const dates = commits.map((c) => c.committedAt).sort();

    const entryId = await insertFeedEntry({
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

    await markRssCommitsProcessed(shas, repoId, entryId);
    newEntries++;
  }

  return { newEntries };
}

async function resolveProviderMeta(repo: {
  credential_id?: number;
  id: number;
}): Promise<GitProviderMeta | null> {
  if (!repo.credential_id) return null;
  const cred = await getCredentialById(repo.credential_id);
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
 * commit_cache에서 rss_commits에 아직 없는 최근 커밋을 RssCommit 형태로 변환.
 * private 저장소 등 RSS 접근 불가 시 fallback으로 사용.
 */
async function getRecentCacheAsRss(repositoryId: number): Promise<RssCommit[]> {
  const rows = await sql`
    SELECT cc.sha, cc.author, cc.message, cc.committed_at
    FROM commit_cache cc
    WHERE cc.repository_id = ${repositoryId}
      AND NOT EXISTS (
        SELECT 1 FROM rss_commits rc
        WHERE rc.repository_id = cc.repository_id AND rc.sha = cc.sha
      )
    ORDER BY cc.committed_at DESC
    LIMIT 50
  ` as any[];

  return rows.map((r: any) => ({
    repositoryId,
    sha: r.sha,
    authorName: r.author,
    message: r.message,
    committedAt: r.committed_at,
  }));
}
