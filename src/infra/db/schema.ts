import Database from "better-sqlite3";

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      last_synced_sha TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      polling_interval_min INTEGER NOT NULL DEFAULT 15,
      user_id TEXT NOT NULL DEFAULT '',
      clone_url TEXT NOT NULL DEFAULT '',
      clone_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, clone_url)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      credential TEXT NOT NULL,
      label TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      project TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      commits_processed INTEGER NOT NULL DEFAULT 0,
      tasks_created INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}

export function migrateSchema(db: Database.Database): void {
  const repoColumns = db.prepare("PRAGMA table_info(repositories)").all() as any[];
  const repoColumnNames = repoColumns.map((c: any) => c.name);

  if (!repoColumnNames.includes("user_id")) {
    db.exec("ALTER TABLE repositories ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }
  if (!repoColumnNames.includes("clone_url")) {
    db.exec("ALTER TABLE repositories ADD COLUMN clone_url TEXT NOT NULL DEFAULT ''");
  }
  if (!repoColumnNames.includes("clone_path")) {
    db.exec("ALTER TABLE repositories ADD COLUMN clone_path TEXT");
  }

  const syncColumns = db.prepare("PRAGMA table_info(sync_logs)").all() as any[];
  const syncColumnNames = syncColumns.map((c: any) => c.name);

  if (!syncColumnNames.includes("user_id")) {
    db.exec("ALTER TABLE sync_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }

  // user_credentials UNIQUE(user_id, provider) 제약 제거 — 다중 자격증명 허용
  const credIndexInfo = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_credentials'"
  ).get() as { sql: string } | undefined;

  if (credIndexInfo?.sql?.includes("UNIQUE(user_id, provider)")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_credentials_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        credential TEXT NOT NULL,
        label TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO user_credentials_new SELECT * FROM user_credentials;
      DROP TABLE user_credentials;
      ALTER TABLE user_credentials_new RENAME TO user_credentials;
    `);
  }

  // reports 테이블 마이그레이션
  const reportColumns = db.prepare("PRAGMA table_info(reports)").all() as any[];
  const reportColumnNames = reportColumns.map((c: any) => c.name);

  if (!reportColumnNames.includes("date_start")) {
    db.exec("ALTER TABLE reports ADD COLUMN date_start TEXT");
  }
  if (!reportColumnNames.includes("date_end")) {
    db.exec("ALTER TABLE reports ADD COLUMN date_end TEXT");
  }
  if (!reportColumnNames.includes("status")) {
    db.exec("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'");
  }
}
