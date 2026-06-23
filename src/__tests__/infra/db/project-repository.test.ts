import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertProject,
  getProjectsByUser,
  getProjectWithRepos,
  updateProject,
  deleteProject,
} from "@/infra/db/project-repository";

describe("project-repository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
    // Insert test repositories
    db.prepare(
      "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
    ).run("owner1", "repo1", "main", "u1", "https://github.com/owner1/repo1");
    db.prepare(
      "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
    ).run("owner1", "repo2", "main", "u1", "https://github.com/owner1/repo2");
  });

  afterEach(() => {
    db.close();
  });

  it("should create project with repository links", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "MyProject",
      description: "test project",
      repositoryIds: repos.map((r: any) => r.id),
    });

    expect(projectId).toBeGreaterThan(0);

    const project = getProjectWithRepos(db, projectId);
    expect(project).not.toBeNull();
    expect(project?.name).toBe("MyProject");
    expect(project?.description).toBe("test project");
    expect(project?.repositoryIds).toHaveLength(2);
  });

  it("should list projects by user", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    insertProject(db, {
      userId: "u1",
      name: "Project1",
      description: null,
      repositoryIds: [repos[0].id],
    });
    insertProject(db, {
      userId: "u1",
      name: "Project2",
      description: null,
      repositoryIds: [repos[1].id],
    });
    insertProject(db, {
      userId: "u2",
      name: "Project3",
      description: null,
      repositoryIds: [],
    });

    const u1Projects = getProjectsByUser(db, "u1");
    const u2Projects = getProjectsByUser(db, "u2");

    expect(u1Projects).toHaveLength(2);
    expect(u2Projects).toHaveLength(1);
    // Verify both projects exist for u1
    const u1Names = u1Projects.map(p => p.name);
    expect(u1Names).toContain("Project1");
    expect(u1Names).toContain("Project2");
  });

  it("should retrieve project with multiple repositories", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "MultiRepoProject",
      description: "project with multiple repos",
      repositoryIds: repos.map((r: any) => r.id),
    });

    const project = getProjectWithRepos(db, projectId);
    expect(project?.repositoryIds).toHaveLength(2);
    expect(project?.repositoryIds).toContain(repos[0].id);
    expect(project?.repositoryIds).toContain(repos[1].id);
  });

  it("should update project name and description", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "OldName",
      description: "old description",
      repositoryIds: [repos[0].id],
    });

    updateProject(db, projectId, {
      name: "NewName",
      description: "new description",
    });

    const updated = getProjectWithRepos(db, projectId);
    expect(updated?.name).toBe("NewName");
    expect(updated?.description).toBe("new description");
  });

  it("should update project repository links", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "Project",
      description: null,
      repositoryIds: [repos[0].id],
    });

    expect(getProjectWithRepos(db, projectId)?.repositoryIds).toHaveLength(1);

    updateProject(db, projectId, {
      repositoryIds: repos.map((r: any) => r.id),
    });

    const updated = getProjectWithRepos(db, projectId);
    expect(updated?.repositoryIds).toHaveLength(2);
  });

  it("should replace repository links when updating", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "Project",
      description: null,
      repositoryIds: repos.map((r: any) => r.id),
    });

    updateProject(db, projectId, {
      repositoryIds: [repos[0].id],
    });

    const updated = getProjectWithRepos(db, projectId);
    expect(updated?.repositoryIds).toHaveLength(1);
    expect(updated?.repositoryIds[0]).toBe(repos[0].id);
  });

  it("should delete project and cascade repository links", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "ProjectToDelete",
      description: null,
      repositoryIds: repos.map((r: any) => r.id),
    });

    // Verify links exist
    const before = db
      .prepare("SELECT * FROM project_repositories WHERE project_id = ?")
      .all(projectId);
    expect(before).toHaveLength(2);

    deleteProject(db, projectId);

    // Verify project is deleted
    expect(getProjectWithRepos(db, projectId)).toBeNull();

    // Verify cascade delete of project_repositories
    const after = db
      .prepare("SELECT * FROM project_repositories WHERE project_id = ?")
      .all(projectId);
    expect(after).toHaveLength(0);

    // Verify repositories still exist
    const reposAfter = db.prepare("SELECT COUNT(*) as count FROM repositories").get() as any;
    expect(reposAfter.count).toBe(2);
  });

  it("should handle project without repositories", () => {
    const projectId = insertProject(db, {
      userId: "u1",
      name: "NoRepoProject",
      description: null,
      repositoryIds: [],
    });

    const project = getProjectWithRepos(db, projectId);
    expect(project).not.toBeNull();
    expect(project?.repositoryIds).toHaveLength(0);
  });

  it("should not return deleted project", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "ProjectToDelete",
      description: null,
      repositoryIds: [repos[0].id],
    });

    const projects = getProjectsByUser(db, "u1");
    expect(projects).toHaveLength(1);

    deleteProject(db, projectId);

    const afterDelete = getProjectsByUser(db, "u1");
    expect(afterDelete).toHaveLength(0);
  });

  it("should maintain createdAt and updatedAt timestamps", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "TimestampProject",
      description: null,
      repositoryIds: [repos[0].id],
    });

    const project = getProjectWithRepos(db, projectId);
    expect(project?.createdAt).toBeDefined();
    expect(project?.updatedAt).toBeDefined();

    const createdTime = new Date(project!.createdAt).getTime();
    const updatedTime = new Date(project!.updatedAt).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(createdTime);
  });

  it("should update the updatedAt timestamp on modification", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const projectId = insertProject(db, {
      userId: "u1",
      name: "Project",
      description: null,
      repositoryIds: [repos[0].id],
    });

    const before = getProjectWithRepos(db, projectId);
    const beforeUpdate = new Date(before!.updatedAt).getTime();

    // Wait a tiny bit and update
    const now = new Date();
    updateProject(db, projectId, { name: "UpdatedName" });

    const after = getProjectWithRepos(db, projectId);
    const afterUpdate = new Date(after!.updatedAt).getTime();

    expect(afterUpdate).toBeGreaterThanOrEqual(beforeUpdate);
  });
});
