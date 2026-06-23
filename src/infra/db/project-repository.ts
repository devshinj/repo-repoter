import Database from "better-sqlite3";
import type { Project, ProjectWithRepos, Milestone } from "@/core/project/project-types";

export function insertProject(
  db: Database.Database,
  input: {
    userId: string;
    name: string;
    description?: string;
    repositoryIds: number[];
  }
): number {
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `
      INSERT INTO projects (user_id, name, description)
      VALUES (?, ?, ?)
    `
      )
      .run(input.userId, input.name, input.description || null);

    const projectId = result.lastInsertRowid as number;

    if (input.repositoryIds.length > 0) {
      const linkStmt = db.prepare(
        "INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)"
      );
      for (const repoId of input.repositoryIds) {
        linkStmt.run(projectId, repoId);
      }
    }

    return projectId;
  });

  return transaction();
}

export function getProjectsByUser(db: Database.Database, userId: string): Project[] {
  const rows = db
    .prepare(
      `
    SELECT id, user_id as userId, name, description, created_at as createdAt, updated_at as updatedAt
    FROM projects
    WHERE user_id = ?
    ORDER BY created_at DESC
  `
    )
    .all(userId) as Array<{
    id: number;
    userId: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function getProjectWithRepos(
  db: Database.Database,
  projectId: number
): ProjectWithRepos | null {
  const project = db
    .prepare(
      `
    SELECT id, user_id as userId, name, description, created_at as createdAt, updated_at as updatedAt
    FROM projects
    WHERE id = ?
  `
    )
    .get(projectId) as {
    id: number;
    userId: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
  } | undefined;

  if (!project) {
    return null;
  }

  const repos = db
    .prepare(
      `
    SELECT repository_id as repositoryId
    FROM project_repositories
    WHERE project_id = ?
  `
    )
    .all(projectId) as { repositoryId: number }[];

  return {
    id: project.id,
    userId: project.userId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    repositoryIds: repos.map((r) => r.repositoryId),
  };
}

export function updateProject(
  db: Database.Database,
  id: number,
  input: {
    name?: string;
    description?: string;
    repositoryIds?: number[];
  }
): void {
  const transaction = db.transaction(() => {
    if (input.name !== undefined || input.description !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];

      if (input.name !== undefined) {
        updates.push("name = ?");
        values.push(input.name);
      }
      if (input.description !== undefined) {
        updates.push("description = ?");
        values.push(input.description);
      }

      updates.push("updated_at = datetime('now')");
      values.push(id);

      db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    if (input.repositoryIds !== undefined) {
      // Clear existing links
      db.prepare("DELETE FROM project_repositories WHERE project_id = ?").run(id);

      // Insert new links
      const linkStmt = db.prepare(
        "INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)"
      );
      for (const repoId of input.repositoryIds) {
        linkStmt.run(id, repoId);
      }
    }
  });

  transaction();
}

export function deleteProject(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  // project_repositories cascade deletes via FK
}

export function getRepositoryProjectId(
  db: Database.Database,
  repositoryId: number
): number | null {
  const row = db
    .prepare(
      `
    SELECT project_id as projectId
    FROM project_repositories
    WHERE repository_id = ?
    LIMIT 1
  `
    )
    .get(repositoryId) as { projectId: number } | undefined;

  return row?.projectId ?? null;
}
