# SQLite → PostgreSQL 마이그레이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite(better-sqlite3)를 PostgreSQL(postgres.js)로 전환하여 다중 사용자 동시 접근 성능을 확보한다.

**Architecture:** connection.ts를 postgres.js 커넥션으로 교체하고, 11개 DB 파일의 100+ 함수를 동기→비동기로 전환한다. 모든 함수에서 `db: Database.Database` 파라미터를 제거하고, 각 파일이 `sql` 인스턴스를 직접 import한다. 호출부(API 라우트, 스케줄러, auth)에서 `getDb()` 호출을 제거하고 `await`를 추가한다.

**Tech Stack:** postgres.js, Docker Compose (PostgreSQL 17 Alpine), Node.js 22

## Global Constraints

- `src/infra/db/` 디렉토리 구조 유지
- `@/` 경로 별칭 사용
- 파일명 kebab-case, 타입 PascalCase, 함수 camelCase
- `any` 타입 최소화
- 커밋 메시지 한글 (prefix는 영문)

---

### Task 1: 인프라 기반 (Docker Compose + 패키지 + connection.ts + schema.ts)

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile`
- Modify: `package.json` — better-sqlite3 제거, postgres 추가
- Rewrite: `src/infra/db/connection.ts`
- Rewrite: `src/infra/db/schema.ts` — createTables() PostgreSQL DDL로 전환, migrateSchema() 삭제
- Modify: `.env.local` — DATABASE_URL 추가
- Modify: `.gitignore` — `data/` 제거

**Produces:**
- `sql`: postgres.js `Sql` 인스턴스 (각 repository 파일에서 import)
- `getSql()`: 테스트용 sql 인스턴스 접근 함수
- `closeSql()`: 커넥션 종료 (graceful shutdown)
- `initDb()`: `async` 함수 — 테이블 생성 (서버 시작 시 호출)

- [ ] **Step 1: Docker Compose 작성**

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: autobriify
      POSTGRES_USER: autobriify
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-devpass}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U autobriify"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

- [ ] **Step 2: Dockerfile 작성**

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: 패키지 교체**

Run: `npm uninstall better-sqlite3 @types/better-sqlite3 && npm install postgres`
Expected: package.json에서 better-sqlite3 제거, postgres 추가

- [ ] **Step 4: .env.local에 DATABASE_URL 추가**

`.env.local` 맨 아래에 추가:
```
DATABASE_URL=postgresql://autobriify:devpass@localhost:5432/autobriify
```

- [ ] **Step 5: connection.ts 재작성**

```typescript
// src/infra/db/connection.ts
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

export { sql };

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
```

- [ ] **Step 6: Docker Compose로 PostgreSQL 시작 및 연결 테스트**

Run: `docker compose up -d db`
Expected: PostgreSQL 17 컨테이너 시작

Run: `npx tsx -e "import { sql } from './src/infra/db/connection'; const [r] = await sql\`SELECT 1 as ok\`; console.log(r); await sql.end()"`
Expected: `{ ok: 1 }`

- [ ] **Step 7: initDb() 실행하여 테이블 생성 확인**

Run: `npx tsx -e "import { sql, initDb, closeSql } from './src/infra/db/connection'; await initDb(); const tables = await sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public'\`; console.log(tables.map(t => t.tablename).sort()); await closeSql()"`
Expected: 18개 테이블 목록 출력

- [ ] **Step 8: 커밋**

```bash
git add docker-compose.yml Dockerfile src/infra/db/connection.ts src/infra/db/schema.ts package.json package-lock.json .gitignore
git commit -m "feat: PostgreSQL 인프라 기반 구축 (postgres.js + Docker Compose)"
```

---

### Task 2: repository.ts 비동기 전환

**Files:**
- Rewrite: `src/infra/db/repository.ts`

**Interfaces:**
- Consumes: `sql` from `@/infra/db/connection`
- Produces: 모든 기존 함수 — `db` 파라미터 제거, `async` 추가. 시그니처 변경 예시:
  - `insertUser(input)` → `async insertUser(input): Promise<void>`
  - `getUserByEmail(email)` → `async getUserByEmail(email): Promise<any | undefined>`
  - `insertCommitCache(commits)` → `async insertCommitCache(commits): Promise<number>`
  - `trySyncStart(id)` → `async trySyncStart(id): Promise<boolean>`
  - `getDashboardStats(userId)` → `async getDashboardStats(userId): Promise<DashboardStats>`

- [ ] **Step 1: import 및 단순 CRUD 함수 전환**

파일 상단의 `import Database from "better-sqlite3"` 제거, `import { sql } from "@/infra/db/connection"` 추가.

모든 함수에서 `db: Database.Database` 파라미터 제거, `async` 추가.

**변환 패턴 — 단순 함수들 (`.prepare().run()` → `sql\`...\``):**

```typescript
// before
export function insertUser(db: Database.Database, input: InsertUserInput): void {
  db.prepare(
    "INSERT INTO users (name, email, password_hash, provider) VALUES (?, ?, ?, 'credentials')"
  ).run(input.name, input.email, input.passwordHash);
}

// after
export async function insertUser(input: InsertUserInput): Promise<void> {
  await sql`
    INSERT INTO users (name, email, password_hash, provider)
    VALUES (${input.name}, ${input.email}, ${input.passwordHash}, 'credentials')
  `;
}
```

**변환 패턴 — 단일 행 조회 (`.prepare().get()` → `const [row] = await sql\`...\``):**

