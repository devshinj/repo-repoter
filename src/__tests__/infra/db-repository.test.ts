import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertRepository,
  getActiveRepositories,
  updateLastSyncedSha,
  getRepositoryByOwnerRepo,
  deleteRepository,
  insertSyncLog,
  getRecentSyncLogs,
} from "@/infra/db/repository";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  createTables(db);
});

afterEach(() => {
  db.close();
});

describe("repository CRUD", () => {
  it("inserts and retrieves a repository", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repos = getActiveRepositories(db);
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("devshinj");
    expect(repos[0].repo).toBe("my-app");
    expect(repos[0].is_active).toBe(1);
  });

  it("updates last synced SHA", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    updateLastSyncedSha(db, repo!.id, "abc123");
    const updated = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    expect(updated!.last_synced_sha).toBe("abc123");
  });

  it("deletes a repository", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    deleteRepository(db, repo!.id);
    expect(getActiveRepositories(db)).toHaveLength(0);
  });
});

describe("sync logs", () => {
  it("inserts and retrieves sync logs", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    insertSyncLog(db, {
      repositoryId: repo!.id,
      status: "success",
      commitsProcessed: 5,
      tasksCreated: 2,
      errorMessage: null,
    });
    const logs = getRecentSyncLogs(db, repo!.id, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].commits_processed).toBe(5);
    expect(logs[0].status).toBe("success");
  });
});
