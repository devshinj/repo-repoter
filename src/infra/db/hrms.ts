import Database from "better-sqlite3";

// ── hrms_api_keys ──

interface UpsertHrmsApiKeyInput {
  userId: string;
  encryptedKey: string;
  hrmsUserId: string | null;
  hrmsUserName: string | null;
  scopes: string | null;
}

export function upsertHrmsApiKey(db: Database.Database, input: UpsertHrmsApiKeyInput): void {
  db.prepare(
    `INSERT INTO hrms_api_keys (user_id, encrypted_key, hrms_user_id, hrms_user_name, scopes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       hrms_user_id = excluded.hrms_user_id,
       hrms_user_name = excluded.hrms_user_name,
       scopes = excluded.scopes,
       updated_at = datetime('now')`
  ).run(input.userId, input.encryptedKey, input.hrmsUserId, input.hrmsUserName, input.scopes);
}

export function getHrmsApiKey(db: Database.Database, userId: string) {
  return (db.prepare(
    "SELECT id, user_id, encrypted_key, hrms_user_id, hrms_user_name, scopes, created_at, updated_at FROM hrms_api_keys WHERE user_id = ?"
  ).get(userId) ?? null) as any | null;
}

export function deleteHrmsApiKey(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userId);
}

export function getHrmsStats(db: Database.Database, userId: string) {
  const mappingCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM hrms_project_mappings WHERE user_id = ?"
  ).get(userId) as any)?.cnt ?? 0;

  const logCount = (db.prepare(
    `SELECT COUNT(*) as cnt FROM hrms_task_logs tl
     JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
     WHERE pm.user_id = ?`
  ).get(userId) as any)?.cnt ?? 0;

  const autoCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM hrms_project_mappings WHERE user_id = ? AND auto_register = 1"
  ).get(userId) as any)?.cnt ?? 0;

  return { mappingCount, logCount, autoCount };
}

export function deleteAllHrmsDataByUser(db: Database.Database, userId: string): void {
  const deleteTx = db.transaction(() => {
    // 매핑 ID 목록 조회
    const mappingIds = db.prepare(
      "SELECT id FROM hrms_project_mappings WHERE user_id = ?"
    ).all(userId).map((r: any) => r.id);

    if (mappingIds.length > 0) {
      const placeholders = mappingIds.map(() => "?").join(",");
      // 등록 이력 삭제
      db.prepare(`DELETE FROM hrms_task_logs WHERE mapping_id IN (${placeholders})`).run(...mappingIds);
      // 매핑-저장소 관계 삭제
      db.prepare(`DELETE FROM hrms_mapping_repos WHERE mapping_id IN (${placeholders})`).run(...mappingIds);
    }
    // 매핑 삭제
    db.prepare("DELETE FROM hrms_project_mappings WHERE user_id = ?").run(userId);
    // API Key 삭제
    db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userId);
  });
  deleteTx();
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
    "SELECT id, user_id, hrms_project_id, hrms_project_name, auto_register, cron_time, created_at, updated_at FROM hrms_project_mappings WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[];

  if (mappings.length === 0) return [];

  // 1회 쿼리로 모든 매핑의 repos를 한번에 조회
  const mappingIds = mappings.map((m: any) => m.id);
  const placeholders = mappingIds.map(() => "?").join(",");
  const allRepos = db.prepare(
    `SELECT mr.mapping_id, r.id, r.owner, r.repo, r.branch, r.label, r.git_author, r.clone_url, r.credential_id
     FROM hrms_mapping_repos mr
     JOIN repositories r ON r.id = mr.repository_id
     WHERE mr.mapping_id IN (${placeholders})`
  ).all(...mappingIds) as any[];

  // mapping_id별로 그룹핑
  const reposByMapping = new Map<number, any[]>();
  for (const r of allRepos) {
    const list = reposByMapping.get(r.mapping_id) ?? [];
    list.push({ id: r.id, owner: r.owner, repo: r.repo, branch: r.branch, label: r.label, git_author: r.git_author, clone_url: r.clone_url, credential_id: r.credential_id });
    reposByMapping.set(r.mapping_id, list);
  }

  return mappings.map((m: any) => ({
    ...m,
    repos: reposByMapping.get(m.id) ?? [],
  }));
}

