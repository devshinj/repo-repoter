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
      auto_report_enabled INTEGER NOT NULL DEFAULT 0,
      polling_interval_min INTEGER NOT NULL DEFAULT 15,
      user_id TEXT NOT NULL DEFAULT '',
      clone_url TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending',
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
      is_active INTEGER NOT NULL DEFAULT 1,
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
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      sha TEXT NOT NULL,
      branch TEXT NOT NULL,
      author TEXT NOT NULL,
      message TEXT NOT NULL,
      committed_date TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      files_changed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (repository_id, sha)
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

    CREATE TABLE IF NOT EXISTS hrms_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      encrypted_key TEXT NOT NULL,
      hrms_user_id TEXT,
      hrms_user_name TEXT,
      scopes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hrms_project_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hrms_project_id INTEGER NOT NULL,
      hrms_project_name TEXT NOT NULL,
      auto_register INTEGER NOT NULL DEFAULT 0,
      cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, hrms_project_id)
    );

    CREATE TABLE IF NOT EXISTS hrms_mapping_repos (
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      PRIMARY KEY (mapping_id, repository_id)
    );

    CREATE TABLE IF NOT EXISTS hrms_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      hrms_task_id INTEGER,
      target_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error', 'in_progress', 'skipped')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date_status
      ON hrms_task_logs(mapping_id, target_date, status);

    CREATE INDEX IF NOT EXISTS idx_hrms_project_mappings_user
      ON hrms_project_mappings(user_id);

    CREATE TABLE IF NOT EXISTS logicraft_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      encrypted_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hrms_logicraft_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hrms_project_id INTEGER NOT NULL,
      hrms_project_name TEXT NOT NULL,
      logicraft_project_id TEXT NOT NULL,
      logicraft_project_name TEXT NOT NULL,
      auto_register INTEGER NOT NULL DEFAULT 0,
      cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, logicraft_project_id)
    );

    CREATE TABLE IF NOT EXISTS hrms_logicraft_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mapping_id INTEGER NOT NULL REFERENCES hrms_logicraft_mappings(id) ON DELETE CASCADE,
      hrms_task_id INTEGER,
      target_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_task_logs_mapping_date_status
      ON hrms_logicraft_task_logs(mapping_id, target_date, status);

    CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_mappings_user
      ON hrms_logicraft_mappings(user_id);
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

  if (!repoColumnNames.includes("auto_report_enabled")) {
    db.exec("ALTER TABLE repositories ADD COLUMN auto_report_enabled INTEGER NOT NULL DEFAULT 0");
  }

  // commit_cache PK를 sha → (repository_id, sha) 복합키로 마이그레이션
  // 같은 clone_url을 여러 사용자가 등록하면 repository_id가 달라 동일 sha의 별도 row가 필요하기 때문
  const cacheColumns = db.prepare("PRAGMA table_info(commit_cache)").all() as any[];
  const shaCol = cacheColumns.find((c: any) => c.name === "sha");
  const repoIdCol = cacheColumns.find((c: any) => c.name === "repository_id");

  if (shaCol?.pk === 1 && repoIdCol?.pk === 0) {
    db.exec(`
      CREATE TABLE commit_cache_new (
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        sha TEXT NOT NULL,
        branch TEXT NOT NULL,
        author TEXT NOT NULL,
        message TEXT NOT NULL,
        committed_date TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (repository_id, sha)
      );
      INSERT INTO commit_cache_new (repository_id, sha, branch, author, message, committed_date, committed_at, created_at)
        SELECT repository_id, sha, branch, author, message, committed_date, committed_at, created_at FROM commit_cache;
      DROP TABLE commit_cache;
      ALTER TABLE commit_cache_new RENAME TO commit_cache;
      CREATE INDEX IF NOT EXISTS idx_commit_cache_repo_date
        ON commit_cache(repository_id, committed_date);
    `);
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

  // hrms_api_keys: hrms_user_id 컬럼 추가
  const hrmsKeyColumns = db.prepare("PRAGMA table_info(hrms_api_keys)").all() as any[];
  const hrmsKeyColumnNames = hrmsKeyColumns.map((c: any) => c.name);
  if (hrmsKeyColumns.length > 0 && !hrmsKeyColumnNames.includes("hrms_user_id")) {
    db.exec("ALTER TABLE hrms_api_keys ADD COLUMN hrms_user_id TEXT");
  }

  // hrms_task_logs: 인덱스에 status 포함으로 교체
  const oldIdx = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_hrms_task_logs_mapping_date'"
  ).get();
  if (oldIdx) {
    db.exec("DROP INDEX idx_hrms_task_logs_mapping_date");
    db.exec("CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date_status ON hrms_task_logs(mapping_id, target_date, status)");
  }

  // hrms_task_logs: in_progress 상태 추가를 위한 CHECK 제약 마이그레이션
  const taskLogSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='hrms_task_logs'"
  ).get() as { sql: string } | undefined;
  if (taskLogSql?.sql && !taskLogSql.sql.includes("in_progress")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hrms_task_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
        hrms_task_id INTEGER,
        target_date TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'error', 'in_progress', 'skipped')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO hrms_task_logs_new SELECT * FROM hrms_task_logs;
      DROP TABLE hrms_task_logs;
      ALTER TABLE hrms_task_logs_new RENAME TO hrms_task_logs;
      CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date_status
        ON hrms_task_logs(mapping_id, target_date, status);
    `);
  }

  // hrms_task_logs: skipped 상태 추가를 위한 CHECK 제약 마이그레이션
  if (taskLogSql?.sql && taskLogSql.sql.includes("in_progress") && !taskLogSql.sql.includes("skipped")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hrms_task_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
        hrms_task_id INTEGER,
        target_date TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'error', 'in_progress', 'skipped')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO hrms_task_logs_new SELECT * FROM hrms_task_logs;
      DROP TABLE hrms_task_logs;
      ALTER TABLE hrms_task_logs_new RENAME TO hrms_task_logs;
      CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date_status
        ON hrms_task_logs(mapping_id, target_date, status);
    `);
  }

  // users: is_active 컬럼 추가
  const latestUserColumns = db.prepare("PRAGMA table_info(users)").all() as any[];
  const latestUserColumnNames = latestUserColumns.map((c: any) => c.name);
  if (!latestUserColumnNames.includes("is_active")) {
    db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  }
}
