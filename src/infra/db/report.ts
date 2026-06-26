import { sql } from "@/infra/db/connection";

interface InsertReportInput {
  userId: string;
  repositoryId: number;
  project: string;
  date: string;
  title: string;
  content: string;
  dateStart?: string;
  dateEnd?: string;
  status?: string;
}

export async function insertReport(input: InsertReportInput): Promise<number> {
  const [row] = await sql`
    INSERT INTO reports (user_id, repository_id, project, date, title, content, date_start, date_end, status)
    VALUES (
      ${input.userId},
      ${input.repositoryId},
      ${input.project},
      ${input.date},
      ${input.title},
      ${input.content},
      ${input.dateStart ?? null},
      ${input.dateEnd ?? null},
      ${input.status ?? "completed"}
    )
    RETURNING id
  `;
  return row.id as number;
}

export async function getReportsByUser(userId: string): Promise<any[]> {
  return await sql`
    SELECT r.*, repo.owner, repo.repo
    FROM reports r
    LEFT JOIN repositories repo ON r.repository_id = repo.id
    WHERE r.user_id = ${userId}
    ORDER BY r.date DESC, r.created_at DESC
  `;
}

export async function getReportById(id: number, userId: string): Promise<any | undefined> {
  const [row] = await sql`
    SELECT r.*, repo.owner, repo.repo
    FROM reports r
    LEFT JOIN repositories repo ON r.repository_id = repo.id
    WHERE r.id = ${id} AND r.user_id = ${userId}
  `;
  return row;
}

export async function updateReport(
  id: number,
  userId: string,
  input: { title: string; content: string }
): Promise<boolean> {
  const result = await sql`
    UPDATE reports
    SET title = ${input.title},
        content = ${input.content},
        updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}

export async function deleteReport(id: number, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM reports
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}

export async function updateReportStatus(
  id: number,
  status: string,
  updates?: { title?: string; content?: string }
): Promise<boolean> {
  if (updates?.title && updates?.content) {
    const result = await sql`
      UPDATE reports
      SET status = ${status},
          title = ${updates.title},
          content = ${updates.content},
          updated_at = NOW()
      WHERE id = ${id}
    `;
    return result.count > 0;
  }
  const result = await sql`
    UPDATE reports
    SET status = ${status},
        updated_at = NOW()
    WHERE id = ${id}
  `;
  return result.count > 0;
}
