import Database from "better-sqlite3";

// ── hrms_api_keys ──

interface UpsertHrmsApiKeyInput {
  userId: string;
  encryptedKey: string;
  hrmsUserName: string | null;
  scopes: string | null;
}

export function upsertHrmsApiKey(db: Database.Database, input: UpsertHrmsApiKeyInput): void {
  db.prepare(
    `INSERT INTO hrms_api_keys (user_id, encrypted_key, hrms_user_name, scopes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       hrms_user_name = excluded.hrms_user_name,
       scopes = excluded.scopes,
       updated_at = datetime('now')`
  ).run(input.userId, input.encryptedKey, input.hrmsUserName, input.scopes);
}

export function getHrmsApiKey(db: Database.Database, userId: string) {
  return (db.prepare(
    "SELECT * FROM hrms_api_keys WHERE user_id = ?"
  ).get(userId) ?? null) as any | null;
}

export function deleteHrmsApiKey(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userId);
}

// ── hrms_project_mappings + hrms_mapping_repos ──

interface InsertMappingInput {
  userId: string;
  hrmsProjectId: number;
  hrmsProjectName: string;
  autoRegister: boolean;
  cronTime: string;
  repositoryIds: number[];
}

export function insertMapping(db: Database.Database, input: InsertMappingInput): number {
  const result = db.prepare(
    `INSERT INTO hrms_project_mappings (user_id, hrms_project_id, hrms_project_name, auto_register, cron_time)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.userId, input.hrmsProjectId, input.hrmsProjectName, input.autoRegister ? 1 : 0, input.cronTime);

  const mappingId = result.lastInsertRowid as number;

  const repoStmt = db.prepare(
    "INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (?, ?)"
  );
  for (const repoId of input.repositoryIds) {
    repoStmt.run(mappingId, repoId);
  }

  return mappingId;
}

export function getMappingsByUser(db: Database.Database, userId: string) {
  const mappings = db.prepare(
    "SELECT * FROM hrms_project_mappings WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[];

  return mappings.map((m: any) => {
    const repos = db.prepare(
      `SELECT r.id, r.owner, r.repo, r.label
       FROM hrms_mapping_repos mr
       JOIN repositories r ON r.id = mr.repository_id
       WHERE mr.mapping_id = ?`
    ).all(m.id) as any[];
    return { ...m, repos };
  });
}

export function getMappingById(db: Database.Database, id: number) {
  const mapping = db.prepare(
    "SELECT * FROM hrms_project_mappings WHERE id = ?"
  ).get(id) as any | null;

  if (!mapping) return null;

  const repos = db.prepare(
    `SELECT r.id, r.owner, r.repo, r.label
     FROM hrms_mapping_repos mr
     JOIN repositories r ON r.id = mr.repository_id
     WHERE mr.mapping_id = ?`
  ).all(id) as any[];

  return { ...mapping, repos };
}

interface UpdateMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
  repositoryIds?: number[];
}

export function updateMapping(db: Database.Database, id: number, input: UpdateMappingInput): void {
  if (input.hrmsProjectName !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET hrms_project_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.hrmsProjectName, id);
  }
  if (input.autoRegister !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET auto_register = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.autoRegister ? 1 : 0, id);
  }
  if (input.cronTime !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET cron_time = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.cronTime, id);
  }
  if (input.repositoryIds !== undefined) {
    db.prepare("DELETE FROM hrms_mapping_repos WHERE mapping_id = ?").run(id);
    const stmt = db.prepare("INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (?, ?)");
    for (const repoId of input.repositoryIds) {
      stmt.run(id, repoId);
    }
  }
}

export function deleteMapping(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM hrms_project_mappings WHERE id = ?").run(id);
}

// ── hrms_task_logs ──

interface InsertTaskLogInput {
  mappingId: number;
  hrmsTaskId: number | null;
  targetDate: string;
  title: string;
  description: string;
  status: "success" | "error";
  errorMessage: string | null;
}

export function insertTaskLog(db: Database.Database, input: InsertTaskLogInput): void {
  db.prepare(
    `INSERT INTO hrms_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(input.mappingId, input.hrmsTaskId, input.targetDate, input.title, input.description, input.status, input.errorMessage);
}

export function getTaskLogs(db: Database.Database, userId: string, limit = 50) {
  return db.prepare(
    `SELECT tl.*, pm.hrms_project_name
     FROM hrms_task_logs tl
     JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
     WHERE pm.user_id = ?
     ORDER BY tl.created_at DESC
     LIMIT ?`
  ).all(userId, limit) as any[];
}

export function hasSuccessLog(db: Database.Database, mappingId: number, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM hrms_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' LIMIT 1"
  ).get(mappingId, targetDate);
  return !!row;
}

export function getAutoRegisterMappings(db: Database.Database) {
  return db.prepare(
    `SELECT pm.*, hak.encrypted_key
     FROM hrms_project_mappings pm
     JOIN hrms_api_keys hak ON hak.user_id = pm.user_id
     WHERE pm.auto_register = 1`
  ).all() as any[];
}
