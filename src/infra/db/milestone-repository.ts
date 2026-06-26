import { sql } from "@/infra/db/connection";
import type { Milestone } from "@/core/project/project-types";

export async function insertMilestone(input: {
  userId: string;
  projectId?: number;
  repositoryId?: number;
  title: string;
  rawInput?: string;
  deadline?: string;
  status?: "active" | "completed" | "cancelled";
}): Promise<number> {
  const [row] = await sql`
    INSERT INTO milestones (user_id, project_id, repository_id, title, raw_input, deadline, status)
    VALUES (
      ${input.userId},
      ${input.projectId ?? null},
      ${input.repositoryId ?? null},
      ${input.title},
      ${input.rawInput ?? null},
      ${input.deadline ?? null},
      ${input.status ?? "active"}
    )
    RETURNING id
  `;

  return row.id as number;
}

export async function getMilestonesByUser(userId: string): Promise<Milestone[]> {
  const rows = await sql`
    SELECT
      id,
      user_id AS "userId",
      project_id AS "projectId",
      repository_id AS "repositoryId",
      title,
      raw_input AS "rawInput",
      deadline,
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM milestones
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map(mapMilestone);
}

export async function getActiveMilestonesByScope(
  scopeType: "project" | "repository",
  scopeId: number
): Promise<Milestone[]> {
  const rows =
    scopeType === "project"
      ? await sql`
          SELECT
            id,
            user_id AS "userId",
            project_id AS "projectId",
            repository_id AS "repositoryId",
            title,
            raw_input AS "rawInput",
            deadline,
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM milestones
          WHERE project_id = ${scopeId} AND status = 'active'
          ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END ASC, deadline ASC, created_at DESC
        `
      : await sql`
          SELECT
            id,
            user_id AS "userId",
            project_id AS "projectId",
            repository_id AS "repositoryId",
            title,
            raw_input AS "rawInput",
            deadline,
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM milestones
          WHERE repository_id = ${scopeId} AND status = 'active'
          ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END ASC, deadline ASC, created_at DESC
        `;

  return rows.map(mapMilestone);
}

export async function updateMilestone(
  id: number,
  input: {
    title?: string;
    rawInput?: string;
    deadline?: string;
    status?: "active" | "completed" | "cancelled";
  }
): Promise<void> {
  // Build a partial update map for only the fields that are provided
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates["title"] = input.title;
  if (input.rawInput !== undefined) updates["raw_input"] = input.rawInput;
  if (input.deadline !== undefined) updates["deadline"] = input.deadline;
  if (input.status !== undefined) updates["status"] = input.status;

  if (Object.keys(updates).length === 0) {
    return;
  }

  // postgres.js supports sql(object, ...keys) for safe partial updates
  await sql`
    UPDATE milestones
    SET ${sql(updates)}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getMilestoneById(id: number): Promise<Milestone | null> {
  const [row] = await sql`
    SELECT
      id,
      user_id AS "userId",
      project_id AS "projectId",
      repository_id AS "repositoryId",
      title,
      raw_input AS "rawInput",
      deadline,
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM milestones
    WHERE id = ${id}
  `;

  return row ? mapMilestone(row) : null;
}

export async function deleteMilestone(id: number): Promise<void> {
  await sql`DELETE FROM milestones WHERE id = ${id}`;
}

export function mapMilestone(row: {
  id: number;
  userId: string;
  projectId?: number;
  repositoryId?: number;
  title: string;
  rawInput?: string;
  deadline?: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}): Milestone {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    repositoryId: row.repositoryId,
    title: row.title,
    rawInput: row.rawInput,
    deadline: row.deadline,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