export function getMappingById(db: Database.Database, id: number) {
  const mapping = db.prepare(
    "SELECT id, user_id, hrms_project_id, hrms_project_name, auto_register, cron_time, created_at, updated_at FROM hrms_project_mappings WHERE id = ?"
  ).get(id) as any | null;

  if (!mapping) return null;

  const repos = db.prepare(
    `SELECT r.id, r.owner, r.repo, r.branch, r.label, r.git_author, r.clone_url, r.credential_id
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
  status: "success" | "error" | "in_progress" | "skipped";
  errorMessage: string | null;
}

export function insertTaskLog(db: Database.Database, input: InsertTaskLogInput): number {
  const result = db.prepare(
    `INSERT INTO hrms_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(input.mappingId, input.hrmsTaskId, input.targetDate, input.title, input.description, input.status, input.errorMessage);
  return result.lastInsertRowid as number;
}

/** in_progress → success/error 업데이트 */
export function updateTaskLog(
  db: Database.Database,
  logId: number,
  update: { status: "success" | "error" | "skipped"; hrmsTaskId?: number; title?: string; description?: string; errorMessage?: string | null },
): void {
  db.prepare(
    `UPDATE hrms_task_logs SET status = ?, hrms_task_id = COALESCE(?, hrms_task_id),
     title = COALESCE(?, title), description = COALESCE(?, description),
     error_message = ? WHERE id = ?`
  ).run(update.status, update.hrmsTaskId ?? null, update.title ?? null, update.description ?? null, update.errorMessage ?? null, logId);
}

/** 특정 매핑의 in_progress 로그 조회 */
export function getInProgressLog(db: Database.Database, mappingId: number) {
  return db.prepare(
    "SELECT id, target_date FROM hrms_task_logs WHERE mapping_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1"
  ).get(mappingId) as { id: number; target_date: string } | undefined ?? null;
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

export function getUnifiedTaskLogs(db: Database.Database, userId: string, limit = 50) {
  return db.prepare(
    `SELECT * FROM (
       SELECT 'git' AS source, tl.id, tl.mapping_id, tl.hrms_task_id, tl.target_date,
              tl.title, tl.description, tl.status, tl.error_message, tl.created_at,
              pm.hrms_project_name, NULL AS logicraft_project_name
       FROM hrms_task_logs tl
       JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
       WHERE pm.user_id = ?
       UNION ALL
       SELECT 'logicraft' AS source, tl.id, tl.mapping_id, tl.hrms_task_id, tl.target_date,
              tl.title, tl.description, tl.status, tl.error_message, tl.created_at,
              lm.hrms_project_name, lm.logicraft_project_name
       FROM hrms_logicraft_task_logs tl
       JOIN hrms_logicraft_mappings lm ON lm.id = tl.mapping_id
       WHERE lm.user_id = ?
     ) ORDER BY created_at DESC
     LIMIT ?`
  ).all(userId, userId, limit) as any[];
}

export function hasSuccessLog(db: Database.Database, mappingId: number, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM hrms_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' LIMIT 1"
  ).get(mappingId, targetDate);
  return !!row;
}

export function getLastSuccessLog(db: Database.Database, mappingId: number, targetDate: string) {
  return db.prepare(
    "SELECT hrms_task_id FROM hrms_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1"
  ).get(mappingId, targetDate) as { hrms_task_id: number | null } | undefined ?? null;
}

export function getAutoRegisterMappings(db: Database.Database) {
  return db.prepare(
    `SELECT pm.*, hak.encrypted_key
     FROM hrms_project_mappings pm
     JOIN hrms_api_keys hak ON hak.user_id = pm.user_id
     WHERE pm.auto_register = 1`
  ).all() as any[];
}
