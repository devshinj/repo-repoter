# Repo Task Tracker

## Architecture

Next.js 16 App Router 모놀리스. 4개 레이어:

1. `src/app/` — UI + API Routes. 라우팅과 요청 처리만 담당
2. `src/core/` — 순수 비즈니스 로직. 외부 import 금지 (infra/ 참조 불가)
3. `src/infra/` — 외부 서비스 클라이언트 (GitHub, Gemini, Notion, SQLite)
4. `src/scheduler/` — 폴링 스케줄러 (core + infra 조합)

## Layer Rules

- app/ → core/ ✅, app/ → infra/ ✅
- core/ → infra/ ❌ (core는 순수 함수만)
- scheduler/ → core/ ✅, scheduler/ → infra/ ✅

## Key Entry Points

- `instrumentation.ts` — 서버 시작 시 스케줄러 초기화
- `src/lib/auth.ts` — HRMS OIDC 인증 설정
- `src/scheduler/polling-manager.ts` — 폴링 파이프라인 오케스트레이션

## Components

- `src/components/ui/` — 공통 베이스 UI 컴포넌트 (Button, Card, Input 등)
- `src/components/layout/` — 레이아웃 컴포넌트 (Sidebar, Header)
- `src/components/data-display/` — 데이터 표시 컴포넌트 (StatCard, StatusIndicator)

## Testing

- `vitest` 사용
- `src/__tests__/` 에 테스트 파일
- core/ 레이어는 100% 단위 테스트 커버리지 목표

## External APIs

- GitHub REST API: 커밋 수집, diff 조회
- Gemini (@google/genai): 커밋 분석, 태스크 요약
- Notion API: 커밋 로그 DB + 일일 태스크 DB 페이지 CRUD
- HRMS OAuth2: 팀 인증 (OIDC Discovery)
