import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";

describe("createTables", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should create user_credentials table", () => {
    const info = db.prepare("PRAGMA table_info(user_credentials)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("provider");
    expect(columnNames).toContain("credential");
    expect(columnNames).toContain("label");
    expect(columnNames).toContain("metadata");
  });

  it("should allow multiple credentials for same user and provider", () => {
    db.prepare(
      "INSERT INTO user_credentials (user_id, provider, credential) VALUES (?, ?, ?)"
    ).run("user1", "git", "encrypted-token");

    db.prepare(
      "INSERT INTO user_credentials (user_id, provider, credential) VALUES (?, ?, ?)"
    ).run("user1", "git", "another-token");

    const rows = db.prepare(
      "SELECT * FROM user_credentials WHERE user_id = ? AND provider = ?"
    ).all("user1", "git");
    expect(rows).toHaveLength(2);
  });

  it("should have user_id, clone_url, clone_path columns in repositories", () => {
    const info = db.prepare("PRAGMA table_info(repositories)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("clone_url");
    expect(columnNames).toContain("clone_path");
  });

  it("should enforce unique(user_id, clone_url) on repositories", () => {
    db.prepare(
      "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
    ).run("owner1", "repo1", "main", "user1", "https://github.com/owner1/repo1.git");

    expect(() => {
      db.prepare(
        "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
      ).run("owner1", "repo1", "main", "user1", "https://github.com/owner1/repo1.git");
    }).toThrow();
  });

  it("should have user_id column in sync_logs", () => {
    const info = db.prepare("PRAGMA table_info(sync_logs)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("user_id");
  });
});
