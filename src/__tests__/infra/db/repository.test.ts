import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  getRepositoryByIdAndUser,
  deleteRepositoryForUser,
  insertSyncLogForUser,
  getActiveUsersWithRepos,
} from "@/infra/db/repository";

describe("user-scoped repository functions", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
  });

  afterAll(async () => {
    await closeSql();
  });

  it("should insert and retrieve repos for a specific user", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });
    await insertRepositoryForUser({
      userId: "user2",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });

    const user1Repos = await getRepositoriesByUser("user1");
    expect(user1Repos).toHaveLength(1);
    expect(user1Repos[0].owner).toBe("octocat");

    const user2Repos = await getRepositoriesByUser("user2");
    expect(user2Repos).toHaveLength(1);
  });

  it("should get repo by id only if owned by user", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = await getRepositoriesByUser("user1");
    const repoId = repos[0].id;

    expect(await getRepositoryByIdAndUser(repoId, "user1")).toBeDefined();
    expect(await getRepositoryByIdAndUser(repoId, "user2")).toBeUndefined();
  });

  it("should delete repo only if owned by user", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = await getRepositoriesByUser("user1");
    const repoId = repos[0].id;

    const deleted = await deleteRepositoryForUser(repoId, "user2");
    expect(deleted).toBe(false);

    const deleted2 = await deleteRepositoryForUser(repoId, "user1");
    expect(deleted2).toBe(true);
    expect(await getRepositoriesByUser("user1")).toHaveLength(0);
  });

  it("should insert sync log with user_id", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });
    const repos = await getRepositoriesByUser("user1");

    await insertSyncLogForUser({
      repositoryId: repos[0].id,
      userId: "user1",
      status: "success",
      commitsProcessed: 5,
      tasksCreated: 2,
      errorMessage: null,
    });

    const logs = await sql`SELECT * FROM sync_logs WHERE user_id = 'user1'` as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].commits_processed).toBe(5);
  });

  it("should get active users with repos", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "o",
      repo: "r1",
      branch: "main",
      cloneUrl: "https://github.com/o/r1.git",
    });
    await insertRepositoryForUser({
      userId: "user1",
      owner: "o",
      repo: "r2",
      branch: "main",
      cloneUrl: "https://github.com/o/r2.git",
    });
    await insertRepositoryForUser({
      userId: "user2",
      owner: "o",
      repo: "r3",
      branch: "main",
      cloneUrl: "https://github.com/o/r3.git",
    });

    const users = await getActiveUsersWithRepos();
    expect(users).toHaveLength(2);
    expect(users).toContain("user1");
    expect(users).toContain("user2");
  });
});
