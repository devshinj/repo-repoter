# Repo Task Tracker 설계 스펙

## Context

개발자가 Git 환경에서 작업한 내용을 자동으로 수집·분석하여 Notion DB에 일일 업무 수행 목록으로 정리하는 서비스.
커밋 메시지와 코드 변경을 AI(Gemini)로 분석하여, 프로젝트별·날짜별 태스크를 자동 생성하고 Notion 캘린더/보드 뷰로 시각화한다.

### 해결하려는 문제

- 개발자가 매일 수행한 작업을 수동으로 기록하는 번거로움
- 커밋 메시지가 모호할 때 실제 작업 내용을 파악하기 어려움
- 프로젝트별·일자별 업무 이력을 체계적으로 관리할 방법 부재

### 의도한 결과

- Git 커밋을 자동으로 수집하여 Notion에 구조화된 업무 기록 생성
- Notion 캘린더/보드 뷰로 일자별 업무 수행 현황 확인 가능
- 팀 내 서버에 배포하여 팀원들이 공유 사용

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Next.js (App Router) |
| 언어 | TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| 데이터베이스 | SQLite (better-sqlite3) |
| 인증 | NextAuth.js + HRMS OAuth2/OIDC |
| 외부 API | GitHub REST API, Notion API, Gemini API |
| 스케줄러 | node-cron (instrumentation.ts에서 초기화) |
| 개발 방법론 | OpenAI Harness Engineering |

### 프로젝트 스킬

| 스킬 | 용도 |
|------|------|
| `git-commit-analyzer` | Git 커밋 수집/분석 파이프라인 구현 가이드 |
| `notion-db-sync` | Notion DB 동기화 패턴 가이드 |
| `nextjs-polling-service` | Next.js 백그라운드 폴링 서비스 가이드 |

---

## 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────┐
│                   Next.js App Router                 │
├──────────────┬──────────────┬───────────────────────┤
│   Web UI     │  API Routes  │   Background Service  │
│              │              │                       │
│ • 대시보드    │ • /api/repos │ • Polling Scheduler   │
│ • 저장소 관리 │ • /api/sync  │   (node-cron)         │
│ • 캘린더 뷰   │ • /api/tasks │ • Commit Collector    │
│ • 보드 뷰    │ • /api/cron  │ • Gemini Analyzer     │
│              │ • /api/auth  │ • Notion Syncer       │
├──────────────┴──────────────┴───────────────────────┤
│                    Core Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ GitHub   │  │ Gemini   │  │ Notion           │  │
│  │ Client   │  │ Client   │  │ Client           │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────────────┘  │
│       │              │              │                │
├───────┴──────────────┴──────────────┴────────────────┤
│                  SQLite (better-sqlite3)              │
│  • 등록된 저장소 목록                                  │
│  • 마지막 폴링 커밋 SHA                                │
│  • 폴링/동기화 로그                                    │
└─────────────────────────────────────────────────────┘
```

### 디렉토리 구조 (Harness Engineering 레이어 분리)

```
src/
├── app/                    # Next.js App Router (UI + API Routes)
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── page.tsx              # 대시보드
│   │   ├── repos/page.tsx        # 저장소 관리
│   │   ├── tasks/page.tsx        # 일일 태스크 목록
│   │   ├── calendar/page.tsx     # 캘린더 뷰
│   │   └── settings/page.tsx     # 설정
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── repos/route.ts
│       ├── sync/route.ts
│       ├── tasks/route.ts
│       └── cron/route.ts
├── core/                   # 비즈니스 로직 (순수 함수, 외부 의존 없음)
│   ├── analyzer/           # 커밋 → 태스크 분석 로직
│   │   ├── commit-grouper.ts     # 날짜/프로젝트별 커밋 그룹핑
│   │   └── task-extractor.ts     # Gemini 분석 결과 → 태스크 변환
│   └── mapper/             # 데이터 변환
│       ├── commit-mapper.ts      # GitHub 커밋 → 내부 모델
│       └── notion-mapper.ts      # 내부 모델 → Notion 프로퍼티
├── infra/                  # 외부 서비스 클라이언트
│   ├── github/
│   │   └── github-client.ts      # GitHub REST API 래퍼
│   ├── gemini/
│   │   └── gemini-client.ts      # Gemini API 래퍼
│   ├── notion/
│   │   └── notion-client.ts      # Notion API 래퍼
│   └── db/
│       ├── schema.ts             # SQLite 테이블 정의
│       └── repository.ts         # DB 접근 함수
├── scheduler/
│   └── polling-manager.ts        # node-cron 기반 폴링 스케줄러
├── instrumentation.ts            # Next.js 서버 시작 시 스케줄러 초기화
├── docs/                         # 구조화된 문서 (Harness Engineering)
└── AGENTS.md                     # 에이전트 컨텍스트 맵
```

### 레이어 의존성 규칙

- `app/` → `core/` → `infra/` (단방향)
- `core/`는 외부 의존성 없이 순수 TypeScript 로직만
- `infra/`는 외부 API 호출 담당 (교체 가능한 어댑터)
- `scheduler/`는 `core/` + `infra/`를 조합하여 파이프라인 실행

---

## 데이터 흐름: 핵심 파이프라인

### 커밋 수집 → 분석 → Notion 동기화

```
[GitHub API]                [Gemini API]              [Notion API]
     │                           │                         │
     ▼                           ▼                         ▼
