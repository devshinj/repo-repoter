/**
 * scripts/migrate-sqlite-to-pg.ts
 *
 * SQLite → PostgreSQL 원샷 데이터 마이그레이션 스크립트.
 *
 * 사용법:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts            # 실제 마이그레이션
 *   npx tsx scripts/migrate-sqlite-to-pg.ts --dry-run  # 행 수 확인만 (쓰기 없음)
 *
 * 환경 변수:
 *   DATABASE_URL  PostgreSQL 연결 문자열
 *   SQLITE_PATH   SQLite 파일 경로 (기본: data/tracker.db)
 */

import Database from "better-sqlite3";
import postgres from "postgres";
import * as path from "path";
import * as fs from "fs";
import { initDb, closeSql } from "../src/infra/db/connection";

// ─────────────────────────────────────────────
// CLI 옵션
// ─────────────────────────────────────────────

const dryRun = process.argv.includes("--dry-run");

// ─────────────────────────────────────────────
// 연결 초기화
// ─────────────────────────────────────────────

const sqlitePath =
  process.env.SQLITE_PATH ??
  path.resolve(process.cwd(), "data", "tracker.db");

if (!fs.existsSync(sqlitePath)) {
  console.error(`[ERROR] SQLite 파일을 찾을 수 없습니다: ${sqlitePath}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("[ERROR] DATABASE_URL 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });

// WAL 모드 호환성을 위해 readonly 저널 모드 설정
sqlite.pragma("journal_mode = WAL");

const pg = postgres(process.env.DATABASE_URL, {
  max: 5,
  idle_timeout: 10,
  connect_timeout: 10,
});

// ─────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────

/** SQLite INTEGER boolean(0/1) → PostgreSQL BOOLEAN */
function toBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  return value === 1 || value === "1" || value === true;
}

/** TEXT JSON 컬럼 → JSONB 삽입용 파싱. 파싱 실패 시 원본 문자열 반환 */
function parseJsonb(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // 파싱 불가 시 그대로
  }
}

/** SERIAL 시퀀스를 현재 최대 id 값으로 동기화 */
async function syncSequence(tableName: string): Promise<void> {
  const result = await pg`
    SELECT setval(
      pg_get_serial_sequence(${tableName}, 'id'),
      COALESCE((SELECT MAX(id) FROM ${pg(tableName)}), 0)
    )
  `;
  console.log(
    `  [seq] ${tableName} 시퀀스 동기화 완료: ${result[0]?.setval ?? "N/A"}`
  );
}

/** 로그 구분선 */
function separator(label: string): void {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(` ${label}`);
  console.log(line);
}

// ─────────────────────────────────────────────
// 테이블별 마이그레이션 정의
// ─────────────────────────────────────────────

interface TableMigration {
  /** SQLite 테이블명 */
  table: string;
  /** PostgreSQL 테이블명 (다를 경우만 지정) */
  pgTable?: string;
  /** SERIAL PK가 있으면 true (시퀀스 동기화 대상) */
  hasSerialPk?: boolean;
  /** 행 변환 함수: SQLite raw row → PostgreSQL insert 객체 */
  transform: (row: Record<string, unknown>) => Record<string, unknown>;
}

const migrations: TableMigration[] = [
  // 1. users
  {
    table: "users",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      password_hash: row.password_hash ?? null,
      provider: row.provider ?? "credentials",
      provider_account_id: row.provider_account_id ?? null,
      is_active: toBoolean(row.is_active) ?? true,
      created_at: row.created_at,
    }),
  },

  // 2. user_credentials
  {
    table: "user_credentials",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      provider: row.provider,
      credential: row.credential,
      label: row.label ?? null,
      metadata: parseJsonb(row.metadata),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 3. hrms_api_keys
  {
    table: "hrms_api_keys",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      encrypted_key: row.encrypted_key,
      hrms_user_id: row.hrms_user_id ?? null,
      hrms_user_name: row.hrms_user_name ?? null,
      scopes: row.scopes ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 4. logicraft_api_keys
  {
    table: "logicraft_api_keys",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      encrypted_key: row.encrypted_key,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 5. repositories (FK: user_credentials.id)
  {
    table: "repositories",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      branch: row.branch ?? "main",
      last_synced_sha: row.last_synced_sha ?? null,
      is_active: toBoolean(row.is_active) ?? true,
      auto_report_enabled: toBoolean(row.auto_report_enabled) ?? false,
      polling_interval_min: row.polling_interval_min ?? 15,
      user_id: row.user_id ?? "",
      clone_url: row.clone_url ?? "",
      sync_status: row.sync_status ?? "pending",
      git_author: row.git_author ?? null,
      primary_language: row.primary_language ?? null,
      label: row.label ?? null,
      credential_id: row.credential_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 6. commit_cache (FK: repositories.id, PK: composite — no SERIAL)
  {
    table: "commit_cache",
    hasSerialPk: false,
    transform: (row) => ({
      repository_id: row.repository_id,
      sha: row.sha,
      branch: row.branch,
      author: row.author,
      message: row.message,
      committed_date: row.committed_date,
      committed_at: row.committed_at,
      additions: row.additions ?? 0,
      deletions: row.deletions ?? 0,
      files_changed: parseJsonb(row.files_changed),
      created_at: row.created_at,
    }),
  },

  // 7. sync_logs (FK: repositories.id)
  {
    table: "sync_logs",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      repository_id: row.repository_id,
      user_id: row.user_id ?? "",
      status: row.status,
      commits_processed: row.commits_processed ?? 0,
      tasks_created: row.tasks_created ?? 0,
      error_message: row.error_message ?? null,
      started_at: row.started_at,
      completed_at: row.completed_at ?? null,
    }),
  },

  // 8. reports (FK: repositories.id)
  {
    table: "reports",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      repository_id: row.repository_id,
      project: row.project,
      date: row.date,
      title: row.title,
      content: row.content,
      date_start: row.date_start ?? null,
      date_end: row.date_end ?? null,
      status: row.status ?? "completed",
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 9. projects
  {
    table: "projects",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      description: row.description ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 10. project_repositories (FK: projects.id, repositories.id — composite PK, no SERIAL)
  {
    table: "project_repositories",
    hasSerialPk: false,
    transform: (row) => ({
      project_id: row.project_id,
      repository_id: row.repository_id,
    }),
  },

  // 11. milestones (FK: projects.id OR repositories.id)
  {
    table: "milestones",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id ?? null,
      repository_id: row.repository_id ?? null,
      title: row.title,
      raw_input: row.raw_input,
      deadline: row.deadline ?? null,
      status: row.status ?? "active",
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 12. hrms_project_mappings
  {
    table: "hrms_project_mappings",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      hrms_project_id: row.hrms_project_id,
      hrms_project_name: row.hrms_project_name,
      auto_register: toBoolean(row.auto_register) ?? false,
      cron_time: row.cron_time ?? "0 9 * * 1-5",
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 13. hrms_mapping_repos (FK: hrms_project_mappings.id, repositories.id — composite PK)
  {
    table: "hrms_mapping_repos",
    hasSerialPk: false,
    transform: (row) => ({
      mapping_id: row.mapping_id,
      repository_id: row.repository_id,
    }),
  },

  // 14. hrms_task_logs (FK: hrms_project_mappings.id)
  {
    table: "hrms_task_logs",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      mapping_id: row.mapping_id,
      hrms_task_id: row.hrms_task_id ?? null,
      target_date: row.target_date,
      title: row.title,
      description: row.description,
      status: row.status,
      error_message: row.error_message ?? null,
      trigger_type: row.trigger_type ?? "manual",
      created_at: row.created_at,
    }),
  },

  // 15. hrms_logicraft_mappings
  {
    table: "hrms_logicraft_mappings",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      hrms_project_id: row.hrms_project_id,
      hrms_project_name: row.hrms_project_name,
      logicraft_project_id: row.logicraft_project_id,
      logicraft_project_name: row.logicraft_project_name,
      auto_register: toBoolean(row.auto_register) ?? false,
      cron_time: row.cron_time ?? "0 9 * * 1-5",
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },

  // 16. hrms_logicraft_task_logs (FK: hrms_logicraft_mappings.id)
  {
    table: "hrms_logicraft_task_logs",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      mapping_id: row.mapping_id,
      hrms_task_id: row.hrms_task_id ?? null,
      target_date: row.target_date,
      title: row.title,
      description: row.description,
      status: row.status,
      error_message: row.error_message ?? null,
      trigger_type: row.trigger_type ?? "manual",
      created_at: row.created_at,
    }),
  },

  // 17. feed_entries
  {
    table: "feed_entries",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      user_id: row.user_id,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      briefing: row.briefing ?? null,
      milestone_summary: row.milestone_summary ?? null,
      commit_shas: row.commit_shas ?? null,
      group_suggestion: row.group_suggestion ?? null,
      period_start: row.period_start,
      period_end: row.period_end,
      created_at: row.created_at,
    }),
  },

  // 18. rss_commits (FK: repositories.id, feed_entries.id)
  {
    table: "rss_commits",
    hasSerialPk: true,
    transform: (row) => ({
      id: row.id,
      repository_id: row.repository_id,
      sha: row.sha,
      author_name: row.author_name,
      message: row.message,
      committed_at: row.committed_at,
      feed_entry_id: row.feed_entry_id ?? null,
      created_at: row.created_at,
    }),
  },
];

// ─────────────────────────────────────────────
// 마이그레이션 실행
// ─────────────────────────────────────────────

const BATCH_SIZE = 500;

interface MigrationResult {
  table: string;
  sqliteCount: number;
  pgCount: number;
  migrated: number;
  skipped: number;
  ok: boolean;
}

async function migrateTable(
  migration: TableMigration
): Promise<MigrationResult> {
  const { table, pgTable = table, hasSerialPk = true, transform } = migration;

  // SQLite 행 수 조회
  let sqliteCount = 0;
  try {
    const countRow = sqlite
      .prepare(`SELECT COUNT(*) as cnt FROM "${table}"`)
      .get() as { cnt: number } | undefined;
    sqliteCount = countRow?.cnt ?? 0;
  } catch {
    console.log(`  [SKIP] SQLite 테이블 없음: ${table}`);
    return { table, sqliteCount: 0, pgCount: 0, migrated: 0, skipped: 0, ok: true };
  }

  console.log(`\n[${table}] SQLite 행 수: ${sqliteCount}`);

  if (dryRun) {
    console.log(`  [dry-run] 실제 쓰기 생략`);
    return {
      table,
      sqliteCount,
      pgCount: 0,
      migrated: 0,
      skipped: sqliteCount,
      ok: true,
    };
  }

  if (sqliteCount === 0) {
    console.log(`  [SKIP] 마이그레이션할 데이터 없음`);
    return { table, sqliteCount: 0, pgCount: 0, migrated: 0, skipped: 0, ok: true };
  }

  // 전체 행 로드
  const rows = sqlite
    .prepare(`SELECT * FROM "${table}"`)
    .all() as Record<string, unknown>[];

  let migrated = 0;
  let skipped = 0;

  // 배치 단위로 PostgreSQL에 삽입 (ON CONFLICT DO NOTHING으로 멱등성 보장)
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(transform);

    try {
      // postgres.js는 배열을 받아 bulk insert를 처리한다
      const result = await pg`
        INSERT INTO ${pg(pgTable)} ${pg(batch)}
        ON CONFLICT DO NOTHING
      `;
      migrated += result.count;
      skipped += batch.length - result.count;
      process.stdout.write(
        `  삽입: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`
      );
    } catch (err) {
      console.error(
        `\n  [ERROR] 배치 삽입 실패 (offset ${i}):`,
        (err as Error).message
      );
      throw err;
    }
  }

  console.log(`  완료: 삽입=${migrated}, 스킵(중복)=${skipped}`);

  // SERIAL 시퀀스 동기화
  if (hasSerialPk) {
    await syncSequence(pgTable);
  }

  // PostgreSQL 최종 행 수 확인
  const pgCountResult = await pg`
    SELECT COUNT(*) AS cnt FROM ${pg(pgTable)}
  `;
  const pgCount = Number(pgCountResult[0]?.cnt ?? 0);
  console.log(`  PostgreSQL 최종 행 수: ${pgCount}`);

  return {
    table,
    sqliteCount,
    pgCount,
    migrated,
    skipped,
    ok: pgCount >= sqliteCount, // 중복 제거 가능성 고려
  };
}

// ─────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────

async function verifyRowCounts(): Promise<void> {
  separator("행 수 검증 (SQLite vs PostgreSQL)");
  console.log(
    `${"테이블".padEnd(35)} ${"SQLite".padStart(10)} ${"PostgreSQL".padStart(12)} ${"결과".padStart(8)}`
  );
  console.log("─".repeat(70));

  let allOk = true;

  for (const migration of migrations) {
    const { table, pgTable = table } = migration;

    let sqliteCount = 0;
    try {
      const row = sqlite
        .prepare(`SELECT COUNT(*) as cnt FROM "${table}"`)
        .get() as { cnt: number } | undefined;
      sqliteCount = row?.cnt ?? 0;
    } catch {
      console.log(`${table.padEnd(35)} ${"N/A".padStart(10)}`);
      continue;
    }

    let pgCount = 0;
    try {
      const result = await pg`SELECT COUNT(*) AS cnt FROM ${pg(pgTable)}`;
      pgCount = Number(result[0]?.cnt ?? 0);
    } catch {
      pgCount = -1;
    }

    const ok =
      pgCount === sqliteCount ||
      (pgCount >= sqliteCount && sqliteCount === 0) ||
      pgCount >= sqliteCount; // pg쪽이 기존 데이터 포함 가능
    const status = pgCount >= sqliteCount ? "OK" : "MISMATCH";
    if (status === "MISMATCH") allOk = false;

    console.log(
      `${table.padEnd(35)} ${String(sqliteCount).padStart(10)} ${String(pgCount).padStart(12)} ${status.padStart(8)}`
    );
  }

  console.log("\n" + "─".repeat(70));
  if (allOk) {
    console.log("검증 결과: 모든 테이블 행 수 일치 (또는 PostgreSQL >= SQLite)");
  } else {
    console.log("경고: 일부 테이블의 행 수가 불일치합니다. 로그를 확인하세요.");
  }
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log(" SQLite → PostgreSQL 데이터 마이그레이션");
  console.log("=".repeat(60));
  console.log(`모드    : ${dryRun ? "DRY-RUN (읽기 전용)" : "실제 마이그레이션"}`);
  console.log(`SQLite  : ${sqlitePath}`);
  console.log(`Postgres: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@")}`);
  console.log();

  if (dryRun) {
    separator("SQLite 행 수 조회 (DRY-RUN)");
    for (const migration of migrations) {
      try {
        const row = sqlite
          .prepare(`SELECT COUNT(*) as cnt FROM "${migration.table}"`)
          .get() as { cnt: number } | undefined;
        console.log(
          `  ${migration.table.padEnd(35)} ${String(row?.cnt ?? 0).padStart(8)} 행`
        );
      } catch {
        console.log(`  ${migration.table.padEnd(35)} ${"N/A".padStart(8)}`);
      }
    }
    console.log("\n[dry-run] 완료. 실제 데이터는 쓰이지 않았습니다.");
    return;
  }

  separator("PostgreSQL 테이블 생성");
  await initDb();
  console.log("  테이블 생성 완료 (CREATE TABLE IF NOT EXISTS)");

  separator("마이그레이션 시작");

  const results: MigrationResult[] = [];
  for (const migration of migrations) {
    try {
      const result = await migrateTable(migration);
      results.push(result);
    } catch (err) {
      console.error(`\n[FATAL] ${migration.table} 마이그레이션 실패:`, err);
      throw err;
    }
  }

  await verifyRowCounts();

  separator("최종 요약");
  const totalSqlite = results.reduce((s, r) => s + r.sqliteCount, 0);
  const totalMigrated = results.reduce((s, r) => s + r.migrated, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
  console.log(`총 SQLite 행  : ${totalSqlite}`);
  console.log(`삽입된 행     : ${totalMigrated}`);
  console.log(`스킵된 행(중복): ${totalSkipped}`);
  console.log("\n마이그레이션이 완료되었습니다.");
}

main()
  .catch((err) => {
    console.error("\n[FATAL]", err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await pg.end();
    await closeSql();
  });
