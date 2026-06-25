import Database from "better-sqlite3";

// ── logicraft_api_keys ──

export function upsertLogicraftApiKey(
  db: Database.Database,
  input: { userId: string; encryptedKey: string },
): void {
  db.prepare(
    `INSERT INTO logicraft_api_keys (user_id, encrypted_key)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       updated_at = datetime('now')`,
  ).run(input.userId, input.encryptedKey);
}

export function getLogicraftApiKey(db: Database.Database, userId: string) {
  return (
    (db
      .prepare(
        "SELECT id, user_id, encrypted_key, created_at, updated_at FROM logicraft_api_keys WHERE user_id = ?",
      )
      .get(userId) as any) ?? null
  );
}

export function deleteLogicraftApiKey(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM logicraft_api_keys WHERE user_id = ?").run(userId);
}

// ── hrms_logicraft_mappings ──

interface InsertLogicraftMappingInput {
  userId: string;
  hrmsProjectId: number;
  hrmsProjectName: string;
  logicraftProjectId: string;
  logicraftProjectName: string;
  autoRegister: boolean;
  cronTime: string;
}

export function insertLogicraftMapping(db: Database.Database, input: InsertLogicraftMappingInput): number {
  const result = db.prepare(
    `INSERT INTO hrms_logicraft_mappings
       (user_id, hrms_project_id, hrms_project_name, logicraft_project_id, logicraft_project_name, auto_register, cron_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    input.hrmsProjectId,
    input.hrmsProjectName,
    input.logicraftProjectId,
    input.logicraftProjectName,
    input.autoRegister ? 1 : 0,
    input.cronTime,
  );
  return result.lastInsertRowid as number;
}

export function getLogicraftMappingsByUser(db: Database.Database, userId: string) {
  return db.prepare(
    `SELECT id, user_id, hrms_project_id, hrms_project_name,
            logicraft_project_id, logicraft_project_name,
            auto_register, cron_time, created_at, updated_at
     FROM hrms_logicraft_mappings
     WHERE user_id = ?
     ORDER BY created_at DESC`,
  ).all(userId) as any[];
}

export function getLogicraftMappingById(db: Database.Database, id: number) {
  return (
    (db
      .prepare(
        `SELECT id, user_id, hrms_project_id, hrms_project_name,
                logicraft_project_id, logicraft_project_name,
                auto_register, cron_time, created_at, updated_at
         FROM hrms_logicraft_mappings WHERE id = ?`,
      )
      .get(id) as any) ?? null
  );
}

interface UpdateLogicraftMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
}

export function updateLogicraftMapping(db: Database.Database, id: number, input: UpdateLogicraftMappingInput): void {
  if (input.hrmsProjectName !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET hrms_project_name = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.hrmsProjectName, id);
  }
  if (input.autoRegister !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET auto_register = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.autoRegister ? 1 : 0, id);
  }
  if (input.cronTime !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET cron_time = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.cronTime, id);
  }
}

export function deleteLogicraftMapping(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM hrms_logicraft_mappings WHERE id = ?").run(id);
}

// ── hrms_logicraft_task_logs ──

interface InsertLogicraftTaskLogInput {
  mappingId: number;
  hrmsTaskId: number | null;
  targetDate: string;
  title: string;
  description: string;
  status: "success" | "error";
  errorMessage: string | null;
  triggerType?: "auto" | "manual";
}

export function insertLogicraftTaskLog(db: Database.Database, input: InsertLogicraftTaskLogInput): void {
  db.prepare(
    `INSERT INTO hrms_logicraft_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message, trigger_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.mappingId, input.hrmsTaskId, input.targetDate, input.title, input.description, input.status, input.errorMessage, input.triggerType ?? "manual");
}

export function getLogicraftTaskLogs(db: Database.Database, userId: string, limit = 50) {
  return db.prepare(
    `SELECT tl.*, lm.hrms_project_name, lm.logicraft_project_name
     FROM hrms_logicraft_task_logs tl
     JOIN hrms_logicraft_mappings lm ON lm.id = tl.mapping_id
     WHERE lm.user_id = ?
     ORDER BY tl.created_at DESC
     LIMIT ?`,
  ).all(userId, limit) as any[];
}

export function hasLogicraftSuccessLog(db: Database.Database, mappingId: number, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM hrms_logicraft_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' LIMIT 1",
  ).get(mappingId, targetDate);
  return !!row;
}

export function getLastLogicraftSuccessLog(db: Database.Database, mappingId: number, targetDate: string) {
  return (
    (db
      .prepare(
        "SELECT hrms_task_id FROM hrms_logicraft_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1",
      )
      .get(mappingId, targetDate) as { hrms_task_id: number | null } | undefined) ?? null
  );
}

export function getAutoRegisterLogicraftMappings(db: Database.Database) {
  return db.prepare(
    `SELECT lm.*, lak.encrypted_key AS logicraft_encrypted_key, hak.encrypted_key AS hrms_encrypted_key
     FROM hrms_logicraft_mappings lm
     JOIN logicraft_api_keys lak ON lak.user_id = lm.user_id
     JOIN hrms_api_keys hak ON hak.user_id = lm.user_id
     WHERE lm.auto_register = 1`,
  ).all() as any[];
}
