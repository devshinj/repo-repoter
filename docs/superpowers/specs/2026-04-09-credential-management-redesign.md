# Credential Management Redesign

## Overview

설정 페이지의 자격증명 관리를 범용화한다. 같은 서비스에 여러 자격증명을 등록할 수 있도록 하고, 각 자격증명을 개별 카드로 표시하여 라벨 수정, 토큰 갱신, 삭제를 지원한다. Notion DB 연동 섹션은 제거한다.

## Scope

### In Scope

- DB: `UNIQUE(user_id, provider)` 제약 제거 → 같은 provider 다중 등록 허용
- API: id 기반 PUT/DELETE로 변경, provider 유효값은 `git`만 허용
- UI: 등록된 자격증명을 카드 리스트로 표시, 새 등록 폼, 카드별 라벨 수정/토큰 갱신/삭제
- Notion 연동 섹션 제거 (설정 페이지에서만 — API/infra의 Notion 클라이언트는 유지)

### Out of Scope

- Notion, Gemini 등 추가 provider 지원 (향후 프리셋 추가 시 provider 배열에 추가하면 됨)
- 자격증명 유효성 검증 (토큰으로 API 호출해서 유효한지 확인)
- 자격증명 선택 연동 (저장소 등록 시 어떤 자격증명을 사용할지 선택하는 기능)

## Design

### 1. DB Schema Change

**현재:** `UNIQUE(user_id, provider)` — provider당 1개만

**변경:** UNIQUE 제약을 제거하고 `user_id`와 `provider`에 일반 인덱스만 유지

```sql
-- migrateSchema에 추가
-- SQLite는 UNIQUE 제약을 직접 DROP할 수 없으므로 테이블 재생성
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
-- 기존 데이터 마이그레이션 후 테이블 교체
```

### 2. API Changes (`/api/credentials`)

**GET** — 변경 없음 (현재 사용자의 모든 자격증명 반환)

**POST** — provider 중복 체크 제거, `label` 필수화
- `provider`: `"git"` 만 허용
- `token`: 필수
- `label`: 필수 (구분용)

**PUT** `/api/credentials/[id]` — id 기반으로 변경
- 토큰 갱신, 라벨 수정 지원
- 본인 소유 자격증명만 수정 가능

**DELETE** `/api/credentials/[id]` — id 기반으로 변경
- 본인 소유 자격증명만 삭제 가능

### 3. UI Design

#### 레이아웃

```
설정
외부 서비스 자격증명을 관리합니다

[+ 새 자격증명 등록] 버튼

--- 등록된 자격증명 카드 리스트 ---

┌─────────────────────────────────────┐
│ [Git 아이콘] 회사 GitHub PAT         │
│ 토큰: ghp_****...ab12               │
│ 등록: 2026-04-09  갱신: 2026-04-09   │
│                                     │
│              [라벨 수정] [토큰 갱신] [삭제] │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ [Git 아이콘] 개인 GitHub PAT         │
│ 토큰: ghp_****...xy34               │
│ 등록: 2026-04-08  갱신: 2026-04-08   │
│                                     │
│              [라벨 수정] [토큰 갱신] [삭제] │
└─────────────────────────────────────┘

--- Gemini API (현행 유지) ---
서버 환경 변수로 관리됩니다
```

#### 새 등록 다이얼로그

`[+ 새 자격증명 등록]` 클릭 시 다이얼로그(또는 인라인 폼) 표시:
- 서비스 선택: Git (현재는 Git만, 향후 드롭다운으로 확장)
- 라벨: 필수 입력 (예: "회사 GitHub PAT")
- 토큰: 필수 입력

#### 카드 인라인 편집

- **라벨 수정:** 카드에서 직접 라벨 텍스트 편집 후 저장
- **토큰 갱신:** 새 토큰 입력 필드 표시 → 저장
- **삭제:** 확인 다이얼로그 후 삭제

### 4. Provider 프리셋 구조

```typescript
const providerPresets = {
  git: {
    name: "Git",
    icon: GitBranch, // lucide-react
    placeholder: "ghp_xxxx 또는 glpat-xxxx",
    description: "GitHub, GitLab, Gitea 등의 Personal Access Token",
  },
} as const;
```

향후 provider 추가 시 이 객체에 항목만 추가하면 된다.

### 5. 기존 코드 영향

- `src/infra/db/credential.ts`: `getCredentialByUserAndProvider` 함수는 다중 결과를 반환하도록 변경 필요
- 스케줄러/동기화에서 자격증명을 가져올 때: 저장소별로 어떤 자격증명을 쓸지는 현재 scope 밖이므로, 기존처럼 provider로 첫 번째 매칭을 사용
- `src/core/types.ts`의 `UserCredential.provider` 타입: `"git"` 만으로 변경

## File Changes

| File | Change |
|------|--------|
| `src/infra/db/schema.ts` | `migrateSchema`에 UNIQUE 제약 제거 마이그레이션 추가 |
| `src/infra/db/credential.ts` | 함수 시그니처 조정 (id 기반 update/delete) |
| `src/app/api/credentials/route.ts` | POST 중복체크 제거, GET 유지 |
| `src/app/api/credentials/[id]/route.ts` | 신규 — PUT, DELETE (id 기반) |
| `src/app/(dashboard)/settings/page.tsx` | 전면 리디자인 — 카드 리스트 + 등록 다이얼로그 |
| `src/core/types.ts` | `UserCredential.provider` 타입 수정 |
