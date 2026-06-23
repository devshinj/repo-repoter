import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";

describe("feed/project/milestone tables", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should create projects table with id, user_id, name, description", () => {
    const info = db.prepare("PRAGMA table_info(projects)").all() as any[];
    const names = info.map((c: any) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("name");
    expect(names).toContain("description");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("should create project_repositories table with composite PK", () => {
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "P1");
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run(
      "o",
      "r",
      "main",
      "u1",
      "https://x.com/o/r"
    );
    const projId = (db.prepare("SELECT id FROM projects").get() as any).id;
    const repoId = (db.prepare("SELECT id FROM repositories").get() as any).id;
    db.prepare("INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)").run(projId, repoId);
    // duplicate insert should fail
    expect(() => {
      db.prepare("INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)").run(projId, repoId);
    }).toThrow();
  });

  it("should create milestones table with CHECK constraint", () => {
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "P1");
    const projId = (db.prepare("SELECT id FROM projects").get() as any).id;
    // project_id set is OK
    db.prepare(
      "INSERT INTO milestones (user_id, project_id, title, raw_input, status) VALUES (?, ?, ?, ?, ?)"
    ).run("u1", projId, "Test", "raw", "active");
    // both null should fail
    expect(() => {
      db.prepare("INSERT INTO milestones (user_id, title, raw_input, status) VALUES (?, ?, ?, ?)").run(
        "u1",
        "Test",
        "raw",
        "active"
      );
    }).toThrow();
  });

  it("should create rss_commits table with unique(repository_id, sha)", () => {
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run(
      "o",
      "r",
      "main",
      "u1",
      "https://x.com/o/r"
    );
    const repoId = (db.prepare("SELECT id FROM repositories").get() as any).id;
    db.prepare(
      "INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at) VALUES (?, ?, ?, ?, ?)"
    ).run(repoId, "abc123", "author", "msg", "2026-06-23T10:00:00Z");
    // duplicate should fail
    expect(() => {
      db.prepare(
        "INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at) VALUES (?, ?, ?, ?, ?)"
      ).run(repoId, "abc123", "author", "msg", "2026-06-23T10:00:00Z");
    }).toThrow();
  });

  it("should create feed_entries table with required columns", () => {
    const info = db.prepare("PRAGMA table_info(feed_entries)").all() as any[];
    const names = info.map((c: any) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("scope_type");
    expect(names).toContain("scope_id");
    expect(names).toContain("briefing");
    expect(names).toContain("milestone_summary");
    expect(names).toContain("commit_shas");
    expect(names).toContain("group_suggestion");
    expect(names).toContain("period_start");
    expect(names).toContain("period_end");
    expect(names).toContain("created_at");
  });

  it("should enforce feed_entries scope_type CHECK constraint", () => {
    db.prepare(
      "INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "project", 1, "test", "2026-06-01", "2026-06-30");
    // repository scope_type should also work
    db.prepare(
      "INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "repository", 1, "test", "2026-06-01", "2026-06-30");
    // invalid scope_type should fail
    expect(() => {
      db.prepare(
        "INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, period_start, period_end) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("u1", "invalid", 1, "test", "2026-06-01", "2026-06-30");
    }).toThrow();
  });

  it("should create required indexes", () => {
    const indexes = [
      "idx_rss_commits_repo_sha",
      "idx_rss_commits_feed_entry",
      "idx_feed_entries_user_created",
      "idx_milestones_user_status",
      "idx_projects_user",
    ];
    for (const idx of indexes) {
      const result = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?"
      ).get(idx);
      expect(result).toBeDefined();
    }
  });
});