```typescript
// before
export function getUserByEmail(db: Database.Database, email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any | undefined;
}

// after
export async function getUserByEmail(email: string) {
  const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
  return user as any | undefined;
}
```

**변환 패턴 — 다중 행 조회 (`.prepare().all()` → `await sql\`...\``):**

```typescript
// before
export function getRepositoriesByUser(db: Database.Database, userId: string) {
  return db.prepare(
    "SELECT * FROM repositories WHERE user_id = ? AND is_active = 1"
  ).all(userId) as any[];
}

// after
export async function getRepositoriesByUser(userId: string) {
  return await sql`
    SELECT * FROM repositories WHERE user_id = ${userId} AND is_active = true
  ` as any[];
}
```

**변환 패턴 — `result.changes > 0` → `RETURNING` 또는 `.count`:**

```typescript
// before
export function updateAutoReportEnabled(db: Database.Database, id: number, userId: string, enabled: boolean): boolean {
  const result = db.prepare(
    "UPDATE repositories SET auto_report_enabled = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(enabled ? 1 : 0, id, userId);
  return result.changes > 0;
}

// after
export async function updateAutoReportEnabled(id: number, userId: string, enabled: boolean): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET auto_report_enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count > 0;
}
```

이 패턴을 모든 단순 CRUD 함수에 적용:
`insertRepository`, `getActiveRepositories`, `getRepositoryByOwnerRepo`, `getRepositoryById`,
`updateLastSyncedSha`, `deleteRepository`, `toggleRepository`, `getAutoReportEnabledRepos`,
`insertSyncLog`, `getRecentSyncLogs`, `insertRepositoryForUser`, `getRepositoriesByUser`,
`getRepositoryByIdAndUser`, `deleteRepositoryForUser`, `insertSyncLogForUser`,
`updateGitAuthor`, `updateSyncStatus`, `updateLabel`, `updatePrimaryLanguage`,
`getActiveUsersWithRepos`, `getLatestCacheDate`, `getRepoLastSyncAt`,
`getLastSyncCompletedAt`

- [ ] **Step 2: `datetime('now')` → `NOW()` 전환**

모든 SQL에서 `datetime('now')` → `NOW()`, `datetime('now', '-1 day')` → `NOW() - INTERVAL '1 day'`, `datetime('now', '-10 minutes')` → `NOW() - INTERVAL '10 minutes'`로 교체.

- [ ] **Step 3: upsertOAuthUser 전환**

이 함수는 내부에서 `getUserByEmail`을 호출하므로 await 필요:

```typescript
export async function upsertOAuthUser(input: UpsertOAuthUserInput) {
  const [existing] = await sql`
    SELECT * FROM users WHERE provider = ${input.provider} AND provider_account_id = ${input.providerAccountId}
  `;

  if (existing) {
    await sql`UPDATE users SET name = ${input.name}, email = ${input.email} WHERE id = ${existing.id}`;
    return { ...existing, name: input.name, email: input.email };
  }

  const emailUser = await getUserByEmail(input.email);
  if (emailUser) {
    await sql`
      UPDATE users SET provider = ${input.provider}, provider_account_id = ${input.providerAccountId}, name = ${input.name}
      WHERE id = ${emailUser.id}
    `;
    return { ...emailUser, provider: input.provider, provider_account_id: input.providerAccountId, name: input.name };
  }

  const [inserted] = await sql`
    INSERT INTO users (name, email, password_hash, provider, provider_account_id)
    VALUES (${input.name}, ${input.email}, ${null}, ${input.provider}, ${input.providerAccountId})
    RETURNING id
  `;
  return { id: inserted.id, name: input.name, email: input.email, provider: input.provider };
}
```

- [ ] **Step 4: trySyncStart CAS 패턴 전환**

```typescript
export async function trySyncStart(id: number): Promise<boolean> {
  const result = await sql`
    UPDATE repositories SET sync_status = 'syncing', updated_at = NOW()
    WHERE id = ${id} AND (
      sync_status IN ('ready', 'error', 'pending')
      OR (sync_status = 'syncing' AND updated_at < NOW() - INTERVAL '10 minutes')
    )
  `;
  return result.count > 0;
}
```

- [ ] **Step 5: insertCommitCache 트랜잭션 전환**

```typescript
export async function insertCommitCache(commits: CacheCommit[]): Promise<number> {
  if (commits.length === 0) return 0;

  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const c of commits) {
      const result = await tx`
        INSERT INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed)
        VALUES (${c.sha}, ${c.repositoryId}, ${c.branch}, ${c.author}, ${c.message}, ${c.committedDate}, ${c.committedAt}, ${c.additions}, ${c.deletions}, ${c.filesChanged.length > 0 ? sql.json(c.filesChanged) : null})
        ON CONFLICT (repository_id, sha) DO NOTHING
      `;
      inserted += result.count;
    }
  });
  return inserted;
}
```

Note: SQLite의 `INSERT OR IGNORE` → PostgreSQL의 `ON CONFLICT ... DO NOTHING`.

- [ ] **Step 6: 동적 WHERE/IN 절 함수 전환**

`getCommitCountsByDateRange`, `getCommitsByDateRange`, `getLatestCacheDateBatch`, `getCachedShas`는 동적으로 IN 절을 구성한다. postgres.js의 `sql()` 헬퍼를 사용:

