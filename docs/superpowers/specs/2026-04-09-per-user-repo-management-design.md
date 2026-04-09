# 사용자별 저장소 관리 설계 스펙

> 날짜: 2026-04-09
> 상태: 승인됨
> 관련: [기존 설계 스펙](./2026-04-09-git-notion-task-tracker-design.md)

## 개요

기존 `.env` 기반 글로벌 GitHub 토큰 + 공유 저장소 구조를 **사용자별 저장소 등록 및 인증** 구조로 전환한다.
사용자가 직접 Git clone URL과 PAT을 등록하면 서버가 bare clone 후 주기적으로 커밋을 수집한다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| Git 인증 방식 | PAT 직접 입력 (GitHub OAuth 미사용) |
| 저장소 URL | 범용 Git URL — GitHub, GitLab, Gitea 등 모든 HTTPS Git 호스팅 |
| 커밋 수집 방식 | `git clone --bare` + `git fetch` + `git log` (Octokit 대체) |
| 토큰 저장 | AES-256-GCM 암호화, `AUTH_SECRET`에서 키 파생 |
| 저장소 가시성 | 완전 격리 — 본인 저장소만 조회/수정/삭제 가능 |
| clone 파일 구조 | `data/repos/{userId}/{owner}/{repo}.git` |
| 외부 API 인증 범위 | Git PAT + Notion API 키 = 사용자별, Gemini API 키 = 글로벌(`.env`) |
| 마이그레이션 전략 | 점진적 — 기존 `infra/github/` 유지하면서 `infra/git/` 병렬 추가 후 전환 |

## 1. DB 스키마 변경

### 1.1 `user_credentials` 테이블 (신규)

```sql
CREATE TABLE user_credentials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  provider   TEXT NOT NULL,            -- 'git' | 'notion'
  credential TEXT NOT NULL,            -- AES-256-GCM 암호화된 토큰
  label      TEXT,                     -- 사용자 구분용 라벨 (예: "회사 GitLab PAT")
  metadata   TEXT,                     -- JSON (Notion DB ID 등)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);
```

- `provider` 구분으로 git PAT과 Notion API 키를 같은 테이블에서 관리
- 사용자당 provider별 1개 제한 (`UNIQUE(user_id, provider)`)
- `metadata`에 Notion 전용 설정 저장: `{ "notionCommitDbId": "...", "notionTaskDbId": "..." }`

### 1.2 `repositories` 테이블 변경

기존 컬럼 유지 + 추가:

```sql
ALTER TABLE repositories ADD COLUMN user_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE repositories ADD COLUMN clone_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE repositories ADD COLUMN clone_path TEXT;
```

- 기존 `UNIQUE(owner, repo)` → `UNIQUE(user_id, clone_url)` 로 변경
- `owner`, `repo`는 URL에서 파싱해서 유지 (Notion 기록, 표시 용도)
- `clone_url`이 실제 저장소 식별자

### 1.3 `sync_logs` 테이블 변경

```sql
ALTER TABLE sync_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
```

## 2. 암호화 모듈

### 파일: `src/infra/crypto/token-encryption.ts`

```
encrypt(plainText: string): string
decrypt(encrypted: string): string
```

- AES-256-GCM 사용 (Node.js 내장 `crypto` 모듈)
- `AUTH_SECRET` → SHA-256 해시 → 32바이트 암호화 키 파생
- 출력 형식: `{iv}:{authTag}:{ciphertext}` (hex 인코딩)
- 외부 의존성 없음

**제약:**
- `AUTH_SECRET` 변경 시 기존 암호화된 토큰 복호화 불가. Auth.js 세션도 동일한 제약이므로 허용.
- bare clone의 remote URL에 토큰이 평문으로 포함됨 (`data/repos/` 디렉토리 내 `.git/config`). 서버 디스크 접근 권한이 있는 사람에게 노출 가능. 프로토타입 단계에서 허용하되, 프로덕션 전환 시 git credential helper 방식으로 개선 필요.

## 3. Git CLI 래퍼

### 파일: `src/infra/git/git-client.ts`

Node.js `child_process.execFile`로 git 명령 실행:

```
cloneRepository(cloneUrl: string, destPath: string, token: string): Promise<void>
  → git clone --bare {인증 포함 URL} {destPath}
  → HTTPS URL에 토큰 삽입: https://{token}@host/owner/repo.git

pullRepository(repoPath: string, token: string): Promise<void>
  → git --git-dir={repoPath} fetch origin

getCommitsSince(repoPath: string, branch: string, sinceSha?: string): Promise<CommitRecord[]>
  → git --git-dir={repoPath} log {sinceSha..origin/branch 또는 origin/branch}
  → --format으로 sha, message, author, date, files 파싱
  → CommitRecord[] 타입으로 변환

getCommitDiff(repoPath: string, sha: string): Promise<string>
  → git --git-dir={repoPath} diff {sha}^..{sha}
```

### 인증 처리

- HTTPS URL에 토큰 직접 삽입: `https://{token}@github.com/owner/repo.git`
- GitHub, GitLab, Gitea 모두 이 방식 지원
- bare clone이므로 remote URL에 토큰이 포함됨 → `fetch` 시 재인증 불필요
- 토큰 변경 시 `git remote set-url origin` 으로 갱신

### CommitRecord 호환

- `git log` 출력을 기존 `CommitRecord` 타입으로 변환
- `repoOwner`, `repoName`은 clone URL에서 파싱
- 하류 모듈(core analyzer, mapper)은 변경 없이 동작

### 기존 `infra/github/` 와의 관계

- 새 `infra/git/`이 커밋 수집 담당
- `infra/github/github-client.ts`는 과도기에 유지, 안정화 후 제거

## 4. API 라우트

### 4.1 `/api/repos` 수정

```
GET    /api/repos          세션 user_id로 필터링, 본인 저장소만 반환
POST   /api/repos          user_id 자동 주입, clone_url 필수
                            등록 시 bare clone 비동기 트리거
DELETE /api/repos/:id      소유권 확인 → 삭제 + clone 디렉토리 정리
```

### 4.2 `/api/credentials` 신규

```
GET    /api/credentials           본인 자격증명 목록 (토큰값 마스킹)
POST   /api/credentials           provider + token 암호화 저장
PUT    /api/credentials/:id       토큰 갱신
DELETE /api/credentials/:id       삭제
```

### 4.3 `/api/repos/:id/sync` 신규

```
POST   /api/repos/:id/sync       수동 동기화 트리거 (즉시 pull + 커밋 수집)
```

### 공통 규칙

- 모든 엔드포인트에서 `auth()` 세션 필수
- `session.user.id`로 소유권 검증
- 타인 리소스 접근 시 403 반환

## 5. 스케줄러 변경

### 기존 흐름
```
getActiveRepositories() → 전체 순회 → 공유 GITHUB_TOKEN
```

### 변경 흐름
```
getActiveUsers()
  → 사용자별 loop:
    → getUserCredentials(userId) → git 토큰 복호화, notion 토큰 복호화
    → getRepositoriesByUser(userId) → 저장소 순회
      → git fetch + git log → CommitRecord[]
      → 기존 파이프라인 유지:
        → commit grouping
        → Gemini 분석 (글로벌 키)
        → Notion 동기화 (사용자 키 + 사용자 DB ID)
    → insertSyncLog(userId, ...)
```

### Notion 사용자별 동기화

- 사용자의 Notion API 키로 해당 사용자의 Notion DB에 기록
- Notion DB ID는 `user_credentials.metadata`에 JSON으로 저장:
  ```json
  { "notionCommitDbId": "...", "notionTaskDbId": "..." }
  ```

### 에러 격리

- 한 사용자의 토큰 만료나 clone 실패가 다른 사용자에 영향 없음
- `sync_logs.user_id` 추가로 사용자별 이력 추적

## 6. UI 변경

### 6.1 저장소 관리 페이지 (`/repos`)

**저장소 등록 다이얼로그:**
- Git clone URL 입력 (placeholder: `https://github.com/owner/repo.git`)
- 브랜치 입력 (기본값: `main`)
- URL 형식 검증: HTTPS로 시작

**저장소 목록:**
- 본인 저장소만 표시
- 각 저장소에 마지막 동기화 시간, 상태 표시
- "지금 동기화" 버튼 (`POST /api/repos/:id/sync`)

