import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertMilestone,
  getMilestonesByUser,
  getActiveMilestonesByScope,
  updateMilestone,
  deleteMilestone,
} from "@/infra/db/milestone-repository";

describe("milestone-repository", () => {
  let db: Database.Database;
  let projectId: number;
  let repositoryId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);

    // Insert test project
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "TestProject");
    projectId = (db.prepare("SELECT id FROM projects").get() as any).id;

    // Insert test repository
    db.prepare(
      "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
    ).run("owner1", "repo1", "main", "u1", "https://github.com/owner1/repo1");
    repositoryId = (db.prepare("SELECT id FROM repositories").get() as any).id;
  });

  afterEach(() => {
    db.close();
  });

  it("should insert and retrieve milestone", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "MVP Launch",
      rawInput: "Launch MVP by next month",
      deadline: "2026-07-05",
    });

    expect(milestoneId).toBeGreaterThan(0);

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones).toHaveLength(1);
    expect(milestones[0].title).toBe("MVP Launch");
    expect(milestones[0].status).toBe("active");
    expect(milestones[0].deadline).toBe("2026-07-05");
  });

  it("should insert milestone with default active status", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Milestone1",
      rawInput: "m1",
      deadline: null,
    });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones[0].status).toBe("active");
  });

  it("should insert milestone with explicit status", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "CompletedMilestone",
      rawInput: "m1",
      deadline: null,
      status: "completed",
    });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones[0].status).toBe("completed");
  });

  it("should filter active milestones by project scope", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M2",
      rawInput: "m2",
      deadline: null,
    });
    // Completed milestone should not appear in active
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M3",
      rawInput: "m3",
      deadline: null,
      status: "completed",
    });

    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(2);
    expect(active.map((m) => m.title)).toEqual(expect.arrayContaining(["M1", "M2"]));
  });

  it("should filter active milestones by repository scope", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId: null,
      repositoryId,
      title: "RM1",
      rawInput: "rm1",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u1",
      projectId: null,
      repositoryId,
      title: "RM2",
      rawInput: "rm2",
      deadline: null,
    });

    const active = getActiveMilestonesByScope(db, "repository", repositoryId);
    expect(active).toHaveLength(2);
  });

  it("should not include completed milestones in active scope", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Active",
      rawInput: "active",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Completed",
      rawInput: "completed",
      deadline: null,
      status: "completed",
    });

    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Active");
  });

  it("should not include cancelled milestones in active scope", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Active",
      rawInput: "active",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Cancelled",
      rawInput: "cancelled",
      deadline: null,
      status: "cancelled",
    });

    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Active");
  });

  it("should list all milestones by user regardless of status", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Active",
      rawInput: "active",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Completed",
      rawInput: "completed",
      deadline: null,
      status: "completed",
    });
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Cancelled",
      rawInput: "cancelled",
      deadline: null,
      status: "cancelled",
    });

    const all = getMilestonesByUser(db, "u1");
    expect(all).toHaveLength(3);
  });

  it("should update milestone status from active to completed", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });

    let active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(1);

    updateMilestone(db, milestoneId, { status: "completed" });

    active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(0);

    const all = getMilestonesByUser(db, "u1");
    expect(all[0].status).toBe("completed");
  });

  it("should update milestone status to cancelled", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });

    updateMilestone(db, milestoneId, { status: "cancelled" });

    const all = getMilestonesByUser(db, "u1");
    expect(all[0].status).toBe("cancelled");

    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(0);
  });

  it("should update milestone title", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "OldTitle",
      rawInput: "old",
      deadline: null,
    });

    updateMilestone(db, milestoneId, { title: "NewTitle" });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones[0].title).toBe("NewTitle");
  });

  it("should update milestone deadline", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: "2026-07-01",
    });

    updateMilestone(db, milestoneId, { deadline: "2026-08-01" });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones[0].deadline).toBe("2026-08-01");
  });

  it("should update multiple milestone fields", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "Original",
      rawInput: "original",
      deadline: "2026-07-01",
    });

    updateMilestone(db, milestoneId, {
      title: "Updated",
      deadline: "2026-08-01",
      status: "completed",
    });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones[0].title).toBe("Updated");
    expect(milestones[0].deadline).toBe("2026-08-01");
    expect(milestones[0].status).toBe("completed");
  });

  it("should delete milestone", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });

    expect(getMilestonesByUser(db, "u1")).toHaveLength(1);

    deleteMilestone(db, milestoneId);

    expect(getMilestonesByUser(db, "u1")).toHaveLength(0);
  });

  it("should list milestones by user", () => {
    const m1Id = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });
    const m2Id = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M2",
      rawInput: "m2",
      deadline: null,
    });
    const m3Id = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M3",
      rawInput: "m3",
      deadline: null,
    });

    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones).toHaveLength(3);
    // All three should be present
    const titles = milestones.map(m => m.title);
    expect(titles).toContain("M1");
    expect(titles).toContain("M2");
    expect(titles).toContain("M3");
  });

  it("should sort active milestones by deadline then created_at", () => {
    // M1: deadline 2026-08-01
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: "2026-08-01",
    });
    // M2: deadline 2026-07-01 (earlier)
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M2",
      rawInput: "m2",
      deadline: "2026-07-01",
    });
    // M3: no deadline (nulls sort last)
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M3",
      rawInput: "m3",
      deadline: null,
    });

    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active.length).toBeGreaterThanOrEqual(3);
    // M2 should be before M1, and M1 should be before M3 (deadline-based ordering)
    const titles = active.map(m => m.title);
    const m2Index = titles.indexOf("M2");
    const m1Index = titles.indexOf("M1");
    const m3Index = titles.indexOf("M3");
    expect(m2Index).toBeLessThan(m1Index);
    expect(m1Index).toBeLessThan(m3Index);
  });

  it("should maintain createdAt and updatedAt timestamps", () => {
    const milestoneId = insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "M1",
      rawInput: "m1",
      deadline: null,
    });

    const milestone = getMilestonesByUser(db, "u1")[0];
    expect(milestone.createdAt).toBeDefined();
    expect(milestone.updatedAt).toBeDefined();

    const createdTime = new Date(milestone.createdAt).getTime();
    const updatedTime = new Date(milestone.updatedAt).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(createdTime);
  });

  it("should require project_id or repository_id per CHECK constraint", () => {
    // Attempting to insert milestone with neither project_id nor repository_id should fail
    expect(() => {
      insertMilestone(db, {
        userId: "u1",
        projectId: null,
        repositoryId: null,
        title: "GlobalMilestone",
        rawInput: "global",
        deadline: null,
      });
    }).toThrow();

    // Verify no milestone was inserted
    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones).toHaveLength(0);
  });

  it("should isolate milestones by user", () => {
    insertMilestone(db, {
      userId: "u1",
      projectId,
      repositoryId: null,
      title: "U1M1",
      rawInput: "u1m1",
      deadline: null,
    });
    insertMilestone(db, {
      userId: "u2",
      projectId,
      repositoryId: null,
      title: "U2M1",
      rawInput: "u2m1",
      deadline: null,
    });

    const u1Milestones = getMilestonesByUser(db, "u1");
    const u2Milestones = getMilestonesByUser(db, "u2");

    expect(u1Milestones).toHaveLength(1);
    expect(u2Milestones).toHaveLength(1);
    expect(u1Milestones[0].title).toBe("U1M1");
    expect(u2Milestones[0].title).toBe("U2M1");
  });
});