```typescript
export async function getCachedShas(repoId: number, shas: string[]): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  // postgres.js는 파라미터 수 제한 없으므로 배치 불필요
  const rows = await sql`
    SELECT sha FROM commit_cache WHERE repository_id = ${repoId} AND sha IN ${sql(shas)}
  `;
  return new Set(rows.map((r: any) => r.sha));
}

export async function getLatestCacheDateBatch(repoIds: number[]): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  if (repoIds.length === 0) return result;
  for (const id of repoIds) result.set(id, null);

  const rows = await sql`
    SELECT repository_id, MAX(committed_date) as latest FROM commit_cache
    WHERE repository_id IN ${sql(repoIds)} GROUP BY repository_id
  `;
  for (const row of rows) result.set(row.repository_id, row.latest);
  return result;
}

export async function getCommitCountsByDateRange(
  repoIds: number[], since: string, until: string, authors?: string[]
): Promise<Record<string, number>> {
  if (repoIds.length === 0) return {};

  let rows;
  if (authors && authors.length > 0) {
    const authorPatterns = authors.map(a => `%${a}%`);
    rows = await sql`
      SELECT committed_date, COUNT(*)::int as count FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
        AND author ILIKE ANY(${authorPatterns})
      GROUP BY committed_date
    `;
  } else {
    rows = await sql`
      SELECT committed_date, COUNT(*)::int as count FROM commit_cache
      WHERE repository_id IN ${sql(repoIds)}
        AND committed_date BETWEEN ${since} AND ${until}
      GROUP BY committed_date
    `;
  }

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.committed_date] = row.count;
  return counts;
}
```

PostgreSQL 전용: `author LIKE ? OR author LIKE ?` → `author ILIKE ANY(array)` 로 단순화.

`getCommitsByDateRange`도 같은 패턴 적용.

- [ ] **Step 7: getRepositoriesWithLastCommit ROW_NUMBER 쿼리 전환**

이 쿼리는 이미 표준 SQL이므로 `CAST(u.id AS TEXT)` 제거와 boolean 변환만 필요:

```typescript
export async function getRepositoriesWithLastCommit(userId: string) {
  return await sql`
    SELECT r.*,
      cc.message AS last_commit_message,
      cc.committed_at AS last_commit_at,
      cc.author AS last_commit_author,
      cc.sha AS last_commit_sha,
      sl.completed_at AS last_sync_at,
      sl.status AS last_sync_status
    FROM repositories r
    LEFT JOIN (
      SELECT repository_id, message, committed_at, author, sha,
        ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY committed_at DESC) AS rn
      FROM commit_cache
    ) cc ON cc.repository_id = r.id AND cc.rn = 1
    LEFT JOIN (
      SELECT repository_id, completed_at, status,
        ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY completed_at DESC) AS rn
      FROM sync_logs WHERE user_id = ${userId}
    ) sl ON sl.repository_id = r.id AND sl.rn = 1
    WHERE r.user_id = ${userId} AND r.is_active = true
    ORDER BY r.created_at DESC
  ` as any[];
}
```

- [ ] **Step 8: getDashboardStats, getLastSyncSummary, getHeatmapCounts 전환**

이 함수들은 내부에서 다른 함수를 호출하므로 await 추가 필요:

```typescript
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const repos = await getRepositoriesByUser(userId);  // await 추가
  // ... 나머지는 sql 태그 템플릿으로 교체
  // datetime('now', '-1 day') → NOW() - INTERVAL '1 day'
  // getCommitCountsByDateRange도 await
}
```

`getHeatmapCounts`도 내부에서 `getRepositoriesByUser`와 `getCommitCountsByDateRange`를 호출하므로 같은 패턴.

- [ ] **Step 9: 커밋**

```bash
git add src/infra/db/repository.ts
git commit -m "refactor: repository.ts PostgreSQL 비동기 전환"
```

---

### Task 3: credential.ts + report.ts 전환

**Files:**
- Rewrite: `src/infra/db/credential.ts`
- Rewrite: `src/infra/db/report.ts`

**Interfaces:**
- Consumes: `sql` from `@/infra/db/connection`
- Produces: 모든 기존 함수 — `db` 파라미터 제거, `async` 추가

- [ ] **Step 1: credential.ts 전환**

모든 함수가 단순 CRUD이므로 Task 2의 변환 패턴 적용:

```typescript
import { sql } from "@/infra/db/connection";

export async function insertCredential(input: { userId: string; provider: string; credential: string; label?: string; metadata?: any }): Promise<void> {
  await sql`
    INSERT INTO user_credentials (user_id, provider, credential, label, metadata)
    VALUES (${input.userId}, ${input.provider}, ${input.credential}, ${input.label ?? null}, ${input.metadata ? JSON.stringify(input.metadata) : null})
  `;
}

export async function getCredentialsByUser(userId: string) {
  return await sql`SELECT * FROM user_credentials WHERE user_id = ${userId}` as any[];
}

export async function getCredentialByUserAndProvider(userId: string, provider: string) {
  const [row] = await sql`SELECT * FROM user_credentials WHERE user_id = ${userId} AND provider = ${provider} LIMIT 1`;
  return row as any | undefined;
}

export async function getCredentialsByUserAndProvider(userId: string, provider: string) {
  return await sql`SELECT * FROM user_credentials WHERE user_id = ${userId} AND provider = ${provider}` as any[];
}

export async function getCredentialById(id: number) {
  const [row] = await sql`SELECT * FROM user_credentials WHERE id = ${id}`;
  return row as any | undefined;
}

export async function updateCredential(id: number, input: { credential?: string; label?: string; metadata?: any }): Promise<void> {
  await sql`
    UPDATE user_credentials SET
      credential = COALESCE(${input.credential ?? null}, credential),
      label = COALESCE(${input.label ?? null}, label),
      metadata = COALESCE(${input.metadata ? JSON.stringify(input.metadata) : null}, metadata),
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deleteCredential(id: number): Promise<void> {
  await sql`DELETE FROM user_credentials WHERE id = ${id}`;
}
```

- [ ] **Step 2: report.ts 전환**

같은 패턴. `lastInsertRowid` → `RETURNING id` 사용:

```typescript
import { sql } from "@/infra/db/connection";

