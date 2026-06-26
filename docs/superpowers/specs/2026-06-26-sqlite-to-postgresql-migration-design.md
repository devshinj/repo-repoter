# SQLite → PostgreSQL 마이그레이션 설계

**작성일:** 2026-06-26
**목적:** 다중 사용자 동시 접근 시 SQLite 단일 writer 제한 해소

## 결정 사항

- **드라이버:** `postgres.js` (tagged template, 내장 커넥션 풀링)
- **접근 방식:** Raw SQL 유지 — ORM 미도입
- **배포:** Docker Compose (PostgreSQL 17 Alpine + Next.js 앱)
- **데이터 이관:** 원샷 마이그레이션 스크립트로 기존 데이터 보존

## 1. 스키마 전환

### 타입 매핑

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT` | `TEXT` |
| `TEXT NOT NULL DEFAULT (datetime('now'))` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| `INTEGER` (boolean용) | `BOOLEAN` |
| `CHECK (status IN (...))` | `CHECK` 제약 조건 유지 (ENUM 미사용) |
| JSON 문자열 (`TEXT`) | `JSONB` |

### SQL 문법 변환

| SQLite | PostgreSQL |
|--------|-----------|
| `GROUP_CONCAT(col)` | `STRING_AGG(col, ',')` |
| `datetime('now')` | `NOW()` |
| `?` 파라미터 | postgres.js tagged template 자동 처리 |
| `CAST(u.id AS TEXT)` | 컬럼 타입 일관화로 제거 |
| `ON CONFLICT(col) DO UPDATE` | 동일 문법 지원 — 변환 불필요 |

### UNIQUE 제약 조건 (보존 대상)

- `users`: `email UNIQUE`
- `repositories`: `UNIQUE(user_id, clone_url)`
- `hrms_api_keys`: `user_id UNIQUE`
- `hrms_project_mappings`: `UNIQUE(user_id, hrms_project_id)`
- `hrms_logicraft_mappings`: `UNIQUE(user_id, logicraft_project_id)`
- `rss_commits`: `UNIQUE(repository_id, sha)`
- `logicraft_api_keys`: `user_id UNIQUE`

### CHECK vs ENUM

status 필드들(`sync_logs.status`, `hrms_task_logs.status` 등)은 CHECK 제약 조건을 유지한다. ENUM은 값 추가/삭제 시 ALTER TYPE이 필요해서 운영 부담이 크기 때문.

## 2. 데이터 마이그레이션

### 마이그레이션 스크립트

`scripts/migrate-sqlite-to-pg.ts` 원샷 스크립트 작성.

**이관 순서** (FK 의존 관계):

1. `users` → `user_credentials`, `hrms_api_keys`, `logicraft_api_keys`
2. `repositories` (FK: `user_credentials.credential_id`) → `commit_cache`, `sync_logs`
3. `projects` → `project_repositories`
4. `milestones`, `reports`, `feed_entries`
5. `hrms_project_mappings` → `hrms_mapping_repos` → `hrms_task_logs`
6. `hrms_logicraft_mappings` → `hrms_logicraft_task_logs`
7. `feed_entries` → `rss_commits` (FK: `feed_entry_id` ON DELETE SET NULL)

**시퀀스 동기화:** 이관 후 각 테이블마다 `SELECT setval('table_id_seq', MAX(id))` 실행.

**실행 방식:**
- 서비스 중단 후 실행 (다운타임 최소화)
- dry-run 모드로 건수 비교 먼저 수행
- 이관 후 테이블별 row count 검증 출력

## 3. connection.ts 및 repository 레이어

### connection.ts 재작성

```typescript
// before: better-sqlite3
import Database from 'better-sqlite3';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// after: postgres.js
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
```

- PRAGMA 설정 전부 제거
- `createTables()` PostgreSQL 문법으로 재작성 (최종 스키마 직접 생성)
- `migrateSchema()` **삭제** — SQLite 전용 증분 마이그레이션(`PRAGMA table_info`, `sqlite_master` 쿼리)이므로 PostgreSQL에서는 불필요. 기존 데이터는 마이그레이션 스크립트로 이관.
- `closeDb()` → postgres.js의 `sql.end()` 호출로 전환
- `sql` 인스턴스를 export

### repository 함수 변환 패턴

모든 50개+ 함수가 동기 → 비동기로 변경.

```typescript
// before: 동기
export function getUserByEmail(email: string) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

// after: 비동기
export async function getUserByEmail(email: string) {
  const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
  return user;
}
```

**핵심 변환:**

| before (better-sqlite3) | after (postgres.js) |
|------------------------|---------------------|
| `.prepare().get()` | `const [row] = await sql\`...\`` |
| `.prepare().all()` | `const rows = await sql\`...\`` |
| `.prepare().run()` | `await sql\`...\`` |
| `db.transaction(() => {})()` | `await sql.begin(async (tx) => {})` |
| CAS 패턴 | `UPDATE ... RETURNING` 활용 |

### 호출부 변경 범위

- API 라우트 (~10개) — 이미 async, await만 추가
- 스케줄러 (~5개) — 대부분 async, await 추가
- `src/lib/auth.ts` — 콜백 내 await 추가

## 4. Docker Compose 구성

### docker-compose.yml

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: autobriify
      POSTGRES_USER: autobriify
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U autobriify"]
      interval: 5s
      timeout: 3s
      retries: 5

  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://autobriify:${POSTGRES_PASSWORD}@db:5432/autobriify
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

### Dockerfile

- Node.js 22 Alpine 베이스
- `npm ci` → `npm run build` → `npm start`
- better-sqlite3 네이티브 빌드 의존성 제거

### 로컬 개발

- `docker compose up db`로 DB만 띄우고 `npm run dev` 가능
- 또는 로컬 PostgreSQL에 직접 연결

## 5. 환경 변수

```
# 추가
DATABASE_URL=postgresql://autobriify:password@db:5432/autobriify

# 제거
(SQLite는 환경변수 없이 파일 경로 하드코딩이었음)
```

## 6. 의존성 변경

```
# 제거
better-sqlite3
@types/better-sqlite3

# 추가
postgres
```

## 7. 제거 대상 코드

- `data/` 디렉토리 경로 로직
- PRAGMA 설정 전체
- `getCachedShas()`의 500개 배치 로직 → 단일 쿼리로 단순화
- `CAST(u.id AS TEXT)` 약타입 우회 코드

## 8. 유지 사항

- `src/infra/db/` 디렉토리 구조 및 파일 분리
- repository 패턴, 함수 시그니처(반환 타입) — async만 추가
- 기존 테스트 기대값/로직 — DB 접근부만 수정

## 9. .gitignore 변경

```
# 제거
data/

# 확인
.env 에 DATABASE_URL 포함
```
