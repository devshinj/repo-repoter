import { sql } from "@/infra/db/connection";
import type { RssCommit, FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";

export async function insertRssCommits(commits: RssCommit[]): Promise<number> {
  let count = 0;

  await sql.begin(async (tx) => {
    for (const commit of commits) {
      const result = await tx`
        INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at)
        VALUES (${commit.repositoryId}, ${commit.sha}, ${commit.authorName}, ${commit.message}, ${commit.committedAt})
        ON CONFLICT (repository_id, sha) DO NOTHING
      `;
      if (result.count > 0) {
        count++;
      }
    }
  });

  return count;
}

export async function getUnprocessedRssCommits(repositoryId: number): Promise<RssCommit[]> {
  const rows = await sql<RssCommit[]>`
    SELECT repository_id as "repositoryId", sha, author_name as "authorName", message, committed_at as "committedAt"
    FROM rss_commits
    WHERE repository_id = ${repositoryId} AND feed_entry_id IS NULL
    ORDER BY committed_at DESC
  `;

  return rows;
}

export async function markRssCommitsProcessed(
  shas: string[],
  repositoryId: number,
  feedEntryId: number
): Promise<void> {
  await sql`
    UPDATE rss_commits
    SET feed_entry_id = ${feedEntryId}
    WHERE repository_id = ${repositoryId} AND sha = ANY(${sql.array(shas)})
  `;
}

export async function insertFeedEntry(input: {
  userId: string;
  scopeType: "project" | "repository";
  scopeId: number;
  briefing?: string;
  milestoneSummary?: string;
  commitShas: string[];
  groupSuggestion?: GroupSuggestion;
  periodStart: string;
  periodEnd: string;
}): Promise<number> {
  // 같은 scope의 이전 브리핑 삭제 (scope당 최신 1개만 유지)
  await sql`
    DELETE FROM feed_entries
    WHERE user_id = ${input.userId} AND scope_type = ${input.scopeType} AND scope_id = ${input.scopeId}
  `;

  const [row] = await sql<[{ id: number }]>`
    INSERT INTO feed_entries (
      user_id, scope_type, scope_id, briefing, milestone_summary,
      commit_shas, group_suggestion, period_start, period_end
    ) VALUES (
      ${input.userId},
      ${input.scopeType},
      ${input.scopeId},
      ${input.briefing ?? null},
      ${input.milestoneSummary ?? null},
      ${JSON.stringify(input.commitShas)},
      ${input.groupSuggestion ? JSON.stringify(input.groupSuggestion) : null},
      ${input.periodStart},
      ${input.periodEnd}
    )
    RETURNING id
  `;

  return row.id;
}

export async function getLatestMilestoneSummary(
  userId: string,
  scopeType: "project" | "repository",
  scopeId: number
): Promise<string | null> {
  const [row] = await sql<[{ milestone_summary: string }?]>`
    SELECT milestone_summary
    FROM feed_entries
    WHERE user_id = ${userId} AND scope_type = ${scopeType} AND scope_id = ${scopeId} AND milestone_summary IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return row?.milestone_summary ?? null;
}

export async function deleteOrphanedFeedEntries(userId: string): Promise<void> {
  await sql`
    DELETE FROM feed_entries
    WHERE user_id = ${userId}
      AND (
        (scope_type = 'repository' AND scope_id NOT IN (SELECT id FROM repositories))
        OR
        (scope_type = 'project' AND scope_id NOT IN (SELECT id FROM projects))
      )
  `;
}

export async function getFeedEntries(userId: string, limit: number = 20): Promise<FeedEntry[]> {
  const rows = await sql<
    Array<{
      id: number;
      userId: string;
      scopeType: "project" | "repository";
      scopeId: number;
      briefing?: string;
      milestoneSummary?: string;
      commitShas: string | string[];
      groupSuggestion?: string | GroupSuggestion;
      periodStart: string;
      periodEnd: string;
      createdAt: string;
    }>
  >`
    SELECT
      id, user_id as "userId", scope_type as "scopeType", scope_id as "scopeId",
      briefing, milestone_summary as "milestoneSummary",
      commit_shas as "commitShas", group_suggestion as "groupSuggestion",
      period_start as "periodStart", period_end as "periodEnd", created_at as "createdAt"
    FROM feed_entries
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    briefing: row.briefing,
    milestoneSummary: row.milestoneSummary,
    commitShas: Array.isArray(row.commitShas)
      ? row.commitShas
      : JSON.parse(row.commitShas as string),
    groupSuggestion:
      row.groupSuggestion == null
        ? undefined
        : typeof row.groupSuggestion === "object"
          ? (row.groupSuggestion as GroupSuggestion)
          : JSON.parse(row.groupSuggestion as string),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    createdAt: row.createdAt,
  }));
}