export async function insertReport(input: { userId: string; repositoryId: number; project: string; date: string; title: string; content: string; dateStart?: string; dateEnd?: string; status?: string }): Promise<number> {
  const [row] = await sql`
    INSERT INTO reports (user_id, repository_id, project, date, title, content, date_start, date_end, status)
    VALUES (${input.userId}, ${input.repositoryId}, ${input.project}, ${input.date}, ${input.title}, ${input.content}, ${input.dateStart ?? null}, ${input.dateEnd ?? null}, ${input.status ?? 'completed'})
    RETURNING id
  `;
  return row.id;
}
// ... 나머지 함수도 같은 패턴
```

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/credential.ts src/infra/db/report.ts
git commit -m "refactor: credential.ts, report.ts PostgreSQL 비동기 전환"
```

---

### Task 4: project-repository.ts + milestone-repository.ts 전환

**Files:**
- Rewrite: `src/infra/db/project-repository.ts`
- Rewrite: `src/infra/db/milestone-repository.ts`

**Interfaces:**
- Consumes: `sql` from `@/infra/db/connection`
- Produces: 모든 기존 함수 — `db` 파라미터 제거, `async` 추가

- [ ] **Step 1: project-repository.ts 트랜잭션 전환**

`insertProject`와 `updateProject`는 `db.transaction()`을 사용:

```typescript
import { sql } from "@/infra/db/connection";

export async function insertProject(input: { userId: string; name: string; description?: string; repositoryIds: number[] }): Promise<number> {
  return await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO projects (user_id, name, description)
      VALUES (${input.userId}, ${input.name}, ${input.description ?? null})
      RETURNING id
    `;
    for (const repoId of input.repositoryIds) {
      await tx`INSERT INTO project_repositories (project_id, repository_id) VALUES (${row.id}, ${repoId})`;
    }
    return row.id;
  });
}

export async function updateProject(id: number, input: { name: string; description?: string; repositoryIds: number[] }): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE projects SET name = ${input.name}, description = ${input.description ?? null}, updated_at = NOW() WHERE id = ${id}`;
    await tx`DELETE FROM project_repositories WHERE project_id = ${id}`;
    for (const repoId of input.repositoryIds) {
      await tx`INSERT INTO project_repositories (project_id, repository_id) VALUES (${id}, ${repoId})`;
    }
  });
}
```

나머지 (`getProjectsByUser`, `getProjectWithRepos`, `deleteProject`, `getRepositoryProjectId`)는 단순 패턴.

- [ ] **Step 2: milestone-repository.ts 전환**

단순 CRUD 패턴. 특이점 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/project-repository.ts src/infra/db/milestone-repository.ts
git commit -m "refactor: project-repository.ts, milestone-repository.ts PostgreSQL 비동기 전환"
```

---

### Task 5: hrms.ts + logicraft.ts 전환

**Files:**
- Rewrite: `src/infra/db/hrms.ts`
- Rewrite: `src/infra/db/logicraft.ts`

**Interfaces:**
- Consumes: `sql` from `@/infra/db/connection`
- Produces: 모든 기존 함수 — `db` 파라미터 제거, `async` 추가

- [ ] **Step 1: hrms.ts 전환**

핵심 변환 포인트:

**ON CONFLICT 유지:**
```typescript
export async function upsertHrmsApiKey(input: { userId: string; encryptedKey: string; hrmsUserId?: string; hrmsUserName?: string; scopes?: string }): Promise<void> {
  await sql`
    INSERT INTO hrms_api_keys (user_id, encrypted_key, hrms_user_id, hrms_user_name, scopes)
    VALUES (${input.userId}, ${input.encryptedKey}, ${input.hrmsUserId ?? null}, ${input.hrmsUserName ?? null}, ${input.scopes ?? null})
    ON CONFLICT (user_id) DO UPDATE SET
      encrypted_key = EXCLUDED.encrypted_key,
      hrms_user_id = EXCLUDED.hrms_user_id,
      hrms_user_name = EXCLUDED.hrms_user_name,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `;
}
```

**deleteAllHrmsDataByUser 트랜잭션:**
```typescript
export async function deleteAllHrmsDataByUser(userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const mappings = await tx`SELECT id FROM hrms_project_mappings WHERE user_id = ${userId}`;
    for (const m of mappings) {
      await tx`DELETE FROM hrms_task_logs WHERE mapping_id = ${m.id}`;
      await tx`DELETE FROM hrms_mapping_repos WHERE mapping_id = ${m.id}`;
    }
    await tx`DELETE FROM hrms_project_mappings WHERE user_id = ${userId}`;
    await tx`DELETE FROM hrms_api_keys WHERE user_id = ${userId}`;
  });
}
```

**getUnifiedTaskLogs UNION ALL:**
```typescript
export async function getUnifiedTaskLogs(userId: string, limit = 50) {
  return await sql`
    SELECT * FROM (
      SELECT htl.id, htl.target_date, htl.title, htl.description, htl.status, htl.error_message,
        htl.trigger_type, htl.created_at, 'git' as source_type, hpm.hrms_project_name
      FROM hrms_task_logs htl
      JOIN hrms_project_mappings hpm ON hpm.id = htl.mapping_id
      WHERE hpm.user_id = ${userId}
      UNION ALL
      SELECT hlt.id, hlt.target_date, hlt.title, hlt.description, hlt.status, hlt.error_message,
        hlt.trigger_type, hlt.created_at, 'logicraft' as source_type, hlm.hrms_project_name
      FROM hrms_logicraft_task_logs hlt
      JOIN hrms_logicraft_mappings hlm ON hlm.id = hlt.mapping_id
      WHERE hlm.user_id = ${userId}
    ) combined ORDER BY created_at DESC LIMIT ${limit}
  ` as any[];
}
```

나머지 함수들은 단순 CRUD 패턴.

- [ ] **Step 2: logicraft.ts 전환**

hrms.ts와 구조가 동일. 같은 변환 패턴 적용.

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/hrms.ts src/infra/db/logicraft.ts
git commit -m "refactor: hrms.ts, logicraft.ts PostgreSQL 비동기 전환"
```