┌──────────┐  커밋 목록    ┌──────────┐  분석 결과    ┌──────────┐
│ Commit   │──────────────▶│ Commit   │─────────────▶│ Notion   │
│ Collector│               │ Analyzer │              │ Syncer   │
└──────────┘               └──────────┘              └──────────┘
     │                           │                         │
     ▼                           ▼                         ▼
  SQLite에                  분석 결과:                 2개 DB에
  마지막 SHA 저장           • 태스크 제목               페이지 생성
                           • 작업 설명
                           • 작업 복잡도
```

### 파이프라인 단계

**1단계: Commit Collector**
- GitHub API로 등록된 저장소의 새 커밋 조회 (`GET /repos/{owner}/{repo}/commits`)
- SQLite에 저장된 마지막 처리 SHA 이후의 커밋만 가져옴
- 각 커밋의 메시지, 작성자, 시간, 변경 파일 목록 수집

**2단계: Commit Analyzer (Gemini)**
- 커밋 메시지가 명확한 경우: 메시지 기반으로 태스크 분류
- 커밋 메시지가 모호한 경우 ("fix", "update", "wip" 등):
  - GitHub API로 diff를 가져와 Gemini에게 분석 요청
  - 코드 변경의 목적을 자연어로 요약
- 같은 날/같은 프로젝트의 커밋을 그룹핑하여 일일 태스크로 집계
- Gemini 프롬프트: "이 프로젝트에서 오늘 수행된 커밋들을 분석하여 제목/작업설명/복잡도를 추출해줘"

**3단계: Notion Syncer**
- 커밋 로그 DB에 개별 커밋 기록
- 일일 태스크 DB에 집계된 태스크 기록
- SHA 기준 중복 방지

---

## Notion DB 설계

### DB 1: 커밋 로그 (Commit Log)

원시 커밋 데이터 보관용.

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| Title | Title | 커밋 메시지 |
| Project | Select | 저장소/프로젝트명 |
| Date | Date | 커밋 일시 |
| Author | Rich Text | 커밋 작성자 |
| Commit SHA | Rich Text | 커밋 해시 (중복 방지 키) |
| Files Changed | Rich Text | 변경된 파일 목록 |
| Branch | Select | 브랜치명 |

### DB 2: 일일 태스크 (Daily Tasks) — 핵심 DB

Gemini가 커밋들을 분석·집계하여 생성하는 프로젝트별 일일 업무 기록.
Notion 캘린더(작업일 기준), 보드(프로젝트 기준) 뷰와 연결.

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| 제목 | Title | 태스크 제목 (Gemini 요약) |
| 작업 설명 | Rich Text | 수행한 작업의 상세 설명 (Gemini 분석) |
| 작업일 | Date | 작업 수행 날짜 |
| 프로젝트 | Select | 프로젝트/저장소명 |
| 작업 복잡도 | Select | Gemini 추정치 (Low / Medium / High / Critical) |

### Notion 뷰 구성

- **캘린더 뷰:** 작업일 기준 — 날짜별 수행 태스크 시각화
- **보드 뷰:** 프로젝트 기준 — 프로젝트별 태스크 카드 분류

---

## 인증: HRMS OAuth2/OIDC

### 구성

- NextAuth.js Custom Provider로 HRMS OIDC 연동
- Discovery URL: `https://hrms.cudo.co.kr:9700/.well-known/openid-configuration`
- Grant Type: `authorization_code` (PKCE S256 지원)
- Scopes: `openid profile email department`
- 팝업 모드 로그인: `display=popup` 파라미터

