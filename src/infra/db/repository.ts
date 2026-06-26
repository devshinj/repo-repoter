import { sql } from "@/infra/db/connection";
import type { DashboardStats } from "@/core/types";
import { getKstToday, getKstDaysAgo } from "@/core/date-utils";

interface InsertUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

interface UpsertOAuthUserInput {
  name: string;
  email: string;
  provider: string;
  providerAccountId: string;
}

export async function insertUser(input: InsertUserInput): Promise<void> {
  await sql`
    INSERT INTO users (name, email, password_hash, provider)
    VALUES (${input.name}, ${input.email}, ${input.passwordHash}, 'credentials')
  `;
}

export async function getUserByEmail(email: string) {
  const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
  return user as any | undefined;
}

export async function upsertOAuthUser(input: UpsertOAuthUserInput) {
  const [existing] = await sql`
    SELECT * FROM users WHERE provider = ${input.provider} AND provider_account_id = ${input.providerAccountId}
  `;

  if (existing) {
    await sql`UPDATE users SET name = ${input.name}, email = ${input.email} WHERE id = ${existing.id}`;
    return { ...existing, name: input.name, email: input.email };
  }

  const emailUser = await getUserByEmail(input.email);
  if (emailUser) {
    await sql`
      UPDATE users SET provider = ${input.provider}, provider_account_id = ${input.providerAccountId}, name = ${input.name}
      WHERE id = ${emailUser.id}
    `;
    return {
      ...emailUser,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      name: input.name,
    };
  }

  const [inserted] = await sql`
    INSERT INTO users (name, email, password_hash, provider, provider_account_id)
    VALUES (${input.name}, ${input.email}, ${null}, ${input.provider}, ${input.providerAccountId})
    RETURNING id
  `;
  return { id: inserted.id, name: input.name, email: input.email, provider: input.provider };
}

interface InsertRepoInput {
  owner: string;
  repo: string;
  branch: string;
}

interface InsertSyncLogInput {
  repositoryId: number;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
}

export async function insertRepository(input: InsertRepoInput): Promise<void> {
  await sql`
    INSERT INTO repositories (owner, repo, branch) VALUES (${input.owner}, ${input.repo}, ${input.branch})
  `;
}

export async function getActiveRepositories() {
  return await sql`SELECT * FROM repositories WHERE is_active = true` as any[];
}

export async function getRepositoryByOwnerRepo(owner: string, repo: string) {
  const [row] = await sql`SELECT * FROM repositories WHERE owner = ${owner} AND repo = ${repo}`;
  return row as any | undefined;
}

export async function getRepositoryById(id: number) {
  const [row] = await sql`SELECT * FROM repositories WHERE id = ${id}`;
  return row as any | undefined;
}

export async function updateLastSyncedSha(id: number, sha: string): Promise<void> {
  await sql`
    UPDATE repositories SET last_synced_sha = ${sha}, updated_at = NOW() WHERE id = ${id}
  `;
}

export async function deleteRepository(id: number): Promise<void> {
  await sql`DELETE FROM feed_entries WHERE scope_type = 'repository' AND scope_id = ${id}`;
  await sql`DELETE FROM rss_commits WHERE repository_id = ${id}`;
  await sql`DELETE FROM repositories WHERE id = ${id}`;
}

export async function toggleRepository(id: number, isActive: boolean): Promise<void> {
  await sql`
    UPDATE repositories SET is_active = ${isActive}, updated_at = NOW() WHERE id = ${id}
  `;
}

export async function updateAutoReportEnabled(
  id: number,
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET auto_report_enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}

export async function getAutoReportEnabledRepos() {
  return await sql`
    SELECT * FROM repositories WHERE auto_report_enabled = true AND sync_status = 'ready'
  ` as any[];
}

export async function insertSyncLog(input: InsertSyncLogInput): Promise<void> {
  await sql`
    INSERT INTO sync_logs (repository_id, status, commits_processed, tasks_created, error_message, completed_at)
    VALUES (${input.repositoryId}, ${input.status}, ${input.commitsProcessed}, ${input.tasksCreated}, ${input.errorMessage}, NOW())
  `;
}

export async function getRecentSyncLogs(repositoryId: number, limit: number) {
  return await sql`
    SELECT * FROM sync_logs WHERE repository_id = ${repositoryId} ORDER BY started_at DESC LIMIT ${limit}
  ` as any[];
}

// --- User-scoped functions ---

interface InsertRepoForUserInput {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  cloneUrl: string;
  credentialId?: number;
}

interface InsertSyncLogForUserInput {
  repositoryId: number;
  userId: string;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
}