---

### Task 6: feed-repository.ts + admin-repository.ts 전환

**Files:**
- Rewrite: `src/infra/db/feed-repository.ts`
- Rewrite: `src/infra/db/admin-repository.ts`

**Interfaces:**
- Consumes: `sql` from `@/infra/db/connection`
- Produces: 모든 기존 함수 — `db` 파라미터 제거, `async` 추가

- [ ] **Step 1: feed-repository.ts 전환**

`insertRssCommits` 트랜잭션:
```typescript
export async function insertRssCommits(commits: { repositoryId: number; sha: string; authorName: string; message: string; committedAt: string }[]): Promise<number> {
  if (commits.length === 0) return 0;
  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const c of commits) {
      const result = await tx`
        INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at)
        VALUES (${c.repositoryId}, ${c.sha}, ${c.authorName}, ${c.message}, ${c.committedAt})
        ON CONFLICT (repository_id, sha) DO NOTHING
      `;
      inserted += result.count;
    }
  });
  return inserted;
}
```

`getFeedEntries`에서 JSON 파싱이 있다면 PostgreSQL의 JSONB는 자동 파싱되므로 `JSON.parse()` 제거 가능.

- [ ] **Step 2: admin-repository.ts 전환**

핵심 변환:

**CAST(u.id AS TEXT) 제거 — `u.id::TEXT` 사용:**
```typescript
export async function getAllUsers(): Promise<AdminUser[]> {
  return await sql`
    SELECT u.id, u.name, u.email, u.provider, u.is_active, u.created_at,
           COUNT(r.id)::int AS repo_count
    FROM users u
    LEFT JOIN repositories r ON r.user_id = u.id::TEXT
    GROUP BY u.id
    ORDER BY u.created_at DESC
  ` as AdminUser[];
}
```

**GROUP_CONCAT → STRING_AGG:**
```typescript
export async function getHrmsMappings(): Promise<HrmsMappingRow[]> {
  return await sql`
    SELECT hpm.id, hpm.auto_register, hpm.cron_time, hpm.hrms_project_name, hpm.user_id,
           STRING_AGG(hmr.repository_id::TEXT, ',') AS repo_ids
    FROM hrms_project_mappings hpm
    LEFT JOIN hrms_mapping_repos hmr ON hmr.mapping_id = hpm.id
    GROUP BY hpm.id
  ` as HrmsMappingRow[];
}
```

**deleteUser 트랜잭션:**
```typescript
export async function deleteUser(userId: number): Promise<void> {
  const userIdStr = String(userId);
  await sql.begin(async (tx) => {
    const mappings = await tx`SELECT id FROM hrms_project_mappings WHERE user_id = ${userIdStr}`;
    for (const m of mappings) {
      await tx`DELETE FROM hrms_task_logs WHERE mapping_id = ${m.id}`;
      await tx`DELETE FROM hrms_mapping_repos WHERE mapping_id = ${m.id}`;
    }
    await tx`DELETE FROM hrms_project_mappings WHERE user_id = ${userIdStr}`;

    const lcMappings = await tx`SELECT id FROM hrms_logicraft_mappings WHERE user_id = ${userIdStr}`;
    for (const m of lcMappings) {
      await tx`DELETE FROM hrms_logicraft_task_logs WHERE mapping_id = ${m.id}`;
    }
    await tx`DELETE FROM hrms_logicraft_mappings WHERE user_id = ${userIdStr}`;

    await tx`DELETE FROM hrms_api_keys WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM logicraft_api_keys WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM user_credentials WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM feed_entries WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM rss_commits WHERE repository_id IN (SELECT id FROM repositories WHERE user_id = ${userIdStr})`;
    await tx`DELETE FROM milestones WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM repositories WHERE user_id = ${userIdStr}`;
    await tx`DELETE FROM users WHERE id = ${userId}`;
  });
}
```

**동적 WHERE 절 (getSyncLogs, getHrmsLogs):**

postgres.js에서 동적 WHERE를 구성하는 방법:

