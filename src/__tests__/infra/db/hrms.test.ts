import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  return db;
}

describe("hrms_api_keys", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts and retrieves an API key", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserName: "신재석",
      scopes: JSON.stringify({ resources: "all", permissions: ["read", "write", "create"] }),
    });

    const row = getHrmsApiKey(db, "user1");
    expect(row).not.toBeNull();
    expect(row!.encrypted_key).toBe("enc_abc");
    expect(row!.hrms_user_name).toBe("신재석");
  });

  it("upserts (updates on conflict)", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_old",
      hrmsUserName: "old",
      scopes: "{}",
    });
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_new",
      hrmsUserName: "new",
      scopes: "{}",
    });

    const row = getHrmsApiKey(db, "user1");
    expect(row!.encrypted_key).toBe("enc_new");
    expect(row!.hrms_user_name).toBe("new");
  });

  it("deletes an API key", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserName: "test",
      scopes: "{}",
    });

    deleteHrmsApiKey(db, "user1");
    expect(getHrmsApiKey(db, "user1")).toBeNull();
  });
});

describe("hrms_project_mappings", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "org", "frontend", "main", "user1", "https://github.com/org/frontend");
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(2, "org", "backend", "main", "user1", "https://github.com/org/backend");
  });

  it("creates a mapping with repos and retrieves it", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: true,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1, 2],
    });

    const mappings = getMappingsByUser(db, "user1");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].hrms_project_name).toBe("CUVIA");
    expect(mappings[0].repos).toHaveLength(2);
  });

  it("updates mapping repos", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1, 2],
    });

    updateMapping(db, id, { repositoryIds: [1], autoRegister: true });

    const m = getMappingById(db, id);
    expect(m!.repos).toHaveLength(1);
    expect(m!.auto_register).toBe(1);
  });

  it("deletes mapping cascades to repos", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1],
    });

    deleteMapping(db, id);
    expect(getMappingById(db, id)).toBeNull();
  });
});

describe("hrms_task_logs", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "org", "frontend", "main", "user1", "https://github.com/org/frontend");
    insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1],
    });
  });

  it("inserts log and checks duplicate", () => {
    expect(hasSuccessLog(db, 1, "2026-06-10")).toBe(false);

    insertTaskLog(db, {
      mappingId: 1,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    expect(hasSuccessLog(db, 1, "2026-06-10")).toBe(true);
  });

  it("retrieves logs by user", () => {
    insertTaskLog(db, {
      mappingId: 1,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    const logs = getTaskLogs(db, "user1");
    expect(logs).toHaveLength(1);
    expect(logs[0].hrms_project_name).toBe("CUVIA");
  });
});
