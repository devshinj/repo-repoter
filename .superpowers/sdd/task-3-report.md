# Task 3 Report: credential.ts + report.ts PostgreSQL 비동기 전환

## 변환 대상

- `src/infra/db/credential.ts`
- `src/infra/db/report.ts`

## 적용된 변환 규칙

| 규칙 | credential.ts | report.ts |
|------|--------------|-----------|
| better-sqlite3 import 제거 → sql import | ✅ | ✅ |
| `db: Database.Database` 파라미터 제거 | ✅ (전 함수) | ✅ (전 함수) |
| `async` + `Promise<...>` 반환 타입 추가 | ✅ | ✅ |
| `.prepare().get()` → `const [row] = await sql\`...\`` | ✅ | ✅ |
| `.prepare().all()` → `await sql\`...\`` | ✅ | ✅ |
| `.prepare().run()` → `await sql\`...\`` | ✅ | ✅ |
| `result.changes > 0` → `result.count > 0` | N/A | ✅ |
| `result.lastInsertRowid` → `RETURNING id` | N/A | ✅ |
| `datetime('now')` → `NOW()` | ✅ | ✅ |
| `?` placeholder → tagged template `${variable}` | ✅ | ✅ |
| `is_active = 1` → `is_active = true` | N/A | N/A |
| JSONB metadata → `sql.json(value)` | ✅ | N/A |

## 함수별 변환 상세

### credential.ts

- `insertCredential(db, input)` → `insertCredential(input): Promise<void>`
  - metadata가 string으로 저장되어 있어 JSON.parse 후 sql.json() 적용
  - null인 경우 그대로 null 전달
- `getCredentialsByUser(db, userId)` → `getCredentialsByUser(userId): Promise<any[]>`
- `getCredentialByUserAndProvider(db, userId, provider)` → `getCredentialByUserAndProvider(userId, provider): Promise<any | undefined>`
  - array destructuring으로 첫 번째 row 반환
- `getCredentialsByUserAndProvider(db, userId, provider)` → `getCredentialsByUserAndProvider(userId, provider): Promise<any[]>`
- `getCredentialById(db, id)` → `getCredentialById(id): Promise<any | undefined>`
- `updateCredential(db, id, input)` → `updateCredential(id, input): Promise<void>`
  - metadata null 처리 동일하게 적용
- `deleteCredential(db, id)` → `deleteCredential(id): Promise<void>`

### report.ts

- `insertReport(db, input)` → `insertReport(input): Promise<number>`
  - `RETURNING id` 절 추가, `row.id` 반환
- `getReportsByUser(db, userId)` → `getReportsByUser(userId): Promise<any[]>`
- `getReportById(db, id, userId)` → `getReportById(id, userId): Promise<any | undefined>`
- `updateReport(db, id, userId, input)` → `updateReport(id, userId, input): Promise<boolean>`
  - `result.changes > 0` → `result.count > 0`
- `deleteReport(db, id, userId)` → `deleteReport(id, userId): Promise<boolean>`
  - `result.changes > 0` → `result.count > 0`
- `updateReportStatus(db, id, status, updates?)` → `updateReportStatus(id, status, updates?): Promise<boolean>`
  - 분기별로 각각 `result.count > 0` 적용

## 주의사항 / Concerns

1. **connection.ts 미전환**: 현재 `src/infra/db/connection.ts`는 여전히 better-sqlite3 기반(`getDb()` export). `sql` export가 없으므로 이 파일들은 connection.ts가 postgres.js로 전환될 때까지 TypeScript 컴파일 오류가 발생한다.

2. **metadata JSONB 처리**: 원본에서 `metadata`는 `string | null` 타입으로 선언되어 있다. PostgreSQL JSONB 컬럼이면 `sql.json(JSON.parse(string))` 패턴이 맞지만, 컬럼이 TEXT면 그냥 string을 직접 전달해야 한다. 스키마 확인 필요.

3. **호출부 변경 필요**: `db` 파라미터를 제거했으므로, 이 함수들을 호출하는 모든 곳(`app/` routes, `scheduler/`)에서 `getDb()` 전달 코드를 제거하고 `await` 추가가 필요하다.

4. **테스트 없음**: infra 레이어 DB 함수는 실제 DB 연결이 있어야 검증 가능하므로 단위 테스트 대상 아님 (CLAUDE.md 기준 준수).
