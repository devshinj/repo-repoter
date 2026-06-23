import Database from "better-sqlite3";
import type { Milestone } from "@/core/project/project-types";

export function insertMilestone(
  db: Database.Database,
  input: {
    userId: string;
    projectId?: number;
    repositoryId?: number;
    title: string;
    rawInput?: string;
    deadline?: string;
    status?: "active" | "completed" | "cancelled";
  }
): number {
  const result = db
    .prepare(
      `
    INSERT INTO milestones (user_id, project_id, repository_id, title, raw_input, deadline, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      input.userId,
      input.projectId || null,
      input.repositoryId || null,
      input.title,
      input.rawInput || null,
      input.deadline || null,
      input.status || "active"
    );

  return result.lastInsertRowid as number;
}

export function getMilestonesByUser(db: Database.Database, userId: string): Milestone[] {
  const rows = db
    .prepare(
      `
    SELECT
      id, user_id as userId, project_id as projectId, repository_id as repositoryId,
      title, raw_input as rawInput, deadline, status, created_at as createdAt, updated_at as updatedAt
    FROM milestones
    WHERE user_id = ?
    ORDER BY created_at DESC
  `
    )
    .all(userId) as Array<{
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
  }>;

  return rows.map(mapMilestone);
}

export function getActiveMilestonesByScope(
  db: Database.Database,
  scopeType: "project" | "repository",
  scopeId: number
): Milestone[] {
  const colName = scopeType === "project" ? "project_id" : "repository_id";

  const rows = db
    .prepare(
      `
    SELECT
      id, user_id as userId, project_id as projectId, repository_id as repositoryId,
      title, raw_input as rawInput, deadline, status, created_at as createdAt, updated_at as updatedAt
    FROM milestones
    WHERE ${colName} = ? AND status = 'active'
    ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END ASC, deadline ASC, created_at DESC
  `
    )
    .all(scopeId) as Array<{
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
  }>;

  return rows.map(mapMilestone);
}

export function updateMilestone(
  db: Database.Database,
  id: number,
  input: {
    title?: string;
    rawInput?: string;
    deadline?: string;
    status?: "active" | "completed" | "cancelled";
  }
): void {
  const updates: string[] = [];
  const values: any[] = [];

  if (input.title !== undefined) {
    updates.push("title = ?");
    values.push(input.title);
  }
  if (input.rawInput !== undefined) {
    updates.push("raw_input = ?");
    values.push(input.rawInput);
  }
  if (input.deadline !== undefined) {
    updates.push("deadline = ?");
    values.push(input.deadline);
  }
  if (input.status !== undefined) {
    updates.push("status = ?");
    values.push(input.status);
  }

  if (updates.length === 0) {
    return;
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE milestones SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteMilestone(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
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
