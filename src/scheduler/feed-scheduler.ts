// src/scheduler/feed-scheduler.ts
import cron, { type ScheduledTask } from "node-cron";
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
} from "@/infra/db/feed-repository";
import { getRepositoryProjectId } from "@/infra/db/project-repository";
import { getActiveMilestonesByScope } from "@/infra/db/milestone-repository";
import { buildBriefingPrompt } from "@/core/feed/briefing-prompt";
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

  // Step 1: RSS 수집 — 전 저장소 RSS fetch → rss_commits에 저장
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
      }
      // 브랜치 자동 교정: 404 fallback으로 다른 브랜치에서 성공한 경우 DB 업데이트
      if (result.correctedBranch) {
        db.prepare("UPDATE repositories SET branch = ? WHERE id = ?").run(result.correctedBranch, repo.id);
        repo.branch = result.correctedBranch;
      }
    } catch (err) {
      console.warn(`[FeedScheduler] RSS fetch failed for repo ${repo.id}:`, err);
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
    const prompt = buildBriefingPrompt({
      scopeName: project?.name ?? "Unknown",
      commits: allCommits,
      milestones,
    });
    const briefing = await generateText(prompt);

    const milestoneSummary = milestones.length > 0 ? extractMilestoneSummary(briefing) : null;
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
    const scopeName = repo ? `${repo.owner}/${repo.repo}` : "Unknown";
    const milestones = getActiveMilestonesByScope(db, "repository", repoId);
    const prompt = buildBriefingPrompt({ scopeName, commits, milestones });
    const briefing = await generateText(prompt);

    const milestoneSummary = milestones.length > 0 ? extractMilestoneSummary(briefing) : null;
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
 * 브리핑의 첫 단락을 마일스톤 요약으로 추출한다.
 * 빈 줄을 만나면 첫 단락이 끝난 것으로 간주한다.
 */
export function extractMilestoneSummary(briefing: string): string | null {
  const trimmed = briefing.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (summaryLines.length > 0 && line.trim() === "") break;
    summaryLines.push(line);
  }
  return summaryLines.length > 0 ? summaryLines.join("\n") : null;
}
