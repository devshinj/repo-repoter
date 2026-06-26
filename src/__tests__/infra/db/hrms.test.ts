import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  upsertHrmsApiKey,
  getHrmsApiKey,
  deleteHrmsApiKey,
  insertMapping,
  getMappingsByUser,
  getMappingById,
  updateMapping,
  deleteMapping,
  insertTaskLog,
  getTaskLogs,
  hasSuccessLog,
} from "@/infra/db/hrms";

beforeAll(async () => {
  await initDb();
});

afterEach(async () => {
  await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
});

afterAll(async () => {
  await closeSql();
});

describe("hrms_api_keys", () => {
  it("inserts and retrieves an API key", async () => {
    await upsertHrmsApiKey({
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserId: "cqXKh7GRlDh-VAD7iPaQI",
      hrmsUserName: "신재석",
      scopes: JSON.stringify({ resources: "all", permissions: ["read", "write", "create"] }),
    });

    const row = await getHrmsApiKey("user1");
    expect(row).not.toBeNull();
    expect(row!.encrypted_key).toBe("enc_abc");
    expect(row!.hrms_user_name).toBe("신재석");
  });

  it("upserts (updates on conflict)", async () => {
    await upsertHrmsApiKey({
      userId: "user1",
      encryptedKey: "enc_old",
      hrmsUserId: "old-id",
      hrmsUserName: "old",
      scopes: "{}",
    });
    await upsertHrmsApiKey({
      userId: "user1",
      encryptedKey: "enc_new",
      hrmsUserId: "new-id",
      hrmsUserName: "new",
      scopes: "{}",
    });

    const row = await getHrmsApiKey("user1");
    expect(row!.encrypted_key).toBe("enc_new");
    expect(row!.hrms_user_name).toBe("new");
  });

  it("deletes an API key", async () => {
    await upsertHrmsApiKey({
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserId: "test-id",
      hrmsUserName: "test",
      scopes: "{}",
    });

    await deleteHrmsApiKey("user1");
    expect(await getHrmsApiKey("user1")).toBeNull();
  });
});

describe("hrms_project_mappings", () => {
  async function insertTestRepos() {
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('org', 'frontend', 'main', 'user1', 'https://github.com/org/frontend')
    `;
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('org', 'backend', 'main', 'user1', 'https://github.com/org/backend')
    `;
  }

  it("creates a mapping with repos and retrieves it", async () => {
    await insertTestRepos();
    const repos = await sql`SELECT id FROM repositories ORDER BY id` as any[];

    const id = await insertMapping({
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: true,
      cronTime: "0 9 * * 1-5",
      repositoryIds: repos.map((r: any) => r.id),
    });

    const mappings = await getMappingsByUser("user1");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].hrms_project_name).toBe("CUVIA");
    expect(mappings[0].repos).toHaveLength(2);
  });

  it("updates mapping repos", async () => {
    await insertTestRepos();
    const repos = await sql`SELECT id FROM repositories ORDER BY id` as any[];

    const id = await insertMapping({
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: repos.map((r: any) => r.id),
    });

    await updateMapping(id, { repositoryIds: [repos[0].id], autoRegister: true });

    const m = await getMappingById(id);
    expect(m!.repos).toHaveLength(1);
    expect(m!.auto_register).toBe(true);
  });

  it("deletes mapping cascades to repos", async () => {
    await insertTestRepos();
    const repos = await sql`SELECT id FROM repositories ORDER BY id` as any[];

    const id = await insertMapping({
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [repos[0].id],
    });

    await deleteMapping(id);
    expect(await getMappingById(id)).toBeNull();
  });
});

describe("hrms_task_logs", () => {
  async function setupMappingWithRepo(): Promise<number> {
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('org', 'frontend', 'main', 'user1', 'https://github.com/org/frontend')
    `;
    const [repo] = await sql`SELECT id FROM repositories LIMIT 1` as any[];
    const mappingId = await insertMapping({
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [repo.id],
    });
    return mappingId;
  }

  it("inserts log and checks duplicate", async () => {
    const mappingId = await setupMappingWithRepo();

    expect(await hasSuccessLog(mappingId, "2026-06-10")).toBe(false);

    await insertTaskLog({
      mappingId,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    expect(await hasSuccessLog(mappingId, "2026-06-10")).toBe(true);
  });

  it("retrieves logs by user", async () => {
    const mappingId = await setupMappingWithRepo();

    await insertTaskLog({
      mappingId,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    const logs = await getTaskLogs("user1");
    expect(logs).toHaveLength(1);
    expect(logs[0].hrms_project_name).toBe("CUVIA");
  });
});
