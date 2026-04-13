# PAT 기반 저장소 선택 등록 설계

## 개요

저장소 등록 시 URL 직접 입력 대신, 등록된 PAT로 GitHub/Gitea API를 호출하여 사용자 저장소 목록을 가져오고 선택 등록할 수 있도록 개선한다.

## 배경

현재 저장소 등록은 Git URL을 직접 입력해야 한다. 사용자가 이미 PAT를 등록했으므로, 해당 토큰으로 API를 호출하면 저장소 목록을 자동으로 가져올 수 있다. GitHub과 Gitea 두 플랫폼 모두 지원해야 한다.

## 설계

### 1. Credential 스키마 변경

`user_credentials` 테이블의 `metadata` 필드(TEXT, JSON 문자열)에 호스트 정보를 저장한다.

**GitHub 프리셋:**
```json
{
  "type": "github",
  "host": "github.com",
  "apiBase": "https://api.github.com"
}
```

**Gitea 커스텀:**
```json
{
  "type": "gitea",
  "host": "gitea.company.com",
  "apiBase": "https://gitea.company.com/api/v1"
}
```

**마이그레이션:** 기존 provider="git"이면서 metadata가 null인 credential에 GitHub 기본값을 적용한다.

```sql
UPDATE user_credentials
SET metadata = '{"type":"github","host":"github.com","apiBase":"https://api.github.com"}'
WHERE provider = 'git' AND (metadata IS NULL OR metadata = '');
```

### 2. Credential 등록 UI 변경 (설정 페이지)

현재 provider "git" 고정에 label + token만 입력한다.

변경:
- **서비스 타입 선택 라디오:** "GitHub" | "Gitea/기타"
- GitHub 선택 시: 호스트 필드 자동 채움 (`github.com`), 비활성화
- Gitea 선택 시: 호스트 URL 입력 필드 활성화 (placeholder: `gitea.example.com`)
- label, token 필드는 동일하게 유지

API 호출 시 `metadata` 필드에 type, host, apiBase를 JSON 문자열로 포함하여 전송한다.

### 3. 저장소 목록 조회 API

**엔드포인트:** `GET /api/git-providers/repos?credentialId={id}`

**처리 흐름:**
1. 인증 확인 (session)
2. credentialId로 해당 사용자의 credential 조회
3. credential의 metadata에서 type 확인
4. type에 따라 GitHub 또는 Gitea API 호출
5. 통일된 형태로 응답

**응답 스키마:**
```typescript
interface RemoteRepository {
  name: string;           // "repo-name"
  owner: string;          // "owner-name"  
  fullName: string;       // "owner/repo-name"
  cloneUrl: string;       // "https://github.com/owner/repo.git"
  defaultBranch: string;  // "main"
  language: string | null;
  isPrivate: boolean;
  description: string | null;
}
```

### 4. infra 레이어: Git Provider 모듈

`src/infra/git-provider/` 디렉토리에 플랫폼별 API 클라이언트를 추가한다.

#### `github-api.ts`

- `@octokit/rest`의 Octokit을 **사용자 PAT로 인스턴스화** (환경변수가 아닌 토큰 파라미터)
- `listUserRepos(token: string): Promise<RemoteRepository[]>`
- `GET /user/repos` — `visibility: "all"`, `affiliation: "owner,collaborator,organization_member"`, 페이지네이션 처리

#### `gitea-api.ts`

- 표준 `fetch`로 Gitea REST API v1 호출
- `listUserRepos(apiBase: string, token: string): Promise<RemoteRepository[]>`
- `GET {apiBase}/user/repos` — `Authorization: token {PAT}` 헤더, 페이지네이션 처리

두 모듈 모두 동일한 `RemoteRepository[]` 타입을 반환한다.

### 5. 저장소 등록 다이얼로그 UI 변경

다이얼로그를 **탭 2개** 구조로 변경한다.

#### 탭 A: "저장소 선택" (기본)

```
┌─────────────────────────────────────────┐
│  [저장소 선택]  |  URL 직접 입력         │
├─────────────────────────────────────────┤
│                                         │
│  자격증명 선택                            │
│  ┌───────────────────────────────────┐  │
│  │ 회사 GitHub — github.com       ▼  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  🔍 저장소 검색...                       │
│                                         │
│  ☐ owner/repo-a    TypeScript  main     │
│  ☐ owner/repo-b    Python      develop  │
│  ☐ owner/repo-c    Go          main     │
│  ✅ owner/repo-d   (등록됨)              │
│                                         │
│  3개 선택됨                              │
│                            [등록]        │
└─────────────────────────────────────────┘
```

- PAT 드롭다운 선택 → 자동으로 저장소 목록 로드
- 로딩 중 스피너 표시
- 검색 필터로 저장소명 필터링
- 이미 등록된 저장소는 체크 비활성화 + "등록됨" 배지
- 복수 선택 후 일괄 등록
- 브랜치는 API에서 받은 defaultBranch 자동 설정

#### 탭 B: "URL 직접 입력" (기존)

현재 다이얼로그와 동일: URL 입력 + 브랜치 입력 + 등록

### 6. 저장소 일괄 등록 API

기존 `POST /api/repos`를 확장한다.

**기존 (단건):**
```json
{ "cloneUrl": "https://...", "branch": "main" }
```

**추가 (복수건):**
```json
{
  "repositories": [
    { "cloneUrl": "https://github.com/owner/repo-a.git", "branch": "main" },
    { "cloneUrl": "https://github.com/owner/repo-b.git", "branch": "develop" }
  ]
}
```

body에 `repositories` 배열이 있으면 일괄 등록, 없으면 기존 단건 로직을 탄다.

### 7. 변경 범위

| 레이어 | 파일 | 변경 내용 |
|--------|------|-----------|
| core | `types.ts` | `RemoteRepository` 타입 추가 |
| infra | `git-provider/github-api.ts` (신규) | GitHub 사용자 저장소 목록 조회 |
| infra | `git-provider/gitea-api.ts` (신규) | Gitea 사용자 저장소 목록 조회 |
| infra | `db/schema.ts` | 기존 credential metadata 마이그레이션 |
| API | `api/git-providers/repos/route.ts` (신규) | 저장소 목록 조회 엔드포인트 |
| API | `api/credentials/route.ts` | POST 시 metadata 저장 로직 |
| API | `api/repos/route.ts` | POST 일괄 등록 지원 |
| UI | `settings/page.tsx` | 서비스 타입 프리셋 선택 UI |
| UI | `repos/page.tsx` | 등록 다이얼로그 탭 구조 + 저장소 선택 UI |

### 8. 에러 처리

- PAT 권한 부족 시: API에서 401/403 → "토큰 권한을 확인하세요" 메시지
- Gitea URL 잘못된 경우: 연결 실패 → "호스트에 연결할 수 없습니다" 메시지
- 이미 등록된 저장소 중복 등록 시도: DB UNIQUE 제약 → 건너뛰고 나머지 등록
