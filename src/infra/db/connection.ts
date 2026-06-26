// src/infra/db/connection.ts
// postgres.js 기반 커넥션 싱글톤.
// sql: 각 repository 파일에서 named import로 사용.
// initDb(): 서버 시작 시 호출하여 테이블 생성.

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

export { sql };
export default sql;

export function getSql() {
  return sql;
}

export async function closeSql(): Promise<void> {
  await sql.end();
}

export async function initDb(): Promise<void> {
  await createTables();
}

async function createTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'credentials',
      provider_account_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_credentials (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      credential TEXT NOT NULL,
      label TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS repositories (
      id SERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      last_synced_sha TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      auto_report_enabled BOOLEAN NOT NULL DEFAULT false,
      polling_interval_min INTEGER NOT NULL DEFAULT 15,
      user_id TEXT NOT NULL DEFAULT '',
      clone_url TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      git_author TEXT,
      primary_language TEXT,
      label TEXT,
      credential_id INTEGER REFERENCES user_credentials(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, clone_url)
    )
  `;

  await sql`
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
      files_changed JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (repository_id, sha)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id SERIAL PRIMARY KEY,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      commits_processed INTEGER NOT NULL DEFAULT 0,
      tasks_created INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      project TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      date_start TEXT,
      date_end TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_api_keys (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      encrypted_key TEXT NOT NULL,
      hrms_user_id TEXT,
      hrms_user_name TEXT,
      scopes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_project_mappings (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      hrms_project_id INTEGER NOT NULL,
      hrms_project_name TEXT NOT NULL,
      auto_register BOOLEAN NOT NULL DEFAULT false,
      cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, hrms_project_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_mapping_repos (
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      PRIMARY KEY (mapping_id, repository_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_task_logs (
      id SERIAL PRIMARY KEY,
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      hrms_task_id INTEGER,
      target_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error', 'in_progress', 'skipped')),
      error_message TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS logicraft_api_keys (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      encrypted_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_logicraft_mappings (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      hrms_project_id INTEGER NOT NULL,
      hrms_project_name TEXT NOT NULL,
      logicraft_project_id TEXT NOT NULL,
      logicraft_project_name TEXT NOT NULL,
      auto_register BOOLEAN NOT NULL DEFAULT false,
      cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, logicraft_project_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hrms_logicraft_task_logs (
      id SERIAL PRIMARY KEY,
      mapping_id INTEGER NOT NULL REFERENCES hrms_logicraft_mappings(id) ON DELETE CASCADE,
      hrms_task_id INTEGER,
      target_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      error_message TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS project_repositories (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, repository_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS milestones (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (project_id IS NOT NULL OR repository_id IS NOT NULL)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feed_entries (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'repository')),
      scope_id INTEGER NOT NULL,
      briefing TEXT,
      milestone_summary TEXT,
      commit_shas TEXT,
      group_suggestion TEXT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rss_commits (
      id SERIAL PRIMARY KEY,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      sha TEXT NOT NULL,
      author_name TEXT NOT NULL,
      message TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      feed_entry_id INTEGER REFERENCES feed_entries(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(repository_id, sha)
    )
  `;

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_commit_cache_repo_date ON commit_cache(repository_id, committed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_repositories_user_active ON repositories(user_id, is_active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_logs_repo_completed ON sync_logs(repository_id, completed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_logs_user_status ON sync_logs(user_id, status, completed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_credentials_user_provider ON user_credentials(user_id, provider)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date_status ON hrms_task_logs(mapping_id, target_date, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hrms_project_mappings_user ON hrms_project_mappings(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_task_logs_mapping_date_status ON hrms_logicraft_task_logs(mapping_id, target_date, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_mappings_user ON hrms_logicraft_mappings(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_milestones_user_status ON milestones(user_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feed_entries_user_created ON feed_entries(user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rss_commits_repo_sha ON rss_commits(repository_id, sha)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rss_commits_feed_entry ON rss_commits(feed_entry_id)`;
}
