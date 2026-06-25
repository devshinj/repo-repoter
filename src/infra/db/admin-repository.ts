import Database from "better-sqlite3";
import { getKstToday } from "@/core/date-utils";

// ── 사용자 관리 ──

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  provider: string;
  is_active: number;
  created_at: string;
  repo_count: number;
}

export interface AdminUserStats {
  total: number;
  active: number;
  inactive: number;
}

export function getAllUsers(db: Database.Database): AdminUser[] {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.provider, u.is_active, u.created_at,
           COUNT(r.id) AS repo_count
    FROM users u
    LEFT JOIN repositories r ON r.user_id = CAST(u.id AS TEXT)
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all() as AdminUser[];
}

export function getUserStats(db: Database.Database): AdminUserStats {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive
    FROM users
  `).get() as any;
  return { total: row.total || 0, active: row.active || 0, inactive: row.inactive || 0 };
}

export function setUserActive(db: Database.Database, userId: number, isActive: boolean): void {
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, userId);
}

export function deleteUser(db: Database.Database, userId: number): void {
  const userIdStr = String(userId);
  const transaction = db.transaction(() => {
    const mappingIds = db.prepare(
      "SELECT id FROM hrms_project_mappings WHERE user_id = ?"
    ).all(userIdStr).map((r: any) => r.id);
    for (const mid of mappingIds) {
      db.prepare("DELETE FROM hrms_task_logs WHERE mapping_id = ?").run(mid);
      db.prepare("DELETE FROM hrms_mapping_repos WHERE mapping_id = ?").run(mid);
    }
    db.prepare("DELETE FROM hrms_project_mappings WHERE user_id = ?").run(userIdStr);

    const lcMappingIds = db.prepare(
      "SELECT id FROM hrms_logicraft_mappings WHERE user_id = ?"
    ).all(userIdStr).map((r: any) => r.id);
    for (const mid of lcMappingIds) {
      db.prepare("DELETE FROM hrms_logicraft_task_logs WHERE mapping_id = ?").run(mid);
    }
    db.prepare("DELETE FROM hrms_logicraft_mappings WHERE user_id = ?").run(userIdStr);

    db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM logicraft_api_keys WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM repositories WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  transaction();
}

// ── 스케줄러 현황 ──

export interface SchedulerRepoRow {
  repo_id: number;
  owner: string;
  repo: string;
  branch: string;
  polling_interval_min: number;
  is_active: number;
  auto_report_enabled: number;
  sync_status: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export function getSchedulerRepos(db: Database.Database): SchedulerRepoRow[] {
  return db.prepare(`
    SELECT
      r.id AS repo_id, r.owner, r.repo, r.branch,
      r.polling_interval_min, r.is_active, r.auto_report_enabled,
      r.sync_status, r.user_id,
      u.name AS user_name, u.email AS user_email,
      sl.completed_at AS last_sync_at, sl.status AS last_sync_status
    FROM repositories r
    JOIN users u ON CAST(u.id AS TEXT) = r.user_id
    LEFT JOIN (
      SELECT repository_id, completed_at, status,
             ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY completed_at DESC) AS rn
      FROM sync_logs
    ) sl ON sl.repository_id = r.id AND sl.rn = 1
    ORDER BY u.name, r.repo
  `).all() as SchedulerRepoRow[];
}

export interface HrmsMappingRow {
  id: number;
  repo_ids: string;
  auto_register: number;
  cron_time: string;
  hrms_project_name: string;
  user_id: string;
}

export function getHrmsMappings(db: Database.Database): HrmsMappingRow[] {
  return db.prepare(`
    SELECT hpm.id, hpm.auto_register, hpm.cron_time, hpm.hrms_project_name, hpm.user_id,
           GROUP_CONCAT(hmr.repository_id) AS repo_ids
    FROM hrms_project_mappings hpm
    LEFT JOIN hrms_mapping_repos hmr ON hmr.mapping_id = hpm.id
    GROUP BY hpm.id
  `).all() as HrmsMappingRow[];
}

export interface LogicraftMappingRow {
  id: number;
  auto_register: number;
  cron_time: string;
  logicraft_project_name: string;
  user_id: string;
  hrms_project_id: number;
}

export function getLogicraftMappings(db: Database.Database): LogicraftMappingRow[] {
  return db.prepare(`
    SELECT id, auto_register, cron_time, logicraft_project_name, user_id, hrms_project_id
    FROM hrms_logicraft_mappings
  `).all() as LogicraftMappingRow[];
}

export function toggleRepoActive(db: Database.Database, repoId: number, isActive: boolean): void {
  db.prepare("UPDATE repositories SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, repoId);
}

export function toggleRepoAutoReport(db: Database.Database, repoId: number, enabled: boolean): void {
  db.prepare("UPDATE repositories SET auto_report_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, repoId);
}

export function toggleHrmsAutoRegister(db: Database.Database, mappingId: number, enabled: boolean): void {
  db.prepare("UPDATE hrms_project_mappings SET auto_register = ? WHERE id = ?").run(enabled ? 1 : 0, mappingId);
}

export function toggleLogicraftAutoRegister(db: Database.Database, mappingId: number, enabled: boolean): void {
  db.prepare("UPDATE hrms_logicraft_mappings SET auto_register = ? WHERE id = ?").run(enabled ? 1 : 0, mappingId);
}

// ── 동기화 로그 ──

export interface SyncLogRow {
  id: number;
  completed_at: string | null;
  repo_name: string;
  user_name: string;
  status: string;
  commits_processed: number;
  tasks_created: number;
  error_message: string | null;
}

export function getSyncLogs(
  db: Database.Database,
  filters: { userId?: string; repoId?: string; status?: string; limit?: number }
): SyncLogRow[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.userId) {
    conditions.push("sl.user_id = ?");
    params.push(filters.userId);
  }
  if (filters.repoId) {
    conditions.push("sl.repository_id = ?");
    params.push(Number(filters.repoId));
  }
  if (filters.status) {
    conditions.push("sl.status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;

  return db.prepare(`
    SELECT sl.id, sl.completed_at, r.repo AS repo_name,
           u.name AS user_name, sl.status,
           sl.commits_processed, sl.tasks_created, sl.error_message
    FROM sync_logs sl
    JOIN repositories r ON r.id = sl.repository_id
    JOIN users u ON CAST(u.id AS TEXT) = sl.user_id
    ${where}
    ORDER BY sl.completed_at DESC
    LIMIT ?
  `).all(...params, limit) as SyncLogRow[];
}

// ── HRMS 로그 ──

export interface HrmsLogRow {
  id: number;
  created_at: string;
  user_name: string;
  hrms_project_name: string;
  target_date: string;
  title: string;
  status: string;
  error_message: string | null;
}

export interface HrmsLogStats {
  total: number;
  success: number;
  error: number;
  skipped: number;
}

export function getHrmsLogs(
  db: Database.Database,
  filters: { userId?: string; projectId?: string; status?: string; date?: string; limit?: number }
): HrmsLogRow[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.userId) {
    conditions.push("hpm.user_id = ?");
    params.push(filters.userId);
  }
  if (filters.projectId) {
    conditions.push("hpm.hrms_project_id = ?");
    params.push(Number(filters.projectId));
  }
  if (filters.status) {
    conditions.push("htl.status = ?");
    params.push(filters.status);
  }
  if (filters.date) {
    conditions.push("htl.target_date = ?");
    params.push(filters.date);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;

  return db.prepare(`
    SELECT htl.id, htl.created_at, u.name AS user_name,
           hpm.hrms_project_name, htl.target_date, htl.title,
           htl.status, htl.error_message
    FROM hrms_task_logs htl
    JOIN hrms_project_mappings hpm ON hpm.id = htl.mapping_id
    JOIN users u ON CAST(u.id AS TEXT) = hpm.user_id
    ${where}
    ORDER BY htl.created_at DESC
    LIMIT ?
  `).all(...params, limit) as HrmsLogRow[];
}

export function getHrmsLogStats(db: Database.Database, date?: string): HrmsLogStats {
  const targetDate = date || getKstToday();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM hrms_task_logs
    WHERE DATE(created_at) = ?
  `).get(targetDate) as any;
  return {
    total: row.total || 0,
    success: row.success || 0,
    error: row.error || 0,
    skipped: row.skipped || 0,
  };
}

// ── 필터용 목록 ──

export function getAllUsersForFilter(db: Database.Database): { id: number; name: string }[] {
  return db.prepare("SELECT id, name FROM users ORDER BY name").all() as any[];
}

export function getAllReposForFilter(db: Database.Database): { id: number; repo: string; user_id: string }[] {
  return db.prepare("SELECT id, repo, user_id FROM repositories ORDER BY repo").all() as any[];
}

export function getAllHrmsProjectsForFilter(db: Database.Database): { hrms_project_id: number; hrms_project_name: string }[] {
  return db.prepare(
    "SELECT DISTINCT hrms_project_id, hrms_project_name FROM hrms_project_mappings ORDER BY hrms_project_name"
  ).all() as any[];
}
