import Database from "better-sqlite3";

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
