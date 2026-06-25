import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createTables, migrateSchema } from "@/infra/db/schema";

/**
 * 구버전 DB에서 최신 코드로 마이그레이션 시 데이터 유실이 없는지 검증.
 * 시나리오: sha가 PK이고, additions/deletions/files_changed가 있는 구 스키마 →
 *           (repository_id, sha) 복합 PK + 모든 컬럼 보존
 */
describe("migration-safety", () => {
  function createOldSchemaDb(): Database.Database {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main',
        last_synced_sha TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        auto_report_enabled INTEGER NOT NULL DEFAULT 0, polling_interval_min INTEGER NOT NULL DEFAULT 15,
        user_id TEXT NOT NULL DEFAULT '', clone_url TEXT NOT NULL DEFAULT '',
        git_author TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, clone_url)
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE user_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL,
        credential TEXT NOT NULL, label TEXT, metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, provider)
      );
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        project TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, repository_id INTEGER NOT NULL,
        status TEXT NOT NULL, commits_processed INTEGER NOT NULL DEFAULT 0,
        tasks_created INTEGER NOT NULL DEFAULT 0, error_message TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
      );
      CREATE TABLE commit_cache (
        sha TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        branch TEXT NOT NULL, author TEXT NOT NULL, message TEXT NOT NULL,
        committed_date TEXT NOT NULL, committed_at TEXT NOT NULL,
        additions INTEGER NOT NULL DEFAULT 0, deletions INTEGER NOT NULL DEFAULT 0,
        files_changed TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE hrms_api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE,
        encrypted_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE hrms_project_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        hrms_project_id INTEGER NOT NULL, hrms_project_name TEXT NOT NULL,
        auto_register INTEGER NOT NULL DEFAULT 0, cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, hrms_project_id)
      );
      CREATE TABLE hrms_mapping_repos (
        mapping_id INTEGER NOT NULL, repository_id INTEGER NOT NULL, PRIMARY KEY (mapping_id, repository_id)
      );
      CREATE TABLE hrms_task_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mapping_id INTEGER NOT NULL,
        hrms_task_id INTEGER, target_date TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('success', 'error')),
        error_message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 테스트 데이터 삽입
    db.exec(`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
        VALUES ('org', 'myrepo', 'main', 'user1', 'https://github.com/org/myrepo');
      INSERT INTO users (name, email, password_hash) VALUES ('Dev', 'dev@test.com', 'hash123');
      INSERT INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed)
        VALUES ('abc123def456', 1, 'main', 'dev', 'feat: important feature', '2026-06-25', '2026-06-25T10:00:00Z', 42, 10, 'src/foo.ts,src/bar.ts');
      INSERT INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed)
        VALUES ('def789ghi012', 1, 'main', 'dev', 'fix: critical bug', '2026-06-24', '2026-06-24T15:30:00Z', 5, 3, 'src/baz.ts');
      INSERT INTO hrms_api_keys (user_id, encrypted_key) VALUES ('user1', 'encrypted_value');
      INSERT INTO reports (user_id, repository_id, project, date, title, content)
        VALUES ('user1', 1, 'myproject', '2026-06-25', 'Daily Report', 'Report content here');
    `);

    return db;
  }

  it("commit_cache: PK 마이그레이션 후 additions/deletions/files_changed 보존", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const rows = db.prepare("SELECT * FROM commit_cache ORDER BY committed_date").all() as any[];
    expect(rows).toHaveLength(2);

    const row1 = rows.find((r: any) => r.sha === "abc123def456");
    expect(row1.additions).toBe(42);
    expect(row1.deletions).toBe(10);
    expect(row1.files_changed).toBe("src/foo.ts,src/bar.ts");

    const row2 = rows.find((r: any) => r.sha === "def789ghi012");
    expect(row2.additions).toBe(5);
    expect(row2.deletions).toBe(3);
    expect(row2.files_changed).toBe("src/baz.ts");

    // PK가 복합키로 변경되었는지
    const pkCols = (db.prepare("PRAGMA table_info(commit_cache)").all() as any[])
      .filter((c: any) => c.pk > 0).map((c: any) => c.name).sort();
    expect(pkCols).toEqual(["repository_id", "sha"]);

    db.close();
  });

  it("users: provider 마이그레이션 후 데이터 보존", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const user = db.prepare("SELECT * FROM users WHERE email = 'dev@test.com'").get() as any;
    expect(user).toBeTruthy();
    expect(user.name).toBe("Dev");
    expect(user.password_hash).toBe("hash123");
    expect(user.provider).toBe("credentials");

    const cols = (db.prepare("PRAGMA table_info(users)").all() as any[]).map((c: any) => c.name);
    expect(cols).toContain("is_active");
    expect(cols).toContain("provider_account_id");

    db.close();
  });

  it("hrms_api_keys: hrms_user_name, scopes 컬럼 추가", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const cols = (db.prepare("PRAGMA table_info(hrms_api_keys)").all() as any[]).map((c: any) => c.name);
    expect(cols).toContain("hrms_user_id");
    expect(cols).toContain("hrms_user_name");
    expect(cols).toContain("scopes");

    // 기존 데이터 보존
    const key = db.prepare("SELECT * FROM hrms_api_keys WHERE user_id = 'user1'").get() as any;
    expect(key.encrypted_key).toBe("encrypted_value");

    db.close();
  });

  it("repositories: sync_status 컬럼 추가", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const cols = (db.prepare("PRAGMA table_info(repositories)").all() as any[]).map((c: any) => c.name);
    expect(cols).toContain("sync_status");
    expect(cols).toContain("credential_id");
    expect(cols).toContain("primary_language");
    expect(cols).toContain("label");

    // 기존 데이터 보존
    const repo = db.prepare("SELECT * FROM repositories WHERE owner = 'org'").get() as any;
    expect(repo.repo).toBe("myrepo");
    expect(repo.sync_status).toBe("pending");

    db.close();
  });

  it("reports: date_start/date_end/status 컬럼 존재 (기존 + 신규 DB 모두)", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const cols = (db.prepare("PRAGMA table_info(reports)").all() as any[]).map((c: any) => c.name);
    expect(cols).toContain("date_start");
    expect(cols).toContain("date_end");
    expect(cols).toContain("status");

    // 기존 보고서 보존
    const report = db.prepare("SELECT * FROM reports WHERE user_id = 'user1'").get() as any;
    expect(report.title).toBe("Daily Report");
    expect(report.status).toBe("completed");

    db.close();
  });

  it("hrms_task_logs: in_progress + skipped CHECK 제약 추가", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const sql = (db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='hrms_task_logs'"
    ).get() as any).sql;
    expect(sql).toContain("in_progress");
    expect(sql).toContain("skipped");

    db.close();
  });

  it("신규 테이블 (projects, milestones, feed_entries, rss_commits) 생성", () => {
    const db = createOldSchemaDb();
    createTables(db);
    migrateSchema(db);

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as any[]).map((t: any) => t.name);

    expect(tables).toContain("projects");
    expect(tables).toContain("project_repositories");
    expect(tables).toContain("milestones");
    expect(tables).toContain("feed_entries");
    expect(tables).toContain("rss_commits");

    db.close();
  });

  it("완전 신규 DB에서도 모든 컬럼 정상 생성", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createTables(db);
    migrateSchema(db);

    // reports에 date_start/date_end/status 있는지
    const reportCols = (db.prepare("PRAGMA table_info(reports)").all() as any[]).map((c: any) => c.name);
    expect(reportCols).toContain("date_start");
    expect(reportCols).toContain("date_end");
    expect(reportCols).toContain("status");

    // commit_cache에 additions/deletions/files_changed 있는지
    const cacheCols = (db.prepare("PRAGMA table_info(commit_cache)").all() as any[]).map((c: any) => c.name);
    expect(cacheCols).toContain("additions");
    expect(cacheCols).toContain("deletions");
    expect(cacheCols).toContain("files_changed");

    db.close();
  });
});
