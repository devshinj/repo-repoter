import { sql } from "@/infra/db/connection";
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

export async function getAllUsers(): Promise<AdminUser[]> {
  return sql<AdminUser[]>`
    SELECT u.id, u.name, u.email, u.provider, u.is_active, u.created_at,
           COUNT(r.id) AS repo_count
    FROM users u
    LEFT JOIN repositories r ON r.user_id = u.id::TEXT
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `;
}

export async function getUserStats(): Promise<AdminUserStats> {
  const [row] = await sql<[{ total: number; active: number; inactive: number }]>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive
    FROM users
  `;
  return { total: row.total || 0, active: row.active || 0, inactive: row.inactive || 0 };
}

export async function setUserActive(userId: number, isActive: boolean): Promise<void> {
  await sql`UPDATE users SET is_active = ${isActive} WHERE id = ${userId}`;
}

export async function deleteUser(userId: number): Promise<void> {
  const userIdStr = String(userId);

  await sql.begin(async (tx) => {
    const mappingRows = await tx`
      SELECT id FROM hrms_project_mappings WHERE user_id = ${userIdStr}
    `;
    const mappingIds = mappingRows.map((r: any) => r.id);

    for (const mid of mappingIds) {
      await tx`DELETE FROM hrms_task_logs WHERE mapping_id = ${mid}`;
      await tx`DELETE FROM hrms_mapping_repos WHERE mapping_id = ${mid}`;
    }
    await tx`DELETE FROM hrms_project_mappings WHERE user_id = ${userIdStr}`;

    const lcMappingRows = await tx`
      SELECT id FROM hrms_logicraft_mappings WHERE user_id = ${userIdStr}
    `;
    const lcMappingIds = lcMappingRows.map((r: any) => r.id);

    for (const mid of lcMappingIds) {
      await tx`DELETE FROM hrms_logicraft_task_logs WHERE mapping_id = ${mid}`;
    }
    await tx`DELETE FROM hrms_logicraft_mappings WHERE user_id = ${userIdStr}`;

    await tx`DELETE FROM hrms_api_keys WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM logicraft_api_keys WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM user_credentials WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM feed_entries WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM rss_commits WHERE repository_id IN (SELECT id FROM repositories WHERE user_id = ${userIdStr})`;
    await tx`DELETE FROM milestones WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM repositories WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM users WHERE id = ${userId}`;
  });
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

export async function getSchedulerRepos(): Promise<SchedulerRepoRow[]> {
  return sql<SchedulerRepoRow[]>`
    SELECT
      r.id AS repo_id, r.owner, r.repo, r.branch,
      r.polling_interval_min, r.is_active, r.auto_report_enabled,
      r.sync_status, r.user_id,
      u.name AS user_name, u.email AS user_email,
      sl.completed_at AS last_sync_at, sl.status AS last_sync_status
    FROM repositories r
    JOIN users u ON u.id::TEXT = r.user_id
    LEFT JOIN (
      SELECT repository_id, completed_at, status,
             ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY completed_at DESC) AS rn
      FROM sync_logs
    ) sl ON sl.repository_id = r.id AND sl.rn = 1
    ORDER BY u.name, r.repo
  `;
}

export interface HrmsMappingRow {
  id: number;
  repo_ids: string;
  auto_register: number;
  cron_time: string;
  hrms_project_name: string;
  user_id: string;
}

export async function getHrmsMappings(): Promise<HrmsMappingRow[]> {
  return sql<HrmsMappingRow[]>`
    SELECT hpm.id, hpm.auto_register, hpm.cron_time, hpm.hrms_project_name, hpm.user_id,
           STRING_AGG(hmr.repository_id::TEXT, ',') AS repo_ids
    FROM hrms_project_mappings hpm
    LEFT JOIN hrms_mapping_repos hmr ON hmr.mapping_id = hpm.id
    GROUP BY hpm.id
  `;
}

export interface LogicraftMappingRow {
  id: number;
  auto_register: number;
  cron_time: string;
  logicraft_project_name: string;
  user_id: string;
  hrms_project_id: number;
}

export async function getLogicraftMappings(): Promise<LogicraftMappingRow[]> {
  return sql<LogicraftMappingRow[]>`
    SELECT id, auto_register, cron_time, logicraft_project_name, user_id, hrms_project_id
    FROM hrms_logicraft_mappings
  `;
}

export async function toggleRepoActive(repoId: number, isActive: boolean): Promise<void> {
  await sql`UPDATE repositories SET is_active = ${isActive} WHERE id = ${repoId}`;
}

export async function toggleRepoAutoReport(repoId: number, enabled: boolean): Promise<void> {
  await sql`UPDATE repositories SET auto_report_enabled = ${enabled} WHERE id = ${repoId}`;
}

export async function toggleHrmsAutoRegister(mappingId: number, enabled: boolean): Promise<void> {
  await sql`UPDATE hrms_project_mappings SET auto_register = ${enabled} WHERE id = ${mappingId}`;
}

export async function toggleLogicraftAutoRegister(
  mappingId: number,
  enabled: boolean
): Promise<void> {
  await sql`UPDATE hrms_logicraft_mappings SET auto_register = ${enabled} WHERE id = ${mappingId}`;
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

export async function getSyncLogs(filters: {
  userId?: string;
  repoId?: string;
  status?: string;
  limit?: number;
}): Promise<SyncLogRow[]> {
  const limit = filters.limit || 100;

  return sql<SyncLogRow[]>`
    SELECT sl.id, sl.completed_at, r.repo AS repo_name,
           u.name AS user_name, sl.status,
           sl.commits_processed, sl.tasks_created, sl.error_message
    FROM sync_logs sl
    JOIN repositories r ON r.id = sl.repository_id
    JOIN users u ON u.id::TEXT = sl.user_id
    WHERE TRUE
      ${filters.userId ? sql`AND sl.user_id = ${filters.userId}` : sql``}
      ${filters.repoId ? sql`AND sl.repository_id = ${Number(filters.repoId)}` : sql``}
      ${filters.status ? sql`AND sl.status = ${filters.status}` : sql``}
    ORDER BY sl.completed_at DESC
    LIMIT ${limit}
  `;
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

export async function getHrmsLogs(filters: {
  userId?: string;
  projectId?: string;
  status?: string;
  date?: string;
  limit?: number;
}): Promise<HrmsLogRow[]> {
  const limit = filters.limit || 100;

  return sql<HrmsLogRow[]>`
    SELECT htl.id, htl.created_at, u.name AS user_name,
           hpm.hrms_project_name, htl.target_date, htl.title,
           htl.status, htl.error_message
    FROM hrms_task_logs htl
    JOIN hrms_project_mappings hpm ON hpm.id = htl.mapping_id
    JOIN users u ON u.id::TEXT = hpm.user_id
    WHERE TRUE
      ${filters.userId ? sql`AND hpm.user_id = ${filters.userId}` : sql``}
      ${filters.projectId ? sql`AND hpm.hrms_project_id = ${Number(filters.projectId)}` : sql``}
      ${filters.status ? sql`AND htl.status = ${filters.status}` : sql``}
      ${filters.date ? sql`AND htl.target_date = ${filters.date}` : sql``}
    ORDER BY htl.created_at DESC
    LIMIT ${limit}
  `;
}

export async function getHrmsLogStats(date?: string): Promise<HrmsLogStats> {
  const targetDate = date || getKstToday();
  const [row] = await sql<[{ total: number; success: number; error: number; skipped: number }]>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM hrms_task_logs
    WHERE created_at::DATE = ${targetDate}
  `;
  return {
    total: row.total || 0,
    success: row.success || 0,
    error: row.error || 0,
    skipped: row.skipped || 0,
  };
}

// ── 필터용 목록 ──

export async function getAllUsersForFilter(): Promise<{ id: number; name: string }[]> {
  return sql<{ id: number; name: string }[]>`SELECT id, name FROM users ORDER BY name`;
}

export async function getAllReposForFilter(): Promise<
  { id: number; repo: string; user_id: string }[]
> {
  return sql<{ id: number; repo: string; user_id: string }[]>`
    SELECT id, repo, user_id FROM repositories ORDER BY repo
  `;
}

export async function getAllHrmsProjectsForFilter(): Promise<
  { hrms_project_id: number; hrms_project_name: string }[]
> {
  return sql<{ hrms_project_id: number; hrms_project_name: string }[]>`
    SELECT DISTINCT hrms_project_id, hrms_project_name
    FROM hrms_project_mappings
    ORDER BY hrms_project_name
  `;
}
