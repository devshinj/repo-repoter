import { sql } from "@/infra/db/connection";
import type { Project, ProjectWithRepos } from "@/core/project/project-types";

export async function insertProject(input: {
  userId: string;
  name: string;
  description?: string;
  repositoryIds: number[];
}): Promise<number> {
  return await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO projects (user_id, name, description)
      VALUES (${input.userId}, ${input.name}, ${input.description ?? null})
      RETURNING id
    `;

    const projectId = row.id as number;

    if (input.repositoryIds.length > 0) {
      for (const repoId of input.repositoryIds) {
        await tx`
          INSERT INTO project_repositories (project_id, repository_id)
          VALUES (${projectId}, ${repoId})
        `;
      }
    }

    return projectId;
  });
}

export async function getProjectsByUser(userId: string): Promise<Project[]> {
  const rows = await sql`
    SELECT id, user_id AS "userId", name, description,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM projects
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => ({
    id: row.id as number,
    userId: row.userId as string,
    name: row.name as string,
    description: row.description as string | undefined,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }));
}

export async function getProjectWithRepos(
  projectId: number
): Promise<ProjectWithRepos | null> {
  const [project] = await sql`
    SELECT id, user_id AS "userId", name, description,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM projects
    WHERE id = ${projectId}
  `;

  if (!project) {
    return null;
  }

  const repoRows = await sql`
    SELECT repository_id AS "repositoryId"
    FROM project_repositories
    WHERE project_id = ${projectId}
  `;

  return {
    id: project.id as number,
    userId: project.userId as string,
    name: project.name as string,
    description: project.description as string | undefined,
    createdAt: project.createdAt as string,
    updatedAt: project.updatedAt as string,
    repositoryIds: repoRows.map((r) => r.repositoryId as number),
  };
}

export async function updateProject(
  id: number,
  input: {
    name?: string;
    description?: string;
    repositoryIds?: number[];
  }
): Promise<void> {
  await sql.begin(async (tx) => {
    if (input.name !== undefined || input.description !== undefined) {
      const updates: string[] = [];

      if (input.name !== undefined && input.description !== undefined) {
        await tx`
          UPDATE projects
          SET name = ${input.name}, description = ${input.description}, updated_at = NOW()
          WHERE id = ${id}
        `;
      } else if (input.name !== undefined) {
        await tx`
          UPDATE projects
          SET name = ${input.name}, updated_at = NOW()
          WHERE id = ${id}
        `;
      } else if (input.description !== undefined) {
        await tx`
          UPDATE projects
          SET description = ${input.description}, updated_at = NOW()
          WHERE id = ${id}
        `;
      }
    }

    if (input.repositoryIds !== undefined) {
      // Clear existing links
      await tx`DELETE FROM project_repositories WHERE project_id = ${id}`;

      // Insert new links
      for (const repoId of input.repositoryIds) {
        await tx`
          INSERT INTO project_repositories (project_id, repository_id)
          VALUES (${id}, ${repoId})
        `;
      }
    }
  });
}

export async function deleteProject(id: number): Promise<void> {
  await sql`DELETE FROM feed_entries WHERE scope_type = 'project' AND scope_id = ${id}`;
  await sql`DELETE FROM milestones WHERE project_id = ${id}`;
  await sql`DELETE FROM projects WHERE id = ${id}`;
  // project_repositories cascade deletes via FK
}

export async function getRepositoryProjectId(
  repositoryId: number
): Promise<number | null> {
  const [row] = await sql`
    SELECT project_id AS "projectId"
    FROM project_repositories
    WHERE repository_id = ${repositoryId}
    LIMIT 1
  `;

  return row?.projectId ?? null;
}