### 6.2 설정 페이지 (`/settings`) 확장

**자격증명 관리 섹션:**
- Git PAT 등록/수정 (마스킹 표시: `ghp_****xxxx`)
- Notion API 키 등록/수정 (마스킹 표시)
- Notion DB ID 설정 (커밋 로그 DB, 일일 태스크 DB)

**UX 흐름:**
1. 첫 로그인 → 설정 페이지에서 Git PAT + Notion 키 등록
2. 저장소 페이지에서 clone URL로 저장소 등록
3. bare clone 시작 → 완료 후 모니터링 시작
4. 자격증명 미등록 시 저장소 등록 폼에서 안내 메시지 표시

## 7. 타입 변경 (`src/core/types.ts`)

### Repository 확장
```typescript
interface Repository {
  // 기존 필드 유지
  id: number
  owner: string
  repo: string
  branch: string
  lastSyncedSha: string | null
  isActive: boolean
  pollingIntervalMin: number
  createdAt: string
  updatedAt: string
  // 추가 필드
  userId: string
  cloneUrl: string
  clonePath: string | null
}
```

### UserCredential 신규
```typescript
interface UserCredential {
  id: number
  userId: string
  provider: 'git' | 'notion'
  label: string | null
  metadata: Record<string, string> | null
  createdAt: string
  updatedAt: string
  // credential(토큰)은 포함하지 않음 — infra 레이어에서만 복호화
}
```

### SyncLog 확장
```typescript
interface SyncLog {
  // 기존 필드 유지
  id: number
  repositoryId: number
  status: 'success' | 'error'
  commitsProcessed: number
  tasksCreated: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
  // 추가
  userId: string
}
```

### core 레이어 순수성

- `CommitRecord`, `DailyTask`는 변경 없음
- core의 analyzer, mapper 모듈은 수정 불필요
- 암호화/복호화는 `infra/crypto`에서만 처리

## 8. 파일 구조 변경 요약

```
src/
├── infra/
│   ├── crypto/
│   │   └── token-encryption.ts    # 신규 — AES-256-GCM 암복호화
│   ├── git/
│   │   └── git-client.ts          # 신규 — git CLI 래퍼
│   ├── github/
│   │   └── github-client.ts       # 유지 (과도기) → 이후 제거
│   ├── notion/
│   │   └── notion-client.ts       # 수정 — 사용자별 API 키 수용
│   └── db/
│       ├── schema.ts              # 수정 — user_credentials, 컬럼 추가
│       ├── repository.ts          # 수정 — user_id 스코핑 쿼리
│       └── credential.ts          # 신규 — 자격증명 CRUD
├── app/
│   ├── api/
│   │   ├── repos/                 # 수정 — user_id 검증
│   │   └── credentials/           # 신규
│   └── (dashboard)/
│       ├── repos/page.tsx         # 수정 — clone URL, 동기화 버튼
│       └── settings/page.tsx      # 수정 — 자격증명 관리 섹션
├── core/
│   └── types.ts                   # 수정 — Repository, UserCredential, SyncLog
└── scheduler/
    └── polling-manager.ts         # 수정 — 사용자별 순회
```

## 9. 환경 변수 변경

### 제거 (사용자별로 전환)
```
GITHUB_TOKEN          # → user_credentials 테이블
NOTION_API_KEY        # → user_credentials 테이블
NOTION_COMMIT_DB_ID   # → user_credentials.metadata
NOTION_TASK_DB_ID     # → user_credentials.metadata
```

### 유지
```
GEMINI_API_KEY        # 글로벌 (공통)
AUTH_HRMS_ID          # HRMS OAuth2
AUTH_HRMS_SECRET
AUTH_HRMS_ISSUER
AUTH_SECRET           # NextAuth + 토큰 암호화 키
AUTH_URL
```

## 10. clone 디렉토리 구조

```
data/
└── repos/
    └── {userId}/
        └── {owner}/
            └── {repo}.git          # bare clone
```

- `.gitignore`에 `data/repos/` 추가
- 저장소 삭제 시 해당 디렉토리도 정리
