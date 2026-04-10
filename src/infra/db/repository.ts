import Database from "better-sqlite3";

interface InsertUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export function insertUser(db: Database.Database, input: InsertUserInput): void {
  db.prepare(
    "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
  ).run(input.name, input.email, input.passwordHash);
}

export function getUserByEmail(db: Database.Database, email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any | undefined;
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

export function insertRepository(db: Database.Database, input: InsertRepoInput): void {
  db.prepare(
    "INSERT INTO repositories (owner, repo, branch) VALUES (?, ?, ?)"
  ).run(input.owner, input.repo, input.branch);
}

export function getActiveRepositories(db: Database.Database) {
  return db.prepare("SELECT * FROM repositories WHERE is_active = 1").all() as any[];
}

export function getRepositoryByOwnerRepo(db: Database.Database, owner: string, repo: string) {
  return db.prepare("SELECT * FROM repositories WHERE owner = ? AND repo = ?").get(owner, repo) as any | undefined;
}

export function getRepositoryById(db: Database.Database, id: number) {
  return db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as any | undefined;
}

export function updateLastSyncedSha(db: Database.Database, id: number, sha: string): void {
  db.prepare(
    "UPDATE repositories SET last_synced_sha = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(sha, id);
}

export function deleteRepository(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
}

export function toggleRepository(db: Database.Database, id: number, isActive: boolean): void {
  db.prepare(
    "UPDATE repositories SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(isActive ? 1 : 0, id);
}

export function insertSyncLog(db: Database.Database, input: InsertSyncLogInput): void {
  db.prepare(
    "INSERT INTO sync_logs (repository_id, status, commits_processed, tasks_created, error_message, completed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(input.repositoryId, input.status, input.commitsProcessed, input.tasksCreated, input.errorMessage);
}

export function getRecentSyncLogs(db: Database.Database, repositoryId: number, limit: number) {
  return db.prepare(
    "SELECT * FROM sync_logs WHERE repository_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(repositoryId, limit) as any[];
}

// --- User-scoped functions ---

interface InsertRepoForUserInput {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  cloneUrl: string;
}

interface InsertSyncLogForUserInput {
  repositoryId: number;
  userId: string;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
}

export function insertRepositoryForUser(db: Database.Database, input: InsertRepoForUserInput): void {
  db.prepare(
    "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
  ).run(input.owner, input.repo, input.branch, input.userId, input.cloneUrl);
}

export function getRepositoriesByUser(db: Database.Database, userId: string) {
  return db.prepare(
    "SELECT * FROM repositories WHERE user_id = ? AND is_active = 1"
  ).all(userId) as any[];
}

export function getRepositoryByIdAndUser(db: Database.Database, id: number, userId: string) {
  return db.prepare(
    "SELECT * FROM repositories WHERE id = ? AND user_id = ?"
  ).get(id, userId) as any | undefined;
}

export function deleteRepositoryForUser(db: Database.Database, id: number, userId: string): boolean {
  const result = db.prepare(
    "DELETE FROM repositories WHERE id = ? AND user_id = ?"
  ).run(id, userId);
  return result.changes > 0;
}

export function insertSyncLogForUser(db: Database.Database, input: InsertSyncLogForUserInput): void {
  db.prepare(
    "INSERT INTO sync_logs (repository_id, user_id, status, commits_processed, tasks_created, error_message, completed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(input.repositoryId, input.userId, input.status, input.commitsProcessed, input.tasksCreated, input.errorMessage);
}

export function updateGitAuthor(db: Database.Database, id: number, userId: string, gitAuthor: string | null): boolean {
  const result = db.prepare(
    "UPDATE repositories SET git_author = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(gitAuthor, id, userId);
  return result.changes > 0;
}

export function updatePrimaryLanguage(db: Database.Database, id: number, language: string | null): void {
  db.prepare(
    "UPDATE repositories SET primary_language = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(language, id);
}

export function getActiveUsersWithRepos(db: Database.Database): string[] {
  const rows = db.prepare(
    "SELECT DISTINCT user_id FROM repositories WHERE is_active = 1 AND user_id != ''"
  ).all() as any[];
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
}

export function insertCommitCache(db: Database.Database, commits: CacheCommit[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: CacheCommit[]) => {
    let inserted = 0;
    for (const c of rows) {
      const result = stmt.run(c.sha, c.repositoryId, c.branch, c.author, c.message, c.committedDate, c.committedAt);
      inserted += result.changes;
    }
    return inserted;
  });
  return insertMany(commits);
}

export function getLatestCacheDate(db: Database.Database, repositoryId: number): string | null {
  const row = db.prepare(
    "SELECT MAX(committed_date) as latest FROM commit_cache WHERE repository_id = ?"
  ).get(repositoryId) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

export function getCommitCountsByDateRange(
  db: Database.Database,
  repoIds: number[],
  since: string,
  until: string,
  authors?: string[]
): Record<string, number> {
  if (repoIds.length === 0) return {};

  const placeholders = repoIds.map(() => "?").join(",");
  let sql = `SELECT committed_date, COUNT(*) as count FROM commit_cache
    WHERE repository_id IN (${placeholders}) AND committed_date BETWEEN ? AND ?`;
  const params: (string | number)[] = [...repoIds, since, until];

  if (authors && authors.length > 0) {
    const authorClauses = authors.map(() => "author LIKE ?").join(" OR ");
    sql += ` AND (${authorClauses})`;
    params.push(...authors.map(a => `%${a}%`));
  }

  sql += " GROUP BY committed_date";

  const rows = db.prepare(sql).all(...params) as { committed_date: string; count: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.committed_date] = row.count;
  }
  return counts;
}

export function getCommitsByDateRange(
  db: Database.Database,
  repoIds: number[],
  since: string,
  until: string,
  authors?: string[]
): CacheCommit[] {
  if (repoIds.length === 0) return [];

  const placeholders = repoIds.map(() => "?").join(",");
  let sql = `SELECT sha, repository_id, branch, author, message, committed_date, committed_at
    FROM commit_cache
    WHERE repository_id IN (${placeholders}) AND committed_date BETWEEN ? AND ?`;
  const params: (string | number)[] = [...repoIds, since, until];

  if (authors && authors.length > 0) {
    const authorClauses = authors.map(() => "author LIKE ?").join(" OR ");
    sql += ` AND (${authorClauses})`;
    params.push(...authors.map(a => `%${a}%`));
  }

  sql += " ORDER BY committed_at DESC";

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(r => ({
    sha: r.sha,
    repositoryId: r.repository_id,
    branch: r.branch,
    author: r.author,
    message: r.message,
    committedDate: r.committed_date,
    committedAt: r.committed_at,
  }));
}

export function getLastSyncCompletedAt(db: Database.Database, userId: string): string | null {
  const row = db.prepare(
    "SELECT MAX(completed_at) as last FROM sync_logs WHERE user_id = ? AND status = 'success'"
  ).get(userId) as { last: string | null } | undefined;
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

export function getLastSyncSummary(db: Database.Database, userId: string): LastSyncSummary {
  const success = db.prepare(
    "SELECT completed_at, commits_processed FROM sync_logs WHERE user_id = ? AND status = 'success' ORDER BY completed_at DESC LIMIT 1"
  ).get(userId) as { completed_at: string; commits_processed: number } | undefined;

  const error = db.prepare(
    "SELECT completed_at, error_message FROM sync_logs WHERE user_id = ? AND status = 'error' ORDER BY completed_at DESC LIMIT 1"
  ).get(userId) as { completed_at: string; error_message: string | null } | undefined;

  const recent = db.prepare(
    `SELECT status, COUNT(*) as cnt, SUM(commits_processed) as total_commits
     FROM sync_logs WHERE user_id = ? AND completed_at >= datetime('now', '-1 day')
     GROUP BY status`
  ).all(userId) as { status: string; cnt: number; total_commits: number }[];

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

export function getHeatmapCounts(
  db: Database.Database,
  userId: string,
  since: string,
  until: string
): Record<string, number> {
  const repos = getRepositoriesByUser(db, userId);
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
    db,
    repoIds,
    since,
    until,
    allAuthors.length > 0 ? allAuthors : undefined
  );
}

export function getCommitsByDate(
  db: Database.Database,
  repoIds: number[],
  date: string,
  authors?: string[]
): CacheCommit[] {
  return getCommitsByDateRange(db, repoIds, date, date, authors);
}
