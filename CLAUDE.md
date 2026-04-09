# CLAUDE.md — Git-Notion Task Tracker

## Project Overview

Git 커밋을 자동 수집하고 Gemini AI로 분석하여 Notion DB에 프로젝트별 일일 업무 기록을 생성하는 Next.js 풀스택 서비스.

## Development Methodology

**OpenAI Harness Engineering** 방법론을 따른다.

- 사람은 코드를 직접 작성하지 않는다. 에이전트가 코드를 생성하고, 사람은 환경·의도·피드백을 설계한다.
- `AGENTS.md`는 에이전트가 참조하는 컨텍스트 맵이다. 코드보다 문서를 먼저 업데이트한다.
- `docs/`가 시스템 오브 레코드다. 아키텍처 결정, 스펙, 계획은 모두 여기에 기록한다.
- 레이어 간 의존 규칙을 구조 테스트로 강제한다.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript (strict mode)
- **UI:** Tailwind CSS + shadcn/ui
- **Database:** SQLite (better-sqlite3) — 폴링 상태 추적용
- **Auth:** Auth.js v5 — HRMS OAuth2/OIDC Provider
- **External APIs:** GitHub REST (@octokit/rest), Gemini (@google/genai), Notion (@notionhq/client v5)
- **Scheduler:** node-cron — instrumentation.ts에서 초기화
- **Testing:** Vitest

## Architecture Rules

### Layer Dependency (단방향만 허용)

```
app/ → core/ ✅    app/ → infra/ ✅
core/ → infra/ ❌   core/는 순수 함수만 (외부 import 금지)
scheduler/ → core/ ✅   scheduler/ → infra/ ✅
```

### Directory Structure

```
src/
├── app/          # Next.js App Router — UI pages + API routes만
├── components/   # shadcn/ui 기반 공통 컴포넌트
│   ├── ui/       # shadcn/ui CLI로 생성된 기본 컴포넌트
│   ├── layout/   # Sidebar, Header, PageContainer (커스텀)
│   └── data-display/  # StatCard, StatusIndicator, EmptyState (커스텀)
├── core/         # 순수 비즈니스 로직 — 외부 의존성 없음, 테스트 100% 목표
│   ├── analyzer/ # 커밋 그룹핑, 태스크 추출
│   ├── mapper/   # 데이터 변환
│   └── types.ts  # 공유 타입 정의
├── infra/        # 외부 서비스 클라이언트 — 교체 가능한 어댑터
│   ├── github/   # Octokit 래퍼
│   ├── gemini/   # Gemini API 래퍼
│   ├── notion/   # Notion API 래퍼
│   └── db/       # SQLite 스키마 + 접근 함수
├── scheduler/    # 폴링 스케줄러 (core + infra 조합)
└── lib/          # Auth.js 설정 등 유틸리티
```

### Component Strategy

- `src/components/ui/`의 기본 컴포넌트는 반드시 `npx shadcn@latest add <component>` 명령으로 생성한다. 직접 작성하지 않는다.
- shadcn/ui에 없는 컴포넌트(Spinner 등)만 커스텀 작성한다.
- `layout/`과 `data-display/`는 shadcn/ui 위에 조합하는 프로젝트 전용 컴포넌트다.

## Coding Standards

### TypeScript

- strict mode 필수
- `any` 타입 사용 최소화. Notion API 프로퍼티 빌더에서만 `as any` 허용 (API 타입 호환)
- 공유 타입은 `src/core/types.ts`에 정의. 중복 정의 금지

### Imports

- 항상 `@/` 경로 별칭 사용 (`@/core/types`, `@/infra/github/github-client`)
- 상대 경로 import 금지 (같은 디렉토리 내 제외)

### Naming

- 파일: kebab-case (`commit-grouper.ts`)
- 타입/인터페이스: PascalCase (`CommitRecord`, `DailyTask`)
- 함수: camelCase (`buildCommitRecords`, `isAmbiguousCommitMessage`)
- 상수: UPPER_SNAKE_CASE는 사용하지 않음. 일반 camelCase로 통일

### Testing

- core/ 레이어: 순수 단위 테스트 (mock 불필요)
- infra/ 레이어: 데이터 변환 함수만 단위 테스트 (API 호출은 테스트하지 않음)
- E2E: 저장소 등록 → 동기화 → Notion 확인 수동 테스트
- 테스트 파일 위치: `src/__tests__/` 하위에 레이어 구조 미러링

## Skills

이 프로젝트에는 4개의 스킬이 있다. 해당 도메인 작업 시 반드시 참조할 것:

| Skill | When to Use |
|-------|-------------|
| `git-commit-analyzer` | GitHub 커밋 수집, Gemini 분석, 커밋 그룹핑, 태스크 추출 작업 시 |
| `notion-db-sync` | Notion DB 페이지 CRUD, 프로퍼티 빌딩, 중복 방지 로직 작업 시 |
| `nextjs-polling-service` | 폴링 스케줄러, instrumentation.ts, 파이프라인 오케스트레이션 작업 시 |
| `frontend-design` | UI 컴포넌트, 페이지, 인터페이스 구현 시 — 독창적이고 프로덕션 수준의 디자인 |

## Key Documents

| Document | Purpose |
|----------|---------|
| `AGENTS.md` | 에이전트 컨텍스트 맵 — 아키텍처, 진입점, 레이어 규칙 |
| `docs/superpowers/specs/2026-04-09-git-notion-task-tracker-design.md` | 설계 스펙 |
| `docs/superpowers/plans/2026-04-09-git-notion-task-tracker.md` | 구현 계획 (18 tasks) |

## Environment Variables

```
GITHUB_TOKEN          # GitHub Personal Access Token
NOTION_API_KEY        # Notion Integration API Key
NOTION_COMMIT_DB_ID   # Notion 커밋 로그 DB ID
NOTION_TASK_DB_ID     # Notion 일일 태스크 DB ID
GEMINI_API_KEY        # Google Gemini API Key
AUTH_HRMS_ID          # HRMS OAuth2 Client ID
AUTH_HRMS_SECRET      # HRMS OAuth2 Client Secret
AUTH_HRMS_ISSUER      # HRMS OIDC Issuer URL
AUTH_SECRET           # NextAuth.js Secret
AUTH_URL              # NextAuth.js Base URL
```

## Deployment

- 팀 내 서버에 Node.js 프로세스로 배포
- `npm run build && npm start`
- node-cron 스케줄러가 서버 프로세스 내에서 동작하므로 서버가 항상 실행 중이어야 함
- SQLite DB 파일은 `data/tracker.db`에 저장됨 (gitignore 대상)

## Git Workflow

- 태스크 단위로 빈번하게 커밋
- 커밋 메시지 형식: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:` prefix 사용
- main 브랜치에서 직접 작업 (팀 내 프로토타입 단계)
