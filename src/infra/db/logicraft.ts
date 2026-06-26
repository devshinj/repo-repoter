import { sql } from "@/infra/db/connection";

// ── logicraft_api_keys ──

export async function upsertLogicraftApiKey(
  input: { userId: string; encryptedKey: string },
): Promise<void> {
  await sql`
    INSERT INTO logicraft_api_keys (user_id, encrypted_key)
    VALUES (${input.userId}, ${input.encryptedKey})
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_key = EXCLUDED.encrypted_key,
      updated_at = NOW()
  `;
}

export async function getLogicraftApiKey(userId: string): Promise<any | null> {
  const [row] = await sql`
    SELECT id, user_id, encrypted_key, created_at, updated_at FROM logicraft_api_keys WHERE user_id = ${userId}
  `;
  return row ?? null;
}

export async function deleteLogicraftApiKey(userId: string): Promise<void> {
  await sql`DELETE FROM logicraft_api_keys WHERE user_id = ${userId}`;
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

export async function insertLogicraftMapping(input: InsertLogicraftMappingInput): Promise<number> {
  const [result] = await sql`
    INSERT INTO hrms_logicraft_mappings
      (user_id, hrms_project_id, hrms_project_name, logicraft_project_id, logicraft_project_name, auto_register, cron_time)
    VALUES (${input.userId}, ${input.hrmsProjectId}, ${input.hrmsProjectName}, ${input.logicraftProjectId}, ${input.logicraftProjectName}, ${input.autoRegister}, ${input.cronTime})
    RETURNING id
  `;
  return result.id as number;
}

export async function getLogicraftMappingsByUser(userId: string): Promise<any[]> {
  return await sql`
    SELECT id, user_id, hrms_project_id, hrms_project_name,
           logicraft_project_id, logicraft_project_name,
           auto_register, cron_time, created_at, updated_at
    FROM hrms_logicraft_mappings
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

export async function getLogicraftMappingById(id: number): Promise<any | null> {
  const [row] = await sql`
    SELECT id, user_id, hrms_project_id, hrms_project_name,
           logicraft_project_id, logicraft_project_name,
           auto_register, cron_time, created_at, updated_at
    FROM hrms_logicraft_mappings WHERE id = ${id}
  `;
  return row ?? null;
}

interface UpdateLogicraftMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
}

export async function updateLogicraftMapping(id: number, input: UpdateLogicraftMappingInput): Promise<void> {
  if (input.hrmsProjectName !== undefined) {
    await sql`
      UPDATE hrms_logicraft_mappings SET hrms_project_name = ${input.hrmsProjectName}, updated_at = NOW() WHERE id = ${id}
    `;
  }
  if (input.autoRegister !== undefined) {
    await sql`
      UPDATE hrms_logicraft_mappings SET auto_register = ${input.autoRegister}, updated_at = NOW() WHERE id = ${id}
    `;
  }
  if (input.cronTime !== undefined) {
    await sql`
      UPDATE hrms_logicraft_mappings SET cron_time = ${input.cronTime}, updated_at = NOW() WHERE id = ${id}
    `;
  }
}

export async function deleteLogicraftMapping(id: number): Promise<void> {
  await sql`DELETE FROM hrms_logicraft_mappings WHERE id = ${id}`;
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

export async function insertLogicraftTaskLog(input: InsertLogicraftTaskLogInput): Promise<void> {
  await sql`
    INSERT INTO hrms_logicraft_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message, trigger_type)
    VALUES (${input.mappingId}, ${input.hrmsTaskId}, ${input.targetDate}, ${input.title}, ${input.description}, ${input.status}, ${input.errorMessage}, ${input.triggerType ?? "manual"})
  `;
}

export async function getLogicraftTaskLogs(userId: string, limit = 50): Promise<any[]> {
  return await sql`
    SELECT tl.*, lm.hrms_project_name, lm.logicraft_project_name
    FROM hrms_logicraft_task_logs tl
    JOIN hrms_logicraft_mappings lm ON lm.id = tl.mapping_id
    WHERE lm.user_id = ${userId}
    ORDER BY tl.created_at DESC
    LIMIT ${limit}
  `;
}

export async function hasLogicraftSuccessLog(mappingId: number, targetDate: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM hrms_logicraft_task_logs WHERE mapping_id = ${mappingId} AND target_date = ${targetDate} AND status = 'success' LIMIT 1
  `;
  return !!row;
}

export async function getLastLogicraftSuccessLog(mappingId: number, targetDate: string): Promise<{ hrms_task_id: number | null } | null> {
  const [row] = await sql`
    SELECT hrms_task_id FROM hrms_logicraft_task_logs WHERE mapping_id = ${mappingId} AND target_date = ${targetDate} AND status = 'success' ORDER BY created_at DESC LIMIT 1
  `;
  return (row as { hrms_task_id: number | null } | undefined) ?? null;
}

export async function getLogicraftMappingsWithApiKey(userId: string): Promise<any[]> {
  return await sql`
    SELECT lm.id, lm.logicraft_project_id, lm.logicraft_project_name,
           lak.encrypted_key
    FROM hrms_logicraft_mappings lm
    JOIN logicraft_api_keys lak ON lak.user_id = lm.user_id
    WHERE lm.user_id = ${userId}
  `;
}

export async function getAutoRegisterLogicraftMappings(): Promise<any[]> {
  return await sql`
    SELECT lm.*, lak.encrypted_key AS logicraft_encrypted_key, hak.encrypted_key AS hrms_encrypted_key
    FROM hrms_logicraft_mappings lm
    JOIN logicraft_api_keys lak ON lak.user_id = lm.user_id
    JOIN hrms_api_keys hak ON hak.user_id = lm.user_id
    WHERE lm.auto_register = true
  `;
}
