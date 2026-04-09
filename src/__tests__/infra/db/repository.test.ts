import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  getRepositoryByIdAndUser,
  deleteRepositoryForUser,
  insertSyncLogForUser,
  getActiveUsersWithRepos,
} from "@/infra/db/repository";

describe("user-scoped repository functions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should insert and retrieve repos for a specific user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });
    insertRepositoryForUser(db, {
      userId: "user2",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });

    const user1Repos = getRepositoriesByUser(db, "user1");
    expect(user1Repos).toHaveLength(1);
    expect(user1Repos[0].owner).toBe("octocat");

    const user2Repos = getRepositoriesByUser(db, "user2");
    expect(user2Repos).toHaveLength(1);
  });

  it("should get repo by id only if owned by user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = getRepositoriesByUser(db, "user1");
    const repoId = repos[0].id;

    expect(getRepositoryByIdAndUser(db, repoId, "user1")).toBeDefined();
    expect(getRepositoryByIdAndUser(db, repoId, "user2")).toBeUndefined();
  });

  it("should delete repo only if owned by user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = getRepositoriesByUser(db, "user1");
    const repoId = repos[0].id;

    const deleted = deleteRepositoryForUser(db, repoId, "user2");
    expect(deleted).toBe(false);

    const deleted2 = deleteRepositoryForUser(db, repoId, "user1");
    expect(deleted2).toBe(true);
    expect(getRepositoriesByUser(db, "user1")).toHaveLength(0);
  });

  it("should insert sync log with user_id", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });
    const repos = getRepositoriesByUser(db, "user1");

    insertSyncLogForUser(db, {
      repositoryId: repos[0].id,
      userId: "user1",
      status: "success",
      commitsProcessed: 5,
      tasksCreated: 2,
      errorMessage: null,
    });

    const logs = db.prepare("SELECT * FROM sync_logs WHERE user_id = ?").all("user1") as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].commits_processed).toBe(5);
  });

  it("should get active users with repos", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "o",
      repo: "r1",
      branch: "main",
      cloneUrl: "https://github.com/o/r1.git",
    });
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "o",
      repo: "r2",
      branch: "main",
      cloneUrl: "https://github.com/o/r2.git",
    });
    insertRepositoryForUser(db, {
      userId: "user2",
      owner: "o",
      repo: "r3",
      branch: "main",
      cloneUrl: "https://github.com/o/r3.git",
    });

    const users = getActiveUsersWithRepos(db);
    expect(users).toHaveLength(2);
    expect(users).toContain("user1");
    expect(users).toContain("user2");
  });
});
