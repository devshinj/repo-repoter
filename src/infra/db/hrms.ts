import { sql } from "@/infra/db/connection";

// ── hrms_api_keys ──

interface UpsertHrmsApiKeyInput {
  userId: string;
  encryptedKey: string;
  hrmsUserId: string | null;
  hrmsUserName: string | null;
  scopes: string | null;
}

export async function upsertHrmsApiKey(input: UpsertHrmsApiKeyInput): Promise<void> {
  await sql`
    INSERT INTO hrms_api_keys (user_id, encrypted_key, hrms_user_id, hrms_user_name, scopes)
    VALUES (${input.userId}, ${input.encryptedKey}, ${input.hrmsUserId}, ${input.hrmsUserName}, ${input.scopes})
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_key = EXCLUDED.encrypted_key,
      hrms_user_id = EXCLUDED.hrms_user_id,
      hrms_user_name = EXCLUDED.hrms_user_name,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `;
}

export async function getHrmsApiKey(userId: string): Promise<any | null> {
  const [row] = await sql`
    SELECT id, user_id, encrypted_key, hrms_user_id, hrms_user_name, scopes, created_at, updated_at
    FROM hrms_api_keys WHERE user_id = ${userId}
  `;
  return row ?? null;
}

export async function deleteHrmsApiKey(userId: string): Promise<void> {
  await sql`DELETE FROM hrms_api_keys WHERE user_id = ${userId}`;
}

export async function getHrmsStats(userId: string): Promise<{ mappingCount: number; logCount: number; autoCount: number }> {
  const [mappingRow] = await sql`
    SELECT COUNT(*) as cnt FROM hrms_project_mappings WHERE user_id = ${userId}
  `;
  const mappingCount = Number(mappingRow?.cnt ?? 0);

  const [logRow] = await sql`
    SELECT COUNT(*) as cnt FROM hrms_task_logs tl
    JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
    WHERE pm.user_id = ${userId}
  `;
  const logCount = Number(logRow?.cnt ?? 0);

  const [autoRow] = await sql`
    SELECT COUNT(*) as cnt FROM hrms_project_mappings WHERE user_id = ${userId} AND auto_register = true
  `;
  const autoCount = Number(autoRow?.cnt ?? 0);

  return { mappingCount, logCount, autoCount };
}

export async function deleteAllHrmsDataByUser(userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    // 매핑 ID 목록 조회
    const mappingRows = await tx`
      SELECT id FROM hrms_project_mappings WHERE user_id = ${userId}
    `;
    const mappingIds = mappingRows.map((r: any) => r.id);

    if (mappingIds.length > 0) {
      // 등록 이력 삭제
      await tx`DELETE FROM hrms_task_logs WHERE mapping_id = ANY(${mappingIds}::int[])`;
      // 매핑-저장소 관계 삭제
      await tx`DELETE FROM hrms_mapping_repos WHERE mapping_id = ANY(${mappingIds}::int[])`;
    }
    // 매핑 삭제
    await tx`DELETE FROM hrms_project_mappings WHERE user_id = ${userId}`;
    // API Key 삭제
    await tx`DELETE FROM hrms_api_keys WHERE user_id = ${userId}`;
  });
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

export async function insertMapping(input: InsertMappingInput): Promise<number> {
  const [result] = await sql`
    INSERT INTO hrms_project_mappings (user_id, hrms_project_id, hrms_project_name, auto_register, cron_time)
    VALUES (${input.userId}, ${input.hrmsProjectId}, ${input.hrmsProjectName}, ${input.autoRegister}, ${input.cronTime})
    RETURNING id
  `;
  const mappingId = result.id as number;

  for (const repoId of input.repositoryIds) {
    await sql`
      INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (${mappingId}, ${repoId})
    `;
  }

  return mappingId;
}

export async function getMappingsByUser(userId: string): Promise<any[]> {
  const mappings = await sql`
    SELECT id, user_id, hrms_project_id, hrms_project_name, auto_register, cron_time, created_at, updated_at
    FROM hrms_project_mappings WHERE user_id = ${userId} ORDER BY created_at DESC
  `;

  if (mappings.length === 0) return [];

  // 1회 쿼리로 모든 매핑의 repos를 한번에 조회
  const mappingIds = mappings.map((m: any) => m.id);
  const allRepos = await sql`
    SELECT mr.mapping_id, r.id, r.owner, r.repo, r.branch, r.label, r.git_author, r.clone_url, r.credential_id
    FROM hrms_mapping_repos mr
    JOIN repositories r ON r.id = mr.repository_id
    WHERE mr.mapping_id = ANY(${mappingIds}::int[])
  `;

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

export async function getMappingById(id: number): Promise<any | null> {
  const [mapping] = await sql`
    SELECT id, user_id, hrms_project_id, hrms_project_name, auto_register, cron_time, created_at, updated_at
    FROM hrms_project_mappings WHERE id = ${id}
  `;

  if (!mapping) return null;

  const repos = await sql`
    SELECT r.id, r.owner, r.repo, r.branch, r.label, r.git_author, r.clone_url, r.credential_id
    FROM hrms_mapping_repos mr
    JOIN repositories r ON r.id = mr.repository_id
    WHERE mr.mapping_id = ${id}
  `;

  return { ...mapping, repos };
}

interface UpdateMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
  repositoryIds?: number[];
}

