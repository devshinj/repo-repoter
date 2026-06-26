import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  insertProject,
  getProjectsByUser,
  getProjectWithRepos,
  updateProject,
  deleteProject,
} from "@/infra/db/project-repository";

describe("project-repository", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
  });

  afterAll(async () => {
    await closeSql();
  });

  async function insertTestRepos(): Promise<any[]> {
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner1', 'repo1', 'main', 'u1', 'https://github.com/owner1/repo1')
    `;
    await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner1', 'repo2', 'main', 'u1', 'https://github.com/owner1/repo2')
    `;
    return await sql`SELECT id FROM repositories ORDER BY id` as any[];
  }

  it("should create project with repository links", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "MyProject",
      description: "test project",
      repositoryIds: repos.map((r: any) => r.id),
    });

    expect(projectId).toBeGreaterThan(0);

    const project = await getProjectWithRepos(projectId);
    expect(project).not.toBeNull();
    expect(project?.name).toBe("MyProject");
    expect(project?.description).toBe("test project");
    expect(project?.repositoryIds).toHaveLength(2);
  });

  it("should list projects by user", async () => {
    const repos = await insertTestRepos();
    await insertProject({
      userId: "u1",
      name: "Project1",
      description: undefined,
      repositoryIds: [repos[0].id],
    });
    await insertProject({
      userId: "u1",
      name: "Project2",
      description: undefined,
      repositoryIds: [repos[1].id],
    });
    await insertProject({
      userId: "u2",
      name: "Project3",
      description: undefined,
      repositoryIds: [],
    });

    const u1Projects = await getProjectsByUser("u1");
    const u2Projects = await getProjectsByUser("u2");

    expect(u1Projects).toHaveLength(2);
    expect(u2Projects).toHaveLength(1);
    const u1Names = u1Projects.map(p => p.name);
    expect(u1Names).toContain("Project1");
    expect(u1Names).toContain("Project2");
  });

  it("should retrieve project with multiple repositories", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "MultiRepoProject",
      description: "project with multiple repos",
      repositoryIds: repos.map((r: any) => r.id),
    });

    const project = await getProjectWithRepos(projectId);
    expect(project?.repositoryIds).toHaveLength(2);
    expect(project?.repositoryIds).toContain(repos[0].id);
    expect(project?.repositoryIds).toContain(repos[1].id);
  });

  it("should update project name and description", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "OldName",
      description: "old description",
      repositoryIds: [repos[0].id],
    });

    await updateProject(projectId, {
      name: "NewName",
      description: "new description",
    });

    const updated = await getProjectWithRepos(projectId);
    expect(updated?.name).toBe("NewName");
    expect(updated?.description).toBe("new description");
  });

  it("should update project repository links", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "Project",
      description: undefined,
      repositoryIds: [repos[0].id],
    });

    expect((await getProjectWithRepos(projectId))?.repositoryIds).toHaveLength(1);

    await updateProject(projectId, {
      repositoryIds: repos.map((r: any) => r.id),
    });

    const updated = await getProjectWithRepos(projectId);
    expect(updated?.repositoryIds).toHaveLength(2);
  });

  it("should replace repository links when updating", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "Project",
      description: undefined,
      repositoryIds: repos.map((r: any) => r.id),
    });

    await updateProject(projectId, {
      repositoryIds: [repos[0].id],
    });

    const updated = await getProjectWithRepos(projectId);
    expect(updated?.repositoryIds).toHaveLength(1);
    expect(updated?.repositoryIds[0]).toBe(repos[0].id);
  });

  it("should delete project and cascade repository links", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "ProjectToDelete",
      description: undefined,
      repositoryIds: repos.map((r: any) => r.id),
    });

    // Verify links exist
    const before = await sql`SELECT * FROM project_repositories WHERE project_id = ${projectId}` as any[];
    expect(before).toHaveLength(2);

    await deleteProject(projectId);

    // Verify project is deleted
    expect(await getProjectWithRepos(projectId)).toBeNull();

    // Verify cascade delete of project_repositories
    const after = await sql`SELECT * FROM project_repositories WHERE project_id = ${projectId}` as any[];
    expect(after).toHaveLength(0);

    // Verify repositories still exist
    const reposAfter = await sql`SELECT COUNT(*) as count FROM repositories` as any[];
    expect(Number(reposAfter[0].count)).toBe(2);
  });

  it("should handle project without repositories", async () => {
    const projectId = await insertProject({
      userId: "u1",
      name: "NoRepoProject",
      description: undefined,
      repositoryIds: [],
    });

    const project = await getProjectWithRepos(projectId);
    expect(project).not.toBeNull();
    expect(project?.repositoryIds).toHaveLength(0);
  });

  it("should not return deleted project", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "ProjectToDelete",
      description: undefined,
      repositoryIds: [repos[0].id],
    });

    const projects = await getProjectsByUser("u1");
    expect(projects).toHaveLength(1);

    await deleteProject(projectId);

    const afterDelete = await getProjectsByUser("u1");
    expect(afterDelete).toHaveLength(0);
  });

  it("should maintain createdAt and updatedAt timestamps", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "TimestampProject",
      description: undefined,
      repositoryIds: [repos[0].id],
    });

    const project = await getProjectWithRepos(projectId);
    expect(project?.createdAt).toBeDefined();
    expect(project?.updatedAt).toBeDefined();

    const createdTime = new Date(project!.createdAt).getTime();
    const updatedTime = new Date(project!.updatedAt).getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(createdTime);
  });

  it("should update the updatedAt timestamp on modification", async () => {
    const repos = await insertTestRepos();
    const projectId = await insertProject({
      userId: "u1",
      name: "Project",
      description: undefined,
      repositoryIds: [repos[0].id],
    });

    const before = await getProjectWithRepos(projectId);
    const beforeUpdate = new Date(before!.updatedAt).getTime();

    await updateProject(projectId, { name: "UpdatedName" });

    const after = await getProjectWithRepos(projectId);
    const afterUpdate = new Date(after!.updatedAt).getTime();

    expect(afterUpdate).toBeGreaterThanOrEqual(beforeUpdate);
  });
});