### 세션 관리

- JWT 세션에 사용자 정보 저장 (name, email, department)
- Access Token 만료 1시간, Refresh Token으로 자동 갱신
- Refresh Token 만료 30일

### 엔드포인트

| 용도 | URL |
|------|-----|
| Authorization | `GET https://hrms.cudo.co.kr:9700/api/oauth/authorize` |
| Token | `POST https://hrms.cudo.co.kr:9700/api/oauth/token` |
| UserInfo | `GET https://hrms.cudo.co.kr:9700/api/oauth/userinfo` |
| Revoke | `POST https://hrms.cudo.co.kr:9700/api/oauth/revoke` |

---

## 스케줄러

### 폴링 전략

- **주기적 폴링:** node-cron으로 설정된 간격(기본 15분)마다 실행
- **수동 트리거:** UI의 "지금 동기화" 버튼 → `/api/sync` POST 호출
- **초기화:** Next.js `instrumentation.ts`에서 서버 시작 시 스케줄러 등록

### 폴링 사이클

```
1. 활성화된 저장소 목록 조회 (SQLite)
2. 각 저장소의 마지막 SHA 이후 새 커밋 수집 (GitHub API)
3. 커밋 로그 DB 동기화 (Notion API)
4. 일별/프로젝트별 커밋 그룹핑 (core/analyzer)
5. Gemini 분석 → 일일 태스크 생성 (Gemini API)
6. 일일 태스크 DB 동기화 (Notion API)
7. 마지막 SHA 업데이트 (SQLite)
```

---

## UI 화면 구성

### 1. 대시보드 (`/`)
- 등록된 저장소 목록과 상태
- 최근 동기화 시각
- 오늘의 태스크 요약 카드

### 2. 저장소 관리 (`/repos`)
- GitHub 저장소 URL 입력하여 등록
- 저장소별 폴링 활성/비활성 토글
- 마지막 동기화 시각, 처리된 커밋 수 표시

### 3. 일일 태스크 (`/tasks`)
- Notion 일일 태스크 DB의 데이터를 테이블 뷰로 표시
- 프로젝트별, 날짜별 필터링
- 개별 태스크 클릭 시 상세 보기

### 4. 캘린더 (`/calendar`)
- 날짜별 수행 태스크를 캘린더 형태로 시각화
- 날짜 클릭 시 해당 일의 태스크 목록 표시

### 5. 설정 (`/settings`)
- 폴링 주기 설정
- API 키 관리 (GitHub, Notion, Gemini)
- Notion DB ID 설정

---

## SQLite 스키마

```sql
-- 등록된 저장소
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  last_synced_sha TEXT,
  is_active INTEGER DEFAULT 1,
  polling_interval_min INTEGER DEFAULT 15,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner, repo)
);

-- 동기화 로그
CREATE TABLE sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER REFERENCES repositories(id),
  status TEXT NOT NULL, -- 'success' | 'error'
  commits_processed INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

---

## 배포

- 팀 내 서버에 Node.js 환경으로 직접 배포
- `npm run build && npm start`로 실행
- 환경 변수: `.env` 파일로 관리
  - `GITHUB_TOKEN`, `NOTION_API_KEY`, `GEMINI_API_KEY`
  - `AUTH_HRMS_ID`, `AUTH_HRMS_SECRET`, `AUTH_HRMS_ISSUER`
  - `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

---

## 검증 계획

1. **단위 테스트:** `core/` 레이어의 커밋 그룹핑, 태스크 추출 로직
2. **통합 테스트:** GitHub API → Gemini 분석 → Notion 동기화 파이프라인
3. **E2E 테스트:**
   - 저장소 등록 → 수동 동기화 → Notion DB에 데이터 생성 확인
   - 스케줄러 동작 확인 (폴링 주기에 따라 새 커밋 감지)
   - Notion 캘린더/보드 뷰에서 데이터 확인
4. **인증 테스트:** HRMS OAuth2 로그인 → 세션 유지 → 토큰 갱신

---

## Harness Engineering 적용

- **AGENTS.md:** 프로젝트 컨텍스트 맵, 레이어 규칙, 주요 진입점 기술
- **docs/ 디렉토리:** API 스펙, 아키텍처 결정 기록, 운영 가이드
- **레이어 규칙:** `core/`에 외부 import 없는지 린트/구조 테스트로 검증
- **구조화된 문서가 코드의 시스템 오브 레코드:** 코드보다 docs/를 먼저 업데이트