export async function updateMapping(id: number, input: UpdateMappingInput): Promise<void> {
  if (input.hrmsProjectName !== undefined) {
    await sql`
      UPDATE hrms_project_mappings SET hrms_project_name = ${input.hrmsProjectName}, updated_at = NOW() WHERE id = ${id}
    `;
  }
  if (input.autoRegister !== undefined) {
    await sql`
      UPDATE hrms_project_mappings SET auto_register = ${input.autoRegister}, updated_at = NOW() WHERE id = ${id}
    `;
  }
  if (input.cronTime !== undefined) {
    await sql`
      UPDATE hrms_project_mappings SET cron_time = ${input.cronTime}, updated_at = NOW() WHERE id = ${id}
    `;
  }
  if (input.repositoryIds !== undefined) {
    await sql`DELETE FROM hrms_mapping_repos WHERE mapping_id = ${id}`;
    for (const repoId of input.repositoryIds) {
      await sql`INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (${id}, ${repoId})`;
    }
  }
}

export async function deleteMapping(id: number): Promise<void> {
  await sql`DELETE FROM hrms_project_mappings WHERE id = ${id}`;
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
  triggerType?: "auto" | "manual";
}

export async function insertTaskLog(input: InsertTaskLogInput): Promise<number> {
  const [result] = await sql`
    INSERT INTO hrms_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message, trigger_type)
    VALUES (${input.mappingId}, ${input.hrmsTaskId}, ${input.targetDate}, ${input.title}, ${input.description}, ${input.status}, ${input.errorMessage}, ${input.triggerType ?? "manual"})
    RETURNING id
  `;
  return result.id as number;
}

/** in_progress → success/error 업데이트 */
export async function updateTaskLog(
  logId: number,
  update: { status: "success" | "error" | "skipped"; hrmsTaskId?: number; title?: string; description?: string; errorMessage?: string | null },
): Promise<void> {
  await sql`
    UPDATE hrms_task_logs SET status = ${update.status}, hrms_task_id = COALESCE(${update.hrmsTaskId ?? null}, hrms_task_id),
    title = COALESCE(${update.title ?? null}, title), description = COALESCE(${update.description ?? null}, description),
    error_message = ${update.errorMessage ?? null} WHERE id = ${logId}
  `;
}

/** 특정 매핑의 in_progress 로그 조회 */
export async function getInProgressLog(mappingId: number): Promise<{ id: number; target_date: string } | null> {
  const [row] = await sql`
    SELECT id, target_date FROM hrms_task_logs WHERE mapping_id = ${mappingId} AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1
  `;
  return (row as { id: number; target_date: string } | undefined) ?? null;
}

export async function getTaskLogs(userId: string, limit = 50): Promise<any[]> {
  return await sql`
    SELECT tl.*, pm.hrms_project_name
    FROM hrms_task_logs tl
    JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
    WHERE pm.user_id = ${userId}
    ORDER BY tl.created_at DESC
    LIMIT ${limit}
  `;
}

export async function getUnifiedTaskLogs(userId: string, limit = 50): Promise<any[]> {
  return await sql`
    SELECT * FROM (
      SELECT 'git' AS source, tl.id, tl.mapping_id, tl.hrms_task_id, tl.target_date,
             tl.title, tl.description, tl.status, tl.error_message, tl.created_at,
             pm.hrms_project_name, NULL AS logicraft_project_name,
             COALESCE(tl.trigger_type, 'manual') AS trigger_type
      FROM hrms_task_logs tl
      JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
      WHERE pm.user_id = ${userId}
      UNION ALL
      SELECT 'logicraft' AS source, tl.id, tl.mapping_id, tl.hrms_task_id, tl.target_date,
             tl.title, tl.description, tl.status, tl.error_message, tl.created_at,
             lm.hrms_project_name, lm.logicraft_project_name,
             COALESCE(tl.trigger_type, 'manual') AS trigger_type
      FROM hrms_logicraft_task_logs tl
      JOIN hrms_logicraft_mappings lm ON lm.id = tl.mapping_id
      WHERE lm.user_id = ${userId}
    ) unified ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function hasSuccessLog(mappingId: number, targetDate: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM hrms_task_logs WHERE mapping_id = ${mappingId} AND target_date = ${targetDate} AND status = 'success' LIMIT 1
  `;
  return !!row;
}

export async function getLastSuccessLog(mappingId: number, targetDate: string): Promise<{ hrms_task_id: number | null } | null> {
  const [row] = await sql`
    SELECT hrms_task_id FROM hrms_task_logs WHERE mapping_id = ${mappingId} AND target_date = ${targetDate} AND status = 'success' ORDER BY created_at DESC LIMIT 1
  `;
  return (row as { hrms_task_id: number | null } | undefined) ?? null;
}

export async function getAutoRegisterMappings(): Promise<any[]> {
  return await sql`
    SELECT pm.*, hak.encrypted_key
    FROM hrms_project_mappings pm
    JOIN hrms_api_keys hak ON hak.user_id = pm.user_id
    WHERE pm.auto_register = true
  `;
}