```typescript
export async function getSyncLogs(
  filters: { userId?: string; repoId?: string; status?: string; limit?: number }
): Promise<SyncLogRow[]> {
  const limit = filters.limit || 100;
  return await sql`
    SELECT sl.id, sl.completed_at, r.repo AS repo_name,
           u.name AS user_name, sl.status,
           sl.commits_processed, sl.tasks_created, sl.error_message
    FROM sync_logs sl
    JOIN repositories r ON r.id = sl.repository_id
    JOIN users u ON u.id::TEXT = sl.user_id
    WHERE true
      ${filters.userId ? sql`AND sl.user_id = ${filters.userId}` : sql``}
      ${filters.repoId ? sql`AND sl.repository_id = ${Number(filters.repoId)}` : sql``}
      ${filters.status ? sql`AND sl.status = ${filters.status}` : sql``}
    ORDER BY sl.completed_at DESC
    LIMIT ${limit}
  ` as SyncLogRow[];
}
```

`getHrmsLogs`도 같은 패턴.

**DATE(created_at) → created_at::DATE:**
```typescript
// before: WHERE DATE(created_at) = ?
// after:
WHERE created_at::DATE = ${targetDate}
```

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/feed-repository.ts src/infra/db/admin-repository.ts
git commit -m "refactor: feed-repository.ts, admin-repository.ts PostgreSQL 비동기 전환"
```

---

### Task 7: 호출부 업데이트 (API Routes + Schedulers + Auth)

**Files:**
- Modify: 모든 API 라우트 (~40개 파일)
- Modify: `src/scheduler/polling-manager.ts`
- Modify: `src/scheduler/report-scheduler.ts`
- Modify: `src/scheduler/report-generator.ts`
- Modify: `src/scheduler/hrms-scheduler.ts`
- Modify: `src/scheduler/feed-scheduler.ts`
- Modify: `src/lib/auth.ts`

**변환 패턴 — 모든 호출부에 동일 적용:**

1. `import { getDb } from "@/infra/db/connection"` → 제거 (더 이상 필요 없음)
2. `const db = getDb();` → 제거
3. 모든 DB 함수 호출에서 첫 번째 인수 `db` 제거
4. 모든 DB 함수 호출 앞에 `await` 추가

- [ ] **Step 1: auth.ts 전환**

```typescript
// src/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail, upsertOAuthUser } from "@/infra/db/repository";
// getDb import 제거

export const { handlers, signIn, signOut, auth } = NextAuth({
  // ... providers, session 등은 유지
  providers: [
    Credentials({
      // ...
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        if (!email || !password) return null;

        const user = await getUserByEmail(email);  // db 인수 제거, await 추가
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return { id: String(user.id), name: user.name, email: user.email };
      },
    }),
    // ... HRMS provider 유지
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") {
        const dbUser = await getUserByEmail(user.email || "");  // await 추가, db 인수 제거
        if (dbUser && !dbUser.is_active) return false;
      }

      if (account?.provider && account.provider !== "credentials" && profile) {
        const dbUser = await upsertOAuthUser({  // await 추가, db 인수 제거
          name: user.name || profile.name as string || "",
          email: user.email || profile.email as string || "",
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        });
        if (!dbUser.is_active) return false;
        user.id = String(dbUser.id);
      }

      return true;
    },
    // jwt, session 콜백은 DB 미사용 — 변경 없음
  },
});
```

- [ ] **Step 2: API 라우트 일괄 전환**

모든 API 라우트에 동일한 3단계 적용:

```typescript
// before
import { getDb } from "@/infra/db/connection";
import { getRepositoriesByUser } from "@/infra/db/repository";

export async function GET() {
  const session = await auth();
  const db = getDb();
  const repos = getRepositoriesByUser(db, session.user.id);
  return NextResponse.json(repos);
}

// after
import { getRepositoriesByUser } from "@/infra/db/repository";

export async function GET() {
  const session = await auth();
  const repos = await getRepositoriesByUser(session.user.id);
  return NextResponse.json(repos);
}
```

이 변환을 모든 API 라우트 파일에 적용. 파일 목록:

`src/app/api/repos/route.ts`, `src/app/api/repos/[id]/commits/route.ts`,
`src/app/api/repos/[id]/branches/route.ts`, `src/app/api/repos/[id]/sync/route.ts`,
`src/app/api/repos/commit-calendar/route.ts`, `src/app/api/repos/commit-calendar/[date]/route.ts`,
`src/app/api/repos/commit-calendar/range/route.ts`,
`src/app/api/credentials/route.ts`, `src/app/api/credentials/[id]/route.ts`,
`src/app/api/git-providers/repos/route.ts`,
`src/app/api/dashboard/stats/route.ts`,
`src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`,
`src/app/api/milestones/route.ts`, `src/app/api/milestones/[id]/route.ts`,
`src/app/api/milestones/parse/route.ts`,
`src/app/api/reports/route.ts`, `src/app/api/reports/[id]/route.ts`,
`src/app/api/reports/generate/route.ts`,
`src/app/api/register/route.ts`,
`src/app/api/hrms/key/route.ts`, `src/app/api/hrms/projects/route.ts`,
`src/app/api/hrms/tasks/route.ts`, `src/app/api/hrms/mappings/route.ts`,
`src/app/api/hrms/mappings/[id]/route.ts`, `src/app/api/hrms/register/route.ts`,
`src/app/api/hrms/register/active/route.ts`, `src/app/api/hrms/register/history/route.ts`,
`src/app/api/logicraft/key/route.ts`, `src/app/api/logicraft/verify/route.ts`,
`src/app/api/logicraft/mappings/route.ts`, `src/app/api/logicraft/mappings/[id]/route.ts`,
`src/app/api/logicraft/tasks/route.ts`, `src/app/api/logicraft/register/route.ts`,
`src/app/api/cron/route.ts`,
`src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`,
`src/app/api/admin/scheduler/route.ts`,
`src/app/api/admin/scheduler/repos/[id]/route.ts`,
`src/app/api/admin/scheduler/repos/[id]/auto-report/route.ts`,
`src/app/api/admin/scheduler/hrms-mappings/[id]/route.ts`,
`src/app/api/admin/scheduler/logicraft-mappings/[id]/route.ts`,
`src/app/api/admin/sync-logs/route.ts`, `src/app/api/admin/hrms-logs/route.ts`

- [ ] **Step 3: 스케줄러 전환**

스케줄러도 같은 패턴. 특이 사항:
- `report-generator.ts`의 `collectCommitsForDateFromCache`는 직접 `db.prepare()` 호출을 사용 — 이것도 `sql` 태그 템플릿으로 전환 필요.
- `polling-manager.ts`의 `syncOneRepo`에서 `database` 파라미터 제거.

- [ ] **Step 4: initDb() 호출 추가**

instrumentation.ts 또는 스케줄러 초기화 지점에서 `await initDb()` 호출 추가. 기존에 `getDb()`가 자동으로 `createTables()`를 호출하던 로직 대체.

- [ ] **Step 5: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ src/scheduler/ src/lib/auth.ts
git commit -m "refactor: 호출부 PostgreSQL 비동기 전환 (API 라우트, 스케줄러, auth)"
```

