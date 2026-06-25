import Database from "better-sqlite3";
import type { RssCommit, FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";

export function insertRssCommits(db: Database.Database, commits: RssCommit[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO rss_commits (repository_id, sha, author_name, message, committed_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    for (const commit of commits) {
      const result = insert.run(
        commit.repositoryId,
        commit.sha,
        commit.authorName,
        commit.message,
        commit.committedAt
      );
      if (result.changes > 0) {
        count++;
      }
    }
  });

  transaction();
  return count;
}

export function getUnprocessedRssCommits(
  db: Database.Database,
  repositoryId: number
): RssCommit[] {
  const rows = db
    .prepare(
      `
    SELECT repository_id as repositoryId, sha, author_name as authorName, message, committed_at as committedAt
    FROM rss_commits
    WHERE repository_id = ? AND feed_entry_id IS NULL
    ORDER BY committed_at DESC
  `
    )
    .all(repositoryId) as RssCommit[];

  return rows;
}

export function markRssCommitsProcessed(
  db: Database.Database,
  shas: string[],
  repositoryId: number,
  feedEntryId: number
): void {
  const update = db.prepare(`
    UPDATE rss_commits
    SET feed_entry_id = ?
    WHERE repository_id = ? AND sha IN (${shas.map(() => "?").join(",")})
  `);

  update.run(feedEntryId, repositoryId, ...shas);
}

export function insertFeedEntry(
  db: Database.Database,
  input: {
    userId: string;
    scopeType: "project" | "repository";
    scopeId: number;
    briefing?: string;
    milestoneSummary?: string;
    commitShas: string[];
    groupSuggestion?: GroupSuggestion;
    periodStart: string;
    periodEnd: string;
  }
): number {
  // 같은 scope의 이전 브리핑 삭제 (scope당 최신 1개만 유지)
  db.prepare(
    "DELETE FROM feed_entries WHERE user_id = ? AND scope_type = ? AND scope_id = ?"
  ).run(input.userId, input.scopeType, input.scopeId);

  const result = db
    .prepare(
      `
    INSERT INTO feed_entries (
      user_id, scope_type, scope_id, briefing, milestone_summary,
      commit_shas, group_suggestion, period_start, period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      input.userId,
      input.scopeType,
      input.scopeId,
      input.briefing || null,
      input.milestoneSummary || null,
      JSON.stringify(input.commitShas),
      input.groupSuggestion ? JSON.stringify(input.groupSuggestion) : null,
      input.periodStart,
      input.periodEnd
    );

  return result.lastInsertRowid as number;
}

export function getFeedEntries(
  db: Database.Database,
  userId: string,
  limit: number = 20
): FeedEntry[] {
  const rows = db
    .prepare(
      `
    SELECT
      id, user_id as userId, scope_type as scopeType, scope_id as scopeId,
      briefing, milestone_summary as milestoneSummary,
      commit_shas as commitShas, group_suggestion as groupSuggestion,
      period_start as periodStart, period_end as periodEnd, created_at as createdAt
    FROM feed_entries
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `
    )
    .all(userId, limit) as Array<{
    id: number;
    userId: string;
    scopeType: "project" | "repository";
    scopeId: number;
    briefing?: string;
    milestoneSummary?: string;
    commitShas: string;
    groupSuggestion?: string;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    briefing: row.briefing,
    milestoneSummary: row.milestoneSummary,
    commitShas: JSON.parse(row.commitShas),
    groupSuggestion: row.groupSuggestion ? JSON.parse(row.groupSuggestion) : undefined,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    createdAt: row.createdAt,
  }));
}
