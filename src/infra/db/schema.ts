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
      git_author TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, clone_url)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'credentials',
      provider_account_id TEXT,
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

    CREATE TABLE IF NOT EXISTS commit_cache (
      sha TEXT PRIMARY KEY,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      branch TEXT NOT NULL,
      author TEXT NOT NULL,
      message TEXT NOT NULL,
      committed_date TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_commit_cache_repo_date
      ON commit_cache(repository_id, committed_date);

    CREATE INDEX IF NOT EXISTS idx_repositories_user_active
      ON repositories(user_id, is_active);

    CREATE INDEX IF NOT EXISTS idx_sync_logs_repo_completed
      ON sync_logs(repository_id, completed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_sync_logs_user_status
      ON sync_logs(user_id, status, completed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_reports_user_created
      ON reports(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_credentials_user_provider
      ON user_credentials(user_id, provider);
  `);
}

export function migrateSchema(db: Database.Database): void {
  // users 테이블 마이그레이션: provider, provider_account_id 추가 + password_hash nullable
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as any[];
  const userColumnNames = userColumns.map((c: any) => c.name);
  const passwordCol = userColumns.find((c: any) => c.name === "password_hash");

  if (!userColumnNames.includes("provider") || (passwordCol && passwordCol.notnull === 1)) {
    // password_hash NOT NULL → nullable 변경은 ALTER로 불가하므로 테이블 재생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        provider TEXT NOT NULL DEFAULT 'credentials',
        provider_account_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO users_new (id, name, email, password_hash, created_at)
        SELECT id, name, email, password_hash, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  } else {
    if (!userColumnNames.includes("provider_account_id")) {
      db.exec("ALTER TABLE users ADD COLUMN provider_account_id TEXT");
    }
  }

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
  if (!repoColumnNames.includes("git_author")) {
    db.exec("ALTER TABLE repositories ADD COLUMN git_author TEXT");
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

  if (!repoColumnNames.includes("primary_language")) {
    db.exec("ALTER TABLE repositories ADD COLUMN primary_language TEXT");
  }
  if (!repoColumnNames.includes("label")) {
    db.exec("ALTER TABLE repositories ADD COLUMN label TEXT");
  }
  if (!repoColumnNames.includes("credential_id")) {
    db.exec("ALTER TABLE repositories ADD COLUMN credential_id INTEGER REFERENCES user_credentials(id)");
    // 기존 저장소에 clone_url 호스트 기반으로 credential_id 매핑
    const allRepos = db.prepare("SELECT id, user_id, clone_url FROM repositories").all() as any[];
    for (const repo of allRepos) {
      try {
        const host = new URL(repo.clone_url).hostname;
        const cred = db.prepare(
          "SELECT id, metadata FROM user_credentials WHERE user_id = ? AND provider = 'git'"
        ).all(repo.user_id) as any[];
        const match = cred.find((c: any) => {
          const meta = c.metadata ? JSON.parse(c.metadata) : null;
          return meta?.host?.includes(host);
        });
        if (match) {
          db.prepare("UPDATE repositories SET credential_id = ? WHERE id = ?").run(match.id, repo.id);
        } else if (cred.length === 1) {
          db.prepare("UPDATE repositories SET credential_id = ? WHERE id = ?").run(cred[0].id, repo.id);
        }
      } catch { /* 잘못된 URL은 무시 */ }
    }
  }

  if (!repoColumnNames.includes("clone_status")) {
    db.exec("ALTER TABLE repositories ADD COLUMN clone_status TEXT NOT NULL DEFAULT 'ready'");
    // 기존 저장소: clone_path 유무로 상태 보정
    db.exec("UPDATE repositories SET clone_status = 'ready' WHERE clone_path IS NOT NULL");
    db.exec("UPDATE repositories SET clone_status = 'pending' WHERE clone_path IS NULL");
  }

  // user_credentials: 기존 git credential에 GitHub 기본 metadata 적용
  const credRows = db.prepare(
    "SELECT id, metadata FROM user_credentials WHERE provider = 'git'"
  ).all() as { id: number; metadata: string | null }[];

  for (const row of credRows) {
    if (!row.metadata || row.metadata === "") {
      db.prepare(
        "UPDATE user_credentials SET metadata = ? WHERE id = ?"
      ).run(
        JSON.stringify({ type: "github", host: "github.com", apiBase: "https://api.github.com" }),
        row.id
      );
    }
  }
}