---

### Task 8: 테스트 적응

**Files:**
- Rewrite: `src/__tests__/infra/db/repository.test.ts`
- Rewrite: `src/__tests__/infra/db/credential.test.ts`
- Rewrite: `src/__tests__/infra/db/hrms.test.ts`
- Rewrite: `src/__tests__/infra/db/project-repository.test.ts`
- Rewrite: `src/__tests__/infra/db/milestone-repository.test.ts`
- Rewrite: `src/__tests__/infra/db/feed-tables.test.ts`
- Rewrite: `src/__tests__/infra/db/commit-cache.test.ts`
- Rewrite: `src/__tests__/infra/db/schema.test.ts`
- Delete: `src/__tests__/infra/db/migration-safety.test.ts` — SQLite 마이그레이션 테스트이므로 삭제

**전략:** 테스트는 Docker Compose의 PostgreSQL에 연결하여 실행. 각 테스트 파일이 `beforeAll`에서 테이블을 생성하고 `afterEach`에서 데이터를 정리.

- [ ] **Step 1: 테스트 유틸 작성**

```typescript
// src/__tests__/helpers/test-db.ts
import postgres from "postgres";

const testSql = postgres(process.env.DATABASE_URL || "postgresql://autobriify:devpass@localhost:5432/autobriify");

export { testSql };

export async function cleanAllTables(): Promise<void> {
  await testSql`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$
  `;
}
```

- [ ] **Step 2: repository.test.ts 전환 예시**

```typescript
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { initDb } from "@/infra/db/connection";
import { cleanAllTables } from "../helpers/test-db";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  getRepositoryByIdAndUser,
  deleteRepositoryForUser,
  insertSyncLogForUser,
  getActiveUsersWithRepos,
} from "@/infra/db/repository";

describe("user-scoped repository functions", () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await cleanAllTables();
  });

  it("should insert and retrieve repos for a specific user", async () => {
    await insertRepositoryForUser({
      userId: "user1",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });

    const user1Repos = await getRepositoriesByUser("user1");
    expect(user1Repos).toHaveLength(1);
    expect(user1Repos[0].owner).toBe("octocat");
  });

  // ... 나머지 테스트도 같은 패턴: async/await 추가, db 인수 제거
});
```

나머지 테스트 파일도 동일 패턴:
1. `Database` import 제거, `initDb` + `cleanAllTables` import
2. `beforeEach`의 `:memory:` DB 생성 → `beforeAll`의 `initDb()`
3. `afterEach`의 `db.close()` → `cleanAllTables()`
4. 모든 함수 호출에서 `db` 인수 제거, `await` 추가, `async` 테스트 함수

- [ ] **Step 3: 테스트 실행**

Run: `docker compose up -d db && npm test`
Expected: 모든 테스트 통과

- [ ] **Step 4: 커밋**

```bash
git add src/__tests__/
git commit -m "refactor: 테스트 PostgreSQL 전환"
```

---

### Task 9: 데이터 마이그레이션 스크립트

**Files:**
- Create: `scripts/migrate-sqlite-to-pg.ts`

**Interfaces:**
- Consumes: better-sqlite3 (SQLite 읽기 전용), postgres.js (PostgreSQL 쓰기)
- Produces: 독립 실행 스크립트

- [ ] **Step 1: 마이그레이션 스크립트 작성**

