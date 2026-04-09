import Database from "better-sqlite3";

interface InsertReportInput {
  userId: string;
  repositoryId: number;
  project: string;
  date: string;
  title: string;
  content: string;
  dateStart?: string;
  dateEnd?: string;
  status?: string;
}

export function insertReport(db: Database.Database, input: InsertReportInput): number {
  const result = db.prepare(
    "INSERT INTO reports (user_id, repository_id, project, date, title, content, date_start, date_end, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    input.userId, input.repositoryId, input.project, input.date,
    input.title, input.content,
    input.dateStart ?? null, input.dateEnd ?? null, input.status ?? "completed"
  );
  return result.lastInsertRowid as number;
}

export function getReportsByUser(db: Database.Database, userId: string) {
  return db.prepare(
    "SELECT r.*, repo.owner, repo.repo FROM reports r LEFT JOIN repositories repo ON r.repository_id = repo.id WHERE r.user_id = ? ORDER BY r.date DESC, r.created_at DESC"
  ).all(userId) as any[];
}

export function getReportById(db: Database.Database, id: number, userId: string) {
  return db.prepare(
    "SELECT r.*, repo.owner, repo.repo FROM reports r LEFT JOIN repositories repo ON r.repository_id = repo.id WHERE r.id = ? AND r.user_id = ?"
  ).get(id, userId) as any | undefined;
}

export function updateReport(db: Database.Database, id: number, userId: string, input: { title: string; content: string }): boolean {
  const result = db.prepare(
    "UPDATE reports SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(input.title, input.content, id, userId);
  return result.changes > 0;
}

export function deleteReport(db: Database.Database, id: number, userId: string): boolean {
  const result = db.prepare(
    "DELETE FROM reports WHERE id = ? AND user_id = ?"
  ).run(id, userId);
  return result.changes > 0;
}

export function updateReportStatus(
  db: Database.Database,
  id: number,
  status: string,
  updates?: { title?: string; content?: string }
): boolean {
  if (updates?.title && updates?.content) {
    const result = db.prepare(
      "UPDATE reports SET status = ?, title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, updates.title, updates.content, id);
    return result.changes > 0;
  }
  const result = db.prepare(
    "UPDATE reports SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
  return result.changes > 0;
}
