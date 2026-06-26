import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  insertMilestone,
  getMilestonesByUser,
  getActiveMilestonesByScope,
  updateMilestone,
  deleteMilestone,
} from "@/infra/db/milestone-repository";

describe("milestone-repository", () => {
  let projectId: number;
  let repositoryId: number;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
  });

  afterAll(async () => {
    await closeSql();
  });

  async function setupProjectAndRepo(): Promise<{ projectId: number; repositoryId: number }> {
    const [proj] = await sql`
      INSERT INTO projects (user_id, name) VALUES ('u1', 'TestProject') RETURNING id
    ` as any[];
    const [repo] = await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner1', 'repo1', 'main', 'u1', 'https://github.com/owner1/repo1')
      RETURNING id
    ` as any[];
    return { projectId: proj.id, repositoryId: repo.id };
  }

  it("should insert and retrieve milestone", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({
      userId: "u1",
      projectId,
      repositoryId: undefined,
      title: "MVP Launch",
      rawInput: "Launch MVP by next month",
      deadline: "2026-07-05",
    });

    expect(milestoneId).toBeGreaterThan(0);

    const milestones = await getMilestonesByUser("u1");
    expect(milestones).toHaveLength(1);
    expect(milestones[0].title).toBe("MVP Launch");
    expect(milestones[0].status).toBe("active");
    expect(milestones[0].deadline).toBe("2026-07-05");
  });

  it("should insert milestone with default active status", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({
      userId: "u1",
      projectId,
      repositoryId: undefined,
      title: "Milestone1",
      rawInput: "m1",
      deadline: undefined,
    });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones[0].status).toBe("active");
  });

  it("should insert milestone with explicit status", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({
      userId: "u1",
      projectId,
      repositoryId: undefined,
      title: "CompletedMilestone",
      rawInput: "m1",
      deadline: undefined,
      status: "completed",
    });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones[0].status).toBe("completed");
  });

  it("should filter active milestones by project scope", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M2", rawInput: "m2", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M3", rawInput: "m3", deadline: undefined, status: "completed" });

    const active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(2);
    expect(active.map((m) => m.title)).toEqual(expect.arrayContaining(["M1", "M2"]));
  });

  it("should filter active milestones by repository scope", async () => {
    const { repositoryId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId: undefined, repositoryId, title: "RM1", rawInput: "rm1", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId: undefined, repositoryId, title: "RM2", rawInput: "rm2", deadline: undefined });

    const active = await getActiveMilestonesByScope("repository", repositoryId);
    expect(active).toHaveLength(2);
  });

  it("should not include completed milestones in active scope", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Active", rawInput: "active", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Completed", rawInput: "completed", deadline: undefined, status: "completed" });

    const active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Active");
  });

  it("should not include cancelled milestones in active scope", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Active", rawInput: "active", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Cancelled", rawInput: "cancelled", deadline: undefined, status: "cancelled" });

    const active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Active");
  });

  it("should list all milestones by user regardless of status", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Active", rawInput: "active", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Completed", rawInput: "completed", deadline: undefined, status: "completed" });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Cancelled", rawInput: "cancelled", deadline: undefined, status: "cancelled" });

    const all = await getMilestonesByUser("u1");
    expect(all).toHaveLength(3);
  });

  it("should update milestone status from active to completed", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });

    let active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(1);

    await updateMilestone(milestoneId, { status: "completed" });

    active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(0);

    const all = await getMilestonesByUser("u1");
    expect(all[0].status).toBe("completed");
  });

  it("should update milestone status to cancelled", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });

    await updateMilestone(milestoneId, { status: "cancelled" });

    const all = await getMilestonesByUser("u1");
    expect(all[0].status).toBe("cancelled");

    const active = await getActiveMilestonesByScope("project", projectId);
    expect(active).toHaveLength(0);
  });

  it("should update milestone title", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "OldTitle", rawInput: "old", deadline: undefined });

    await updateMilestone(milestoneId, { title: "NewTitle" });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones[0].title).toBe("NewTitle");
  });

  it("should update milestone deadline", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: "2026-07-01" });

    await updateMilestone(milestoneId, { deadline: "2026-08-01" });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones[0].deadline).toBe("2026-08-01");
  });

  it("should update multiple milestone fields", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "Original", rawInput: "original", deadline: "2026-07-01" });

    await updateMilestone(milestoneId, {
      title: "Updated",
      deadline: "2026-08-01",
      status: "completed",
    });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones[0].title).toBe("Updated");
    expect(milestones[0].deadline).toBe("2026-08-01");
    expect(milestones[0].status).toBe("completed");
  });

  it("should delete milestone", async () => {
    const { projectId } = await setupProjectAndRepo();

    const milestoneId = await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });

    expect(await getMilestonesByUser("u1")).toHaveLength(1);

    await deleteMilestone(milestoneId);

    expect(await getMilestonesByUser("u1")).toHaveLength(0);
  });

  it("should list milestones by user", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M2", rawInput: "m2", deadline: undefined });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M3", rawInput: "m3", deadline: undefined });

    const milestones = await getMilestonesByUser("u1");
    expect(milestones).toHaveLength(3);
    const titles = milestones.map(m => m.title);
    expect(titles).toContain("M1");
    expect(titles).toContain("M2");
    expect(titles).toContain("M3");
  });

  it("should sort active milestones by deadline then created_at", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: "2026-08-01" });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M2", rawInput: "m2", deadline: "2026-07-01" });
    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M3", rawInput: "m3", deadline: undefined });

    const active = await getActiveMilestonesByScope("project", projectId);
    expect(active.length).toBeGreaterThanOrEqual(3);
    const titles = active.map(m => m.title);
    const m2Index = titles.indexOf("M2");
    const m1Index = titles.indexOf("M1");
    const m3Index = titles.indexOf("M3");
    expect(m2Index).toBeLessThan(m1Index);
    expect(m1Index).toBeLessThan(m3Index);
  });

  it("should maintain createdAt and updatedAt timestamps", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "M1", rawInput: "m1", deadline: undefined });

    const milestone = (await getMilestonesByUser("u1"))[0];
    expect(milestone.createdAt).toBeDefined();
    expect(milestone.updatedAt).toBeDefined();

    const createdTime = new Date(milestone.createdAt).getTime();
    const updatedTime = new Date(milestone.updatedAt).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(createdTime);
  });

  it("should require project_id or repository_id per CHECK constraint", async () => {
    // Attempting to insert milestone with neither project_id nor repository_id should fail
    await expect(
      insertMilestone({
        userId: "u1",
        projectId: undefined,
        repositoryId: undefined,
        title: "GlobalMilestone",
        rawInput: "global",
        deadline: undefined,
      })
    ).rejects.toThrow();

    // Verify no milestone was inserted
    const milestones = await getMilestonesByUser("u1");
    expect(milestones).toHaveLength(0);
  });

  it("should isolate milestones by user", async () => {
    const { projectId } = await setupProjectAndRepo();

    await insertMilestone({ userId: "u1", projectId, repositoryId: undefined, title: "U1M1", rawInput: "u1m1", deadline: undefined });
    await insertMilestone({ userId: "u2", projectId, repositoryId: undefined, title: "U2M1", rawInput: "u2m1", deadline: undefined });

    const u1Milestones = await getMilestonesByUser("u1");
    const u2Milestones = await getMilestonesByUser("u2");

    expect(u1Milestones).toHaveLength(1);
    expect(u2Milestones).toHaveLength(1);
    expect(u1Milestones[0].title).toBe("U1M1");
    expect(u2Milestones[0].title).toBe("U2M1");
  });
});
