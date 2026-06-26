import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";

async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  ` as any[];
  return rows.map((r: any) => r.column_name);
}

async function tableExists(tableName: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${tableName}
  ` as any[];
  return !!row;
}

async function indexExists(indexName: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${indexName}
  ` as any[];
  return !!row;
}

describe("feed/project/milestone tables (PostgreSQL)", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeSql();
  });

  it("should create projects table with id, user_id, name, description", async () => {
    const names = await getTableColumns("projects");
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("name");
    expect(names).toContain("description");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("should create project_repositories table with composite PK", async () => {
    const [proj] = await sql`
      INSERT INTO projects (user_id, name) VALUES ('u1', 'P1') RETURNING id
    ` as any[];
    const [repo] = await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('o', 'r', 'main', 'u1', 'https://x.com/o/r') RETURNING id
    ` as any[];

    await sql`
      INSERT INTO project_repositories (project_id, repository_id) VALUES (${proj.id}, ${repo.id})
    `;

    // Duplicate insert should fail (composite PK)
    await expect(
      sql`INSERT INTO project_repositories (project_id, repository_id) VALUES (${proj.id}, ${repo.id})`
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM project_repositories WHERE project_id = ${proj.id}`;
    await sql`DELETE FROM projects WHERE id = ${proj.id}`;
    await sql`DELETE FROM repositories WHERE id = ${repo.id}`;
  });

  it("should create milestones table with CHECK constraint", async () => {
    const [proj] = await sql`
      INSERT INTO projects (user_id, name) VALUES ('u1', 'P1') RETURNING id
    ` as any[];

    // project_id set is OK
    await sql`
      INSERT INTO milestones (user_id, project_id, title, raw_input, status)
      VALUES ('u1', ${proj.id}, 'Test', 'raw', 'active')
    `;

    // Both null should fail
    await expect(
      sql`INSERT INTO milestones (user_id, title, raw_input, status) VALUES ('u1', 'Test', 'raw', 'active')`
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM milestones WHERE user_id = 'u1'`;
    await sql`DELETE FROM projects WHERE id = ${proj.id}`;
  });

  it("should create rss_commits table with unique(repository_id, sha)", async () => {
    const [repo] = await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('o', 'r', 'main', 'u1', 'https://x.com/o/r') RETURNING id
    ` as any[];

    await sql`
      INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at)
      VALUES (${repo.id}, 'abc123', 'author', 'msg', '2026-06-23T10:00:00Z')
    `;

    // Duplicate should fail
    await expect(
      sql`
        INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at)
        VALUES (${repo.id}, 'abc123', 'author', 'msg', '2026-06-23T10:00:00Z')
      `
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM rss_commits WHERE repository_id = ${repo.id}`;
    await sql`DELETE FROM repositories WHERE id = ${repo.id}`;
  });

  it("should create feed_entries table with required columns", async () => {
    const names = await getTableColumns("feed_entries");
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("scope_type");
    expect(names).toContain("scope_id");
    expect(names).toContain("briefing");
    expect(names).toContain("milestone_summary");
    expect(names).toContain("commit_shas");
    expect(names).toContain("group_suggestion");
    expect(names).toContain("period_start");
    expect(names).toContain("period_end");
    expect(names).toContain("created_at");
  });

  it("should enforce feed_entries scope_type CHECK constraint", async () => {
    await sql`
      INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end)
      VALUES ('u1', 'project', 1, 'test', '2026-06-01', '2026-06-30')
    `;
    await sql`
      INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end)
      VALUES ('u1', 'repository', 1, 'test', '2026-06-01', '2026-06-30')
    `;

    // Invalid scope_type should fail
    await expect(
      sql`
        INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end)
        VALUES ('u1', 'invalid', 1, 'test', '2026-06-01', '2026-06-30')
      `
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM feed_entries WHERE user_id = 'u1'`;
  });

  it("should create required indexes", async () => {
    const indexes = [
      "idx_rss_commits_repo_sha",
      "idx_rss_commits_feed_entry",
      "idx_feed_entries_user_created",
      "idx_milestones_user_status",
      "idx_projects_user",
    ];
    for (const idx of indexes) {
      const exists = await indexExists(idx);
      expect(exists, `Index ${idx} should exist`).toBe(true);
    }
  });
});