export async function insertRepositoryForUser(input: InsertRepoForUserInput): Promise<void> {
  await sql`
    INSERT INTO repositories (owner, repo, branch, user_id, clone_url, credential_id)
    VALUES (${input.owner}, ${input.repo}, ${input.branch}, ${input.userId}, ${input.cloneUrl}, ${input.credentialId ?? null})
  `;
}

export async function getRepositoriesByUser(userId: string) {
  return await sql`
    SELECT * FROM repositories WHERE user_id = ${userId} AND is_active = true
  ` as any[];
}

export async function getRepositoriesWithLastCommit(userId: string) {
  return await sql`
    SELECT r.*,
      cc.message AS last_commit_message,
      cc.committed_at AS last_commit_at,
      cc.author AS last_commit_author,
      cc.sha AS last_commit_sha,
      sl.completed_at AS last_sync_at,
      sl.status AS last_sync_status
    FROM repositories r
    LEFT JOIN (
      SELECT repository_id, message, committed_at, author, sha,
        ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY committed_at DESC) AS rn
      FROM commit_cache
    ) cc ON cc.repository_id = r.id AND cc.rn = 1
    LEFT JOIN (
      SELECT repository_id, completed_at, status,
        ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY completed_at DESC) AS rn
      FROM sync_logs WHERE user_id = ${userId}
    ) sl ON sl.repository_id = r.id AND sl.rn = 1
    WHERE r.user_id = ${userId} AND r.is_active = true
    ORDER BY r.created_at DESC
  ` as any[];
}

export async function getRepositoryByIdAndUser(id: number, userId: string) {
  const [row] = await sql`
    SELECT * FROM repositories WHERE id = ${id} AND user_id = ${userId}
  `;
  return row as any | undefined;
}

export async function deleteRepositoryForUser(id: number, userId: string): Promise<boolean> {
  await sql`DELETE FROM feed_entries WHERE scope_type = 'repository' AND scope_id = ${id} AND user_id = ${userId}`;
  await sql`DELETE FROM rss_commits WHERE repository_id = ${id}`;
  const result = await sql`DELETE FROM repositories WHERE id = ${id} AND user_id = ${userId}`;
  return result.count > 0;
}

export async function insertSyncLogForUser(input: InsertSyncLogForUserInput): Promise<void> {
  await sql`
    INSERT INTO sync_logs (repository_id, user_id, status, commits_processed, tasks_created, error_message, completed_at)
    VALUES (${input.repositoryId}, ${input.userId}, ${input.status}, ${input.commitsProcessed}, ${input.tasksCreated}, ${input.errorMessage}, NOW())
  `;
}

export async function updateGitAuthor(id: number, userId: string, gitAuthor: string | null): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET git_author = ${gitAuthor}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}

export async function updateSyncStatus(id: number, status: string): Promise<void> {
  await sql`
    UPDATE repositories SET sync_status = ${status}, updated_at = NOW() WHERE id = ${id}
  `;
}

/** 원자적 CAS — sync_status가 ready/error/pending일 때만 syncing으로 전환. syncing이 10분 이상 지속된 경우 stale로 판단하여 재진입 허용 */
export async function trySyncStart(id: number): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET sync_status = 'syncing', updated_at = NOW()
    WHERE id = ${id} AND (
      sync_status IN ('ready', 'error', 'pending')
      OR (sync_status = 'syncing' AND updated_at < NOW() - INTERVAL '10 minutes')
    )
  `;
  return result.count > 0;
}

export async function updateLabel(id: number, userId: string, label: string | null): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET label = ${label}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}

export async function updatePrimaryLanguage(id: number, language: string | null): Promise<void> {
  await sql`
    UPDATE repositories SET primary_language = ${language}, updated_at = NOW() WHERE id = ${id}
  `;
}

export async function getActiveUsersWithRepos(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT user_id FROM repositories WHERE is_active = true AND user_id != ''
  ` as any[];
  return rows.map((r: any) => r.user_id);
}

// --- Commit Cache ---

export interface CacheCommit {
  sha: string;
  repositoryId: number;
  branch: string;
  author: string;
  message: string;
  committedDate: string;   // YYYY-MM-DD
  committedAt: string;     // ISO 8601
  additions: number;
  deletions: number;
  filesChanged: string[];  // array in code, JSONB in DB
}

export async function insertCommitCache(commits: CacheCommit[]): Promise<number> {
  if (commits.length === 0) return 0;

  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const c of commits) {
      const result = await tx`
        INSERT INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed)
        VALUES (${c.sha}, ${c.repositoryId}, ${c.branch}, ${c.author}, ${c.message}, ${c.committedDate}, ${c.committedAt}, ${c.additions}, ${c.deletions}, ${c.filesChanged.length > 0 ? sql.json(c.filesChanged) : null})
        ON CONFLICT (repository_id, sha) DO NOTHING
      `;
      inserted += result.count;
    }
  });
  return inserted;
}