```typescript
// scripts/migrate-sqlite-to-pg.ts
import Database from "better-sqlite3";
import postgres from "postgres";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");

const sqliteDb = new Database(join(process.cwd(), "data", "tracker.db"), { readonly: true });
const pgSql = postgres(process.env.DATABASE_URL!);

interface TableConfig {
  name: string;
  hasSerial: boolean;  // SERIAL PK가 있는 테이블
  booleanCols?: string[];  // INTEGER → BOOLEAN 변환 대상
  jsonbCols?: string[];    // TEXT → JSONB 변환 대상
}

const tables: TableConfig[] = [
  { name: "users", hasSerial: true, booleanCols: ["is_active"] },
  { name: "user_credentials", hasSerial: true, jsonbCols: ["metadata"] },
  { name: "hrms_api_keys", hasSerial: true },
  { name: "logicraft_api_keys", hasSerial: true },
  { name: "repositories", hasSerial: true, booleanCols: ["is_active", "auto_report_enabled"] },
  { name: "commit_cache", hasSerial: false },
  { name: "sync_logs", hasSerial: true },
  { name: "reports", hasSerial: true },
  { name: "projects", hasSerial: true },
  { name: "project_repositories", hasSerial: false },
  { name: "milestones", hasSerial: true },
  { name: "hrms_project_mappings", hasSerial: true, booleanCols: ["auto_register"] },
  { name: "hrms_mapping_repos", hasSerial: false },
  { name: "hrms_task_logs", hasSerial: true },
  { name: "hrms_logicraft_mappings", hasSerial: true, booleanCols: ["auto_register"] },
  { name: "hrms_logicraft_task_logs", hasSerial: true },
  { name: "feed_entries", hasSerial: true },
  { name: "rss_commits", hasSerial: true },
];

async function migrate() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== MIGRATING ===");

  for (const table of tables) {
    const rows = sqliteDb.prepare(`SELECT * FROM ${table.name}`).all() as any[];
    console.log(`${table.name}: ${rows.length} rows`);

    if (DRY_RUN || rows.length === 0) continue;

    // 행별로 INSERT
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map(col => {
        let val = row[col];
        // INTEGER → BOOLEAN 변환
        if (table.booleanCols?.includes(col)) {
          val = val === 1;
        }
        // TEXT → JSONB 변환
        if (table.jsonbCols?.includes(col) && typeof val === "string") {
          try { val = JSON.parse(val); } catch { /* 문자열 유지 */ }
        }
        return val;
      });

      await pgSql`INSERT INTO ${pgSql(table.name)} ${pgSql(Object.fromEntries(cols.map((c, i) => [c, values[i]])))}`;
    }

    // SERIAL 시퀀스 동기화
    if (table.hasSerial) {
      await pgSql`SELECT setval(pg_get_serial_sequence(${table.name}, 'id'), COALESCE(MAX(id), 0)) FROM ${pgSql(table.name)}`;
    }
  }

  // 검증: row count 비교
  console.log("\n=== VERIFICATION ===");
  for (const table of tables) {
    const sqliteCount = (sqliteDb.prepare(`SELECT COUNT(*) as cnt FROM ${table.name}`).get() as any).cnt;
    const [pgRow] = await pgSql`SELECT COUNT(*)::int as cnt FROM ${pgSql(table.name)}`;
    const match = sqliteCount === pgRow.cnt ? "✓" : "✗ MISMATCH";
    console.log(`${table.name}: SQLite=${sqliteCount} PG=${pgRow.cnt} ${match}`);
  }

  sqliteDb.close();
  await pgSql.end();
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

Note: 이 스크립트는 마이그레이션 시에만 실행되므로 better-sqlite3를 devDependency로 임시 추가하거나, 별도 환경에서 실행.

- [ ] **Step 2: package.json에 스크립트 추가**

```json
"scripts": {
  "migrate:sqlite-to-pg": "npx tsx scripts/migrate-sqlite-to-pg.ts",
  "migrate:sqlite-to-pg:dry": "npx tsx scripts/migrate-sqlite-to-pg.ts --dry-run"
}
```

- [ ] **Step 3: 커밋**

```bash
git add scripts/migrate-sqlite-to-pg.ts package.json
git commit -m "feat: SQLite → PostgreSQL 데이터 마이그레이션 스크립트"
```

---

### Task 10: 최종 빌드 검증 + 정리

**Files:**
- Modify: `.gitignore` — `data/` 제거 확인
- Modify: `CLAUDE.md` — DB 관련 섹션 업데이트
- Modify: `AGENTS.md` — DB 관련 섹션 업데이트 (있는 경우)

- [ ] **Step 1: 빌드 검증**

Run: `npm run build`
Expected: 빌드 성공, 타입 에러 없음

- [ ] **Step 2: Docker Compose 풀 스택 테스트**

Run: `docker compose up --build`
Expected: PostgreSQL 시작 → 앱 시작 → 테이블 자동 생성 → 로그인 페이지 접근 가능

- [ ] **Step 3: 테스트 전체 실행**

Run: `npm test`
Expected: 모든 테스트 통과

- [ ] **Step 4: 정리**

- `.gitignore`에서 `data/` 항목이 여전히 필요한지 확인 (마이그레이션 스크립트 실행을 위해 유지할 수 있음)
- 불필요한 `better-sqlite3` 관련 코드가 남아있지 않은지 최종 검색

Run: `grep -r "better-sqlite3\|sqlite\|\.pragma\|getDb\(\)" src/ --include="*.ts" -l`
Expected: 결과 없음 (마이그레이션 스크립트 제외)

- [ ] **Step 5: CLAUDE.md 업데이트**

Tech Stack 섹션에서:
```
- **Database:** SQLite (better-sqlite3) — 폴링 상태 추적용
```
→
```
- **Database:** PostgreSQL 17 (postgres.js) — Docker Compose 구성
```

Deployment 섹션에서:
```
- SQLite DB 파일은 `data/tracker.db`에 저장됨 (gitignore 대상)
```
→
```
- PostgreSQL은 Docker Compose로 관리 (`docker compose up -d db`)
- 환경변수 `DATABASE_URL` 필수
```

Environment Variables 섹션에 `DATABASE_URL` 추가.

- [ ] **Step 6: 커밋**

```bash
git add .gitignore CLAUDE.md AGENTS.md
git commit -m "chore: SQLite → PostgreSQL 마이그레이션 완료 — 문서 업데이트"
```
