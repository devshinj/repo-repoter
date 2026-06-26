import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";

async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  ` as any[];
  return rows.map((r: any) => r.column_name);
}

describe("createTables (PostgreSQL)", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeSql();
  });

  it("should create user_credentials table", async () => {
    const columnNames = await getTableColumns("user_credentials");
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("provider");
    expect(columnNames).toContain("credential");
    expect(columnNames).toContain("label");
    expect(columnNames).toContain("metadata");
  });

  it("should allow multiple credentials for same user and provider", async () => {
    await sql`
      INSERT INTO user_credentials (user_id, provider, credential) VALUES ('user1', 'git', 'encrypted-token')
    `;
    await sql`
      INSERT INTO user_credentials (user_id, provider, credential) VALUES ('user1', 'git', 'another-token')
    `;

    const rows = await sql`
      SELECT * FROM user_credentials WHERE user_id = 'user1' AND provider = 'git'
    ` as any[];
    expect(rows).toHaveLength(2);

    // Cleanup
    await sql`DELETE FROM user_credentials WHERE user_id = 'user1'`;
  });

  it("should have user_id, clone_url, sync_status columns in repositories", async () => {
    const columnNames = await getTableColumns("repositories");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("clone_url");
    expect(columnNames).toContain("sync_status");
    expect(columnNames).not.toContain("clone_path");
    expect(columnNames).not.toContain("clone_status");
  });

  it("should have additions, deletions, files_changed columns in commit_cache", async () => {
    const columnNames = await getTableColumns("commit_cache");
    expect(columnNames).toContain("additions");
    expect(columnNames).toContain("deletions");
    expect(columnNames).toContain("files_changed");
  });

  it("should enforce unique(user_id, clone_url) on repositories", async () => {
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner1', 'repo1', 'main', 'user1', 'https://github.com/owner1/repo1.git')
    `;

    await expect(
      sql`
        INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
        VALUES ('owner1', 'repo1', 'main', 'user1', 'https://github.com/owner1/repo1.git')
      `
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM repositories WHERE user_id = 'user1'`;
  });

  it("should have user_id column in sync_logs", async () => {
    const columnNames = await getTableColumns("sync_logs");
    expect(columnNames).toContain("user_id");
  });
});