export async function getLatestCacheDate(repositoryId: number): Promise<string | null> {
  const [row] = await sql`
    SELECT MAX(committed_date) as latest FROM commit_cache WHERE repository_id = ${repositoryId}
  ` as { latest: string | null }[];
  return row?.latest ?? null;
}

export async function getLatestCacheDateBatch(repoIds: number[]): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  if (repoIds.length === 0) return result;

  for (const id of repoIds) result.set(id, null);

  const rows = await sql`
    SELECT repository_id, MAX(committed_date) as latest FROM commit_cache
    WHERE repository_id IN ${sql(repoIds)} GROUP BY repository_id
  ` as { repository_id: number; latest: string | null }[];

  for (const row of rows) result.set(row.repository_id, row.latest);
  return result;
}

export async function getCommitCountsByDateRange(
  repoIds: number[],
  since: string,
  until: string,
  authors?: string[]
): Promise<Record<string, number>> {
  if (repoIds.length === 0) return {};

  let rows: { committed_date: string; count: number }[];
  if (authors && authors.length > 0) {
    const authorPatterns = authors.map(a => `%${a}%`);
    rows = await sql`
      SELECT committed_date, COUNT(*)::int as count FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
        AND author ILIKE ANY(${authorPatterns})
      GROUP BY committed_date
    ` as { committed_date: string; count: number }[];
  } else {
    rows = await sql`
      SELECT committed_date, COUNT(*)::int as count FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
      GROUP BY committed_date
    ` as { committed_date: string; count: number }[];
  }

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.committed_date] = row.count;
  return counts;
}

export async function getCommitsByDateRange(
  repoIds: number[],
  since: string,
  until: string,
  authors?: string[]
): Promise<CacheCommit[]> {
  if (repoIds.length === 0) return [];

  let rows: any[];
  if (authors && authors.length > 0) {
    const authorPatterns = authors.map(a => `%${a}%`);
    rows = await sql`
      SELECT sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed
      FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
        AND author ILIKE ANY(${authorPatterns})
      ORDER BY committed_at DESC
    `;
  } else {
    rows = await sql`
      SELECT sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed
      FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
      ORDER BY committed_at DESC
    `;
  }

  return rows.map(r => ({
    sha: r.sha,
    repositoryId: r.repository_id,
    branch: r.branch,
    author: r.author,
    message: r.message,
    committedDate: r.committed_date,
    committedAt: r.committed_at,
    additions: r.additions ?? 0,
    deletions: r.deletions ?? 0,
    filesChanged: Array.isArray(r.files_changed) ? r.files_changed : (r.files_changed ? JSON.parse(r.files_changed) : []),
  }));
}

/** 특정 저장소의 마지막 성공 동기화 시각 조회 */
export async function getRepoLastSyncAt(repoId: number): Promise<string | null> {
  const [row] = await sql`
    SELECT MAX(completed_at) as last FROM sync_logs WHERE repository_id = ${repoId} AND status = 'success'
  ` as { last: string | null }[];
  return row?.last ?? null;
}

/** 주어진 SHA 목록 중 이미 캐시된 것들을 반환 */
export async function getCachedShas(repoId: number, shas: string[]): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  const rows = await sql`
    SELECT sha FROM commit_cache WHERE repository_id = ${repoId} AND sha IN ${sql(shas)}
  ` as { sha: string }[];
  return new Set(rows.map(r => r.sha));
}

export async function getLastSyncCompletedAt(userId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT MAX(completed_at) as last FROM sync_logs WHERE user_id = ${userId} AND status = 'success'
  ` as { last: string | null }[];
  return row?.last ?? null;
}

export interface LastSyncSummary {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  recentSuccessCount: number;
  recentErrorCount: number;
  totalCommitsProcessed: number;
}

export async function getLastSyncSummary(userId: string): Promise<LastSyncSummary> {
  const [success] = await sql`
    SELECT completed_at, commits_processed FROM sync_logs
    WHERE user_id = ${userId} AND status = 'success'
    ORDER BY completed_at DESC LIMIT 1
  ` as { completed_at: string; commits_processed: number }[];

  const [error] = await sql`
    SELECT completed_at, error_message FROM sync_logs
    WHERE user_id = ${userId} AND status = 'error'
    ORDER BY completed_at DESC LIMIT 1
  ` as { completed_at: string; error_message: string | null }[];

  const recent = await sql`
    SELECT status, COUNT(*)::int as cnt, SUM(commits_processed)::int as total_commits
    FROM sync_logs
    WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '1 day'
    GROUP BY status
  ` as { status: string; cnt: number; total_commits: number }[];

  let recentSuccessCount = 0;
  let recentErrorCount = 0;
  let totalCommitsProcessed = 0;
  for (const r of recent) {
    if (r.status === "success") {
      recentSuccessCount = r.cnt;
      totalCommitsProcessed = r.total_commits;
    } else {
      recentErrorCount = r.cnt;
    }
  }

  return {
    lastSuccessAt: success?.completed_at ?? null,
    lastErrorAt: error?.completed_at ?? null,
    lastErrorMessage: error?.error_message ?? null,
    recentSuccessCount,
    recentErrorCount,
    totalCommitsProcessed,
  };
}

export async function getHeatmapCounts(
  userId: string,
  since: string,
  until: string
): Promise<Record<string, number>> {
  const repos = await getRepositoriesByUser(userId);
  if (repos.length === 0) return {};

  const repoIds: number[] = [];
  const allAuthors: string[] = [];

  for (const repo of repos) {
    repoIds.push(repo.id);
    if (repo.git_author) {
      const authors = repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean);
      allAuthors.push(...authors);
    }
  }

  return getCommitCountsByDateRange(
    repoIds,
    since,
    until,
    allAuthors.length > 0 ? allAuthors : undefined
  );
}

export async function getCommitsByDate(
  repoIds: number[],
  date: string,
  authors?: string[]
): Promise<CacheCommit[]> {
  return getCommitsByDateRange(repoIds, date, date, authors);
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const repos = await getRepositoriesByUser(userId);
  const repoIds = repos.map((r: any) => r.id);

  const today = getKstToday();
  const weekStart = getKstDaysAgo(6);

  const allAuthors: string[] = [];
  for (const repo of repos) {
    if (repo.git_author) {
      const authors = repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean);
      allAuthors.push(...authors);
    }
  }

  const [reportRow] = await sql`
    SELECT COUNT(*)::int as cnt FROM reports WHERE user_id = ${userId}
  ` as { cnt: number }[];

  let todayCommits = 0;
  let weekCommits = 0;
  let totalCommits = 0;
  let maxDailyCommits = 0;

  if (repoIds.length > 0) {
    if (allAuthors.length > 0) {
      const authorPatterns = allAuthors.map(a => `%${a}%`);

      const [statsRow] = await sql`
        SELECT
          COUNT(*)::int as total,
          SUM(CASE WHEN committed_date = ${today} THEN 1 ELSE 0 END)::int as today_cnt,
          SUM(CASE WHEN committed_date BETWEEN ${weekStart} AND ${today} THEN 1 ELSE 0 END)::int as week_cnt
        FROM commit_cache
        WHERE repository_id IN ${sql(repoIds)}
          AND author ILIKE ANY(${authorPatterns})
      ` as { total: number; today_cnt: number; week_cnt: number }[];

      totalCommits = statsRow.total ?? 0;
      todayCommits = statsRow.today_cnt ?? 0;
      weekCommits = statsRow.week_cnt ?? 0;

      const [maxRow] = await sql`
        SELECT MAX(daily_count)::int as max_count FROM (
          SELECT committed_date, COUNT(*) as daily_count FROM commit_cache
          WHERE repository_id IN ${sql(repoIds)}
            AND author ILIKE ANY(${authorPatterns})
          GROUP BY committed_date
        ) sub
      ` as { max_count: number | null }[];
      maxDailyCommits = maxRow?.max_count ?? 0;
    } else {
      const [statsRow] = await sql`
        SELECT
          COUNT(*)::int as total,
          SUM(CASE WHEN committed_date = ${today} THEN 1 ELSE 0 END)::int as today_cnt,
          SUM(CASE WHEN committed_date BETWEEN ${weekStart} AND ${today} THEN 1 ELSE 0 END)::int as week_cnt
        FROM commit_cache
        WHERE repository_id IN ${sql(repoIds)}
      ` as { total: number; today_cnt: number; week_cnt: number }[];

      totalCommits = statsRow.total ?? 0;
      todayCommits = statsRow.today_cnt ?? 0;
      weekCommits = statsRow.week_cnt ?? 0;

      const [maxRow] = await sql`
        SELECT MAX(daily_count)::int as max_count FROM (
          SELECT committed_date, COUNT(*) as daily_count FROM commit_cache
          WHERE repository_id IN ${sql(repoIds)}
          GROUP BY committed_date
        ) sub
      ` as { max_count: number | null }[];
      maxDailyCommits = maxRow?.max_count ?? 0;
    }
  }

  return {
    todayCommits,
    weekCommits,
    totalReports: reportRow?.cnt ?? 0,
    repoCount: repos.length,
    totalCommits,
    maxDailyCommits,
  };
}
