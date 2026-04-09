# Repo Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git 커밋을 자동 수집·분석하여 Notion DB에 프로젝트별 일일 업무 기록을 생성하는 Next.js 풀스택 서비스

**Architecture:** Next.js App Router 모놀리스. UI + API Routes + node-cron 스케줄러가 단일 프로젝트에 공존. core/(순수 로직) → infra/(외부 API) 레이어 분리. SQLite로 폴링 상태 추적, Notion에 최종 데이터 저장.

**Tech Stack:** Next.js 16, TypeScript, Auth.js v5 (HRMS OIDC), @octokit/rest, @notionhq/client v5, @google/genai, better-sqlite3, node-cron, Tailwind CSS + shadcn/ui

**Skills:** 구현 시 아래 프로젝트 스킬을 참조하여 도메인 컨텍스트를 확보할 것:
- `git-commit-analyzer` — Git 커밋 수집/분석 파이프라인 가이드
- `notion-db-sync` — Notion DB 동기화 패턴 가이드
- `nextjs-polling-service` — Next.js 백그라운드 폴링 서비스 가이드

---

## File Structure

```
agent-prototype-02/
├── AGENTS.md                           # Harness Engineering 에이전트 컨텍스트 맵
├── .env.local                          # 환경 변수 (로컬)
├── next.config.ts                      # Next.js 설정
├── components.json                     # shadcn/ui 설정
├── tsconfig.json
├── package.json
├── instrumentation.ts                  # 서버 시작 시 스케줄러 초기화
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-04-09-git-notion-task-tracker-design.md
│       └── plans/
│           └── 2026-04-09-git-notion-task-tracker.md
├── .claude/
│   └── skills/
│       ├── git-commit-analyzer/SKILL.md
│       ├── notion-db-sync/SKILL.md
│       └── nextjs-polling-service/SKILL.md
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # 루트 레이아웃 (AuthProvider 래핑)
│   │   ├── globals.css                 # Tailwind 글로벌 스타일
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx            # 로그인 페이지
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx              # 대시보드 레이아웃 (사이드바 + 헤더)
│   │   │   ├── page.tsx                # 대시보드 홈
│   │   │   ├── repos/
│   │   │   │   └── page.tsx            # 저장소 관리
│   │   │   ├── tasks/
│   │   │   │   └── page.tsx            # 일일 태스크 목록
│   │   │   ├── calendar/
│   │   │   │   └── page.tsx            # 캘린더 뷰
│   │   │   └── settings/
│   │   │       └── page.tsx            # 설정
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       │   └── route.ts            # Auth.js 핸들러
│   │       ├── repos/
│   │       │   └── route.ts            # 저장소 CRUD
│   │       ├── sync/
│   │       │   └── route.ts            # 수동 동기화 트리거
│   │       ├── tasks/
│   │       │   └── route.ts            # 태스크 조회
│   │       └── cron/
│   │           └── route.ts            # 스케줄러 상태
│   ├── components/                     # shadcn/ui 기반 컴포넌트 (Harness Engineering)
│   │   ├── ui/                         # shadcn/ui CLI로 생성 (button, card, input, badge, table, dialog, toast 등)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx             # 사이드바 네비게이션 (커스텀)
│   │   │   ├── header.tsx              # 페이지 헤더 (커스텀)
│   │   │   └── page-container.tsx      # 페이지 컨테이너 래퍼 (커스텀)
│   │   └── data-display/
│   │       ├── stat-card.tsx           # 통계 카드 — shadcn Card 기반 (커스텀)
│   │       ├── status-indicator.tsx    # 상태 표시 — shadcn Badge 기반 (커스텀)
│   │       └── empty-state.tsx         # 빈 상태 표시 (커스텀)
│   ├── core/
│   │   ├── analyzer/
│   │   │   ├── commit-grouper.ts       # 날짜/프로젝트별 커밋 그룹핑
│   │   │   └── task-extractor.ts       # Gemini 분석 결과 파싱 → 태스크 모델
│   │   ├── mapper/
│   │   │   ├── commit-mapper.ts        # GitHub 커밋 → CommitRecord
│   │   │   └── notion-mapper.ts        # CommitRecord/DailyTask → Notion 프로퍼티
│   │   └── types.ts                    # 공유 타입 정의
│   ├── infra/
│   │   ├── github/
│   │   │   └── github-client.ts        # Octokit 래퍼 (커밋 수집, diff 조회)
│   │   ├── gemini/
│   │   │   └── gemini-client.ts        # Gemini API 래퍼 (커밋 분석)
│   │   ├── notion/
│   │   │   └── notion-client.ts        # Notion API 래퍼 (DB 생성, 페이지 CRUD)
│   │   └── db/
│   │       ├── schema.ts              # SQLite 테이블 생성
│   │       └── repository.ts          # 저장소/로그 DB 접근 함수
│   ├── scheduler/
│   │   └── polling-manager.ts          # node-cron 기반 폴링 스케줄러
│   ├── lib/
│   │   └── auth.ts                     # Auth.js 설정 (HRMS OIDC Provider)
│   └── __tests__/
│       ├── core/
│       │   ├── commit-grouper.test.ts
│       │   ├── task-extractor.test.ts
│       │   ├── commit-mapper.test.ts
│       │   └── notion-mapper.test.ts
│       ├── infra/
│       │   ├── github-client.test.ts
│       │   ├── gemini-client.test.ts
│       │   └── notion-client.test.ts
│       └── scheduler/
│           └── polling-manager.test.ts
└── data/                               # SQLite DB 파일 (gitignore)
    └── tracker.db
```

---

## Task 1: 프로젝트 초기화 & Harness Engineering 기반 구조

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
- Create: `src/app/layout.tsx`, `src/app/globals.css`
- Create: `.env.local`, `.gitignore`, `AGENTS.md`

- [ ] **Step 1: Next.js 프로젝트 생성**

```bash
cd c:/Users/devsh/Desktop/Study/agent-prototype-02
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Expected: Next.js 16 프로젝트 스캐폴딩 완료

- [ ] **Step 2: shadcn/ui 초기화**

```bash
npx shadcn@latest init
```

프롬프트 응답:
- Style: Default
- Base color: Slate
- CSS variables: Yes

이후 필요한 shadcn/ui 컴포넌트 설치:

```bash
npx shadcn@latest add button card input badge table dialog toast select separator dropdown-menu calendar sonner
```

- [ ] **Step 3: 핵심 의존성 설치**

```bash
npm install @octokit/rest @notionhq/client @google/genai better-sqlite3 node-cron next-auth@beta
npm install -D @types/better-sqlite3 @types/node-cron vitest @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: .env.local 생성**

```env
# GitHub
GITHUB_TOKEN=github_pat_XXXX

# Notion
NOTION_API_KEY=ntn_XXXX
NOTION_COMMIT_DB_ID=
NOTION_TASK_DB_ID=

# Gemini
GEMINI_API_KEY=

# HRMS OAuth2
AUTH_HRMS_ID=
AUTH_HRMS_SECRET=
AUTH_HRMS_ISSUER=https://hrms.cudo.co.kr:9700

# NextAuth
AUTH_SECRET=
AUTH_URL=http://localhost:3000
```

- [ ] **Step 4: .gitignore 업데이트**

아래 항목을 .gitignore에 추가:

```
# SQLite
data/*.db
data/*.db-journal

# Environment
.env.local
.env*.local
```

- [ ] **Step 5: AGENTS.md 생성**

```markdown
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
```

- [ ] **Step 6: vitest 설정**

Create: `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

`package.json`의 scripts에 추가:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Harness Engineering 디렉토리 구조 생성**

```bash
mkdir -p src/core/analyzer src/core/mapper
mkdir -p src/infra/github src/infra/gemini src/infra/notion src/infra/db
mkdir -p src/scheduler
mkdir -p src/lib
mkdir -p src/components/layout src/components/data-display
mkdir -p src/__tests__/core src/__tests__/infra src/__tests__/scheduler
mkdir -p data
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: initialize Next.js project with Harness Engineering structure"
```

---

## Task 2: 공유 타입 정의

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: 공유 타입 파일 작성**

```typescript
// src/core/types.ts

/** GitHub에서 수집한 커밋 원시 데이터 */
export interface CommitRecord {
  sha: string;
  message: string;
  author: string;
  date: string; // ISO 8601
  repoOwner: string;
  repoName: string;
  branch: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
}

/** Gemini 분석을 거친 일일 태스크 */
export interface DailyTask {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  project: string;
  complexity: "Low" | "Medium" | "High" | "Critical";
  commitShas: string[];
}

/** 등록된 저장소 정보 */
export interface Repository {
  id: number;
  owner: string;
  repo: string;
  branch: string;
  lastSyncedSha: string | null;
  isActive: boolean;
  pollingIntervalMin: number;
  createdAt: string;
  updatedAt: string;
}

/** 동기화 로그 */
export interface SyncLog {
  id: number;
  repositoryId: number;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** Gemini 분석 요청 페이로드 */
export interface AnalysisRequest {
  commits: CommitRecord[];
  project: string;
  date: string;
}

/** 폴링 스케줄러 상태 */
export interface SchedulerStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  intervalMin: number;
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/core/types.ts
git commit -m "feat: define shared type definitions for core domain"
```

---

## Task 3: 공통 베이스 UI 컴포넌트 — shadcn/ui 기반 (Harness Engineering 공통 컴포넌트화)

> **Note:** `src/components/ui/` 디렉토리의 기본 컴포넌트(button, card, input, badge, table, dialog, toast, select 등)는 Task 1 Step 2에서 `npx shadcn@latest add` 명령으로 이미 생성됨. 이 태스크에서는 shadcn/ui 위에 **프로젝트 전용 커스텀 컴포넌트**만 작성.

**Files:**
- Already generated by shadcn: `src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `badge.tsx`, `table.tsx`, `dialog.tsx`, `toast.tsx`, `select.tsx`, `calendar.tsx`, `separator.tsx`, `dropdown-menu.tsx`, `sonner.tsx`
- Create: `src/components/ui/spinner.tsx` (shadcn에 없는 컴포넌트)
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/header.tsx`
- Create: `src/components/layout/page-container.tsx`
- Create: `src/components/data-display/stat-card.tsx`
- Create: `src/components/data-display/status-indicator.tsx`
- Create: `src/components/data-display/empty-state.tsx`

- [ ] **Step 1: Spinner 컴포넌트 (shadcn에 없는 유일한 커스텀 UI 컴포넌트)**

```tsx
// src/components/ui/spinner.tsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-8 w-8" };

export function Spinner({ size = "md", className }: SpinnerProps) {
  return <Loader2 className={cn("animate-spin text-muted-foreground", sizeMap[size], className)} />;
}
```

- [ ] **Step 2: Sidebar 레이아웃 컴포넌트**

```tsx
// src/components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, GitFork, CheckSquare, CalendarDays, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/repos", label: "저장소 관리", icon: GitFork },
  { href: "/tasks", label: "일일 태스크", icon: CheckSquare },
  { href: "/calendar", label: "캘린더", icon: CalendarDays },
  { href: "/settings", label: "설정", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-60 border-r bg-card flex flex-col">
      <div className="p-5">
        <h1 className="text-lg font-bold">Git-Notion Tracker</h1>
      </div>
      <Separator />
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              variant={isActive ? "secondary" : "ghost"}
              className={cn("w-full justify-start gap-3", isActive && "bg-accent")}
              asChild
            >
              <Link href={item.href}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Header & PageContainer 레이아웃 컴포넌트**

```tsx
// src/components/layout/header.tsx
interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
```

```tsx
// src/components/layout/page-container.tsx
import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return <div className={cn("ml-60 min-h-screen bg-background p-8", className)}>{children}</div>;
}
```

- [ ] **Step 4: 데이터 표시 컴포넌트 (StatCard, StatusIndicator, EmptyState)**

```tsx
// src/components/data-display/stat-card.tsx
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
}

export function StatCard({ label, value, description }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold mt-1">{value}</p>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
```

```tsx
// src/components/data-display/status-indicator.tsx
import { Badge } from "@/components/ui/badge";

type Status = "success" | "error" | "running" | "idle";

interface StatusIndicatorProps {
  status: Status;
  label?: string;
}

const statusConfig: Record<Status, { variant: "default" | "secondary" | "destructive" | "outline"; text: string }> = {
  success: { variant: "default", text: "성공" },
  error: { variant: "destructive", text: "에러" },
  running: { variant: "secondary", text: "실행 중" },
  idle: { variant: "outline", text: "대기" },
};

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const config = statusConfig[status];
  return <Badge variant={config.variant}>{label || config.text}</Badge>;
}
```

```tsx
// src/components/data-display/empty-state.tsx
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/
git commit -m "feat: add custom layout and data-display components on top of shadcn/ui"
```

---

---

## Task 4: SQLite 데이터베이스 레이어

**Files:**
- Create: `src/infra/db/schema.ts`
- Create: `src/infra/db/repository.ts`
- Test: `src/__tests__/infra/db-repository.test.ts`

- [ ] **Step 1: 테스트 작성 (repository)**

```typescript
// src/__tests__/infra/db-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertRepository,
  getActiveRepositories,
  updateLastSyncedSha,
  getRepositoryByOwnerRepo,
  deleteRepository,
  insertSyncLog,
  getRecentSyncLogs,
} from "@/infra/db/repository";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  createTables(db);
});

afterEach(() => {
  db.close();
});

describe("repository CRUD", () => {
  it("inserts and retrieves a repository", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repos = getActiveRepositories(db);
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("devshinj");
    expect(repos[0].repo).toBe("my-app");
    expect(repos[0].isActive).toBe(1);
  });

  it("updates last synced SHA", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    updateLastSyncedSha(db, repo!.id, "abc123");
    const updated = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    expect(updated!.lastSyncedSha).toBe("abc123");
  });

  it("deletes a repository", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    deleteRepository(db, repo!.id);
    expect(getActiveRepositories(db)).toHaveLength(0);
  });
});

describe("sync logs", () => {
  it("inserts and retrieves sync logs", () => {
    insertRepository(db, { owner: "devshinj", repo: "my-app", branch: "main" });
    const repo = getRepositoryByOwnerRepo(db, "devshinj", "my-app");
    insertSyncLog(db, {
      repositoryId: repo!.id,
      status: "success",
      commitsProcessed: 5,
      tasksCreated: 2,
      errorMessage: null,
    });
    const logs = getRecentSyncLogs(db, repo!.id, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].commitsProcessed).toBe(5);
    expect(logs[0].status).toBe("success");
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

```bash
npx vitest run src/__tests__/infra/db-repository.test.ts
```

Expected: FAIL — 모듈이 아직 없음

- [ ] **Step 3: schema.ts 구현**

```typescript
// src/infra/db/schema.ts
import Database from "better-sqlite3";

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      last_synced_sha TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      polling_interval_min INTEGER NOT NULL DEFAULT 15,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner, repo)
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      commits_processed INTEGER NOT NULL DEFAULT 0,
      tasks_created INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}
```

- [ ] **Step 4: repository.ts 구현**

```typescript
// src/infra/db/repository.ts
import Database from "better-sqlite3";

interface InsertRepoInput {
  owner: string;
  repo: string;
  branch: string;
}

interface InsertSyncLogInput {
  repositoryId: number;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
}

export function insertRepository(db: Database.Database, input: InsertRepoInput): void {
  db.prepare(
    "INSERT INTO repositories (owner, repo, branch) VALUES (?, ?, ?)"
  ).run(input.owner, input.repo, input.branch);
}

export function getActiveRepositories(db: Database.Database) {
  return db.prepare("SELECT * FROM repositories WHERE is_active = 1").all() as any[];
}

export function getRepositoryByOwnerRepo(db: Database.Database, owner: string, repo: string) {
  return db.prepare("SELECT * FROM repositories WHERE owner = ? AND repo = ?").get(owner, repo) as any | undefined;
}

export function getRepositoryById(db: Database.Database, id: number) {
  return db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as any | undefined;
}

export function updateLastSyncedSha(db: Database.Database, id: number, sha: string): void {
  db.prepare(
    "UPDATE repositories SET last_synced_sha = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(sha, id);
}

export function deleteRepository(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
}

export function toggleRepository(db: Database.Database, id: number, isActive: boolean): void {
  db.prepare(
    "UPDATE repositories SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(isActive ? 1 : 0, id);
}

export function insertSyncLog(db: Database.Database, input: InsertSyncLogInput): void {
  db.prepare(
    "INSERT INTO sync_logs (repository_id, status, commits_processed, tasks_created, error_message, completed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(input.repositoryId, input.status, input.commitsProcessed, input.tasksCreated, input.errorMessage);
}

export function getRecentSyncLogs(db: Database.Database, repositoryId: number, limit: number) {
  return db.prepare(
    "SELECT * FROM sync_logs WHERE repository_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(repositoryId, limit) as any[];
}
```

- [ ] **Step 5: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/infra/db-repository.test.ts
```

Expected: ALL PASS

- [ ] **Step 6: 커밋**

```bash
git add src/infra/db/ src/__tests__/infra/db-repository.test.ts
git commit -m "feat: implement SQLite schema and repository data access layer"
```

---

## Task 5: GitHub 클라이언트

> **Skill:** `git-commit-analyzer` 스킬 참조 — Stage 1 (Commit Collection) 섹션

**Files:**
- Create: `src/infra/github/github-client.ts`
- Test: `src/__tests__/infra/github-client.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/__tests__/infra/github-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseCommits, buildCommitRecords } from "@/infra/github/github-client";

describe("parseCommits", () => {
  it("extracts commit records from GitHub API response", () => {
    const apiResponse = [
      {
        sha: "abc123",
        commit: {
          message: "feat: add login page",
          author: { name: "JAESEOK", date: "2026-04-09T10:00:00Z" },
        },
        files: [
          { filename: "src/app/login/page.tsx", additions: 50, deletions: 0 },
          { filename: "src/lib/auth.ts", additions: 20, deletions: 5 },
        ],
      },
    ];

    const records = buildCommitRecords(apiResponse, "devshinj", "my-app", "main");
    expect(records).toHaveLength(1);
    expect(records[0].sha).toBe("abc123");
    expect(records[0].message).toBe("feat: add login page");
    expect(records[0].author).toBe("JAESEOK");
    expect(records[0].filesChanged).toEqual(["src/app/login/page.tsx", "src/lib/auth.ts"]);
    expect(records[0].additions).toBe(70);
    expect(records[0].deletions).toBe(5);
  });

  it("handles commits with no files array", () => {
    const apiResponse = [
      {
        sha: "def456",
        commit: {
          message: "initial commit",
          author: { name: "JAESEOK", date: "2026-04-09T09:00:00Z" },
        },
      },
    ];

    const records = buildCommitRecords(apiResponse, "devshinj", "my-app", "main");
    expect(records[0].filesChanged).toEqual([]);
    expect(records[0].additions).toBe(0);
    expect(records[0].deletions).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

```bash
npx vitest run src/__tests__/infra/github-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: github-client.ts 구현**

```typescript
// src/infra/github/github-client.ts
import { Octokit } from "@octokit/rest";
import type { CommitRecord } from "@/core/types";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

export async function fetchCommitsSince(
  owner: string,
  repo: string,
  branch: string,
  sinceSha: string | null
): Promise<CommitRecord[]> {
  const client = getOctokit();

  const params: Parameters<typeof client.rest.repos.listCommits>[0] = {
    owner,
    repo,
    sha: branch,
    per_page: 100,
  };

  const { data: commits } = await client.rest.repos.listCommits(params);

  // sinceSha 이후의 커밋만 필터링
  let filtered = commits;
  if (sinceSha) {
    const idx = commits.findIndex((c) => c.sha === sinceSha);
    filtered = idx === -1 ? commits : commits.slice(0, idx);
  }

  // 각 커밋의 상세 정보 (파일 목록) 가져오기
  const detailed = await Promise.all(
    filtered.map(async (c) => {
      const { data } = await client.rest.repos.getCommit({ owner, repo, ref: c.sha });
      return data;
    })
  );

  return buildCommitRecords(detailed, owner, repo, branch);
}

export function buildCommitRecords(
  apiCommits: any[],
  owner: string,
  repo: string,
  branch: string
): CommitRecord[] {
  return apiCommits.map((c) => {
    const files = c.files || [];
    return {
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || "unknown",
      date: c.commit.author?.date || new Date().toISOString(),
      repoOwner: owner,
      repoName: repo,
      branch,
      filesChanged: files.map((f: any) => f.filename),
      additions: files.reduce((sum: number, f: any) => sum + (f.additions || 0), 0),
      deletions: files.reduce((sum: number, f: any) => sum + (f.deletions || 0), 0),
    };
  });
}

export async function fetchCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
  const client = getOctokit();
  const { data } = await client.rest.repos.getCommit({
    owner,
    repo,
    ref: sha,
    mediaType: { format: "diff" },
  });
  return data as unknown as string;
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/infra/github-client.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/github/ src/__tests__/infra/github-client.test.ts
git commit -m "feat: implement GitHub client for commit collection and diff retrieval"
```

---

## Task 6: Gemini 클라이언트

> **Skill:** `git-commit-analyzer` 스킬 참조 — Stage 2 (Gemini Analysis) 섹션

**Files:**
- Create: `src/infra/gemini/gemini-client.ts`
- Test: `src/__tests__/infra/gemini-client.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/__tests__/infra/gemini-client.test.ts
import { describe, it, expect } from "vitest";
import { buildAnalysisPrompt, parseAnalysisResponse } from "@/infra/gemini/gemini-client";
import type { CommitRecord } from "@/core/types";

const sampleCommits: CommitRecord[] = [
  {
    sha: "abc123",
    message: "feat: add user login page",
    author: "JAESEOK",
    date: "2026-04-09T10:00:00Z",
    repoOwner: "devshinj",
    repoName: "my-app",
    branch: "main",
    filesChanged: ["src/app/login/page.tsx", "src/lib/auth.ts"],
    additions: 70,
    deletions: 5,
  },
  {
    sha: "def456",
    message: "fix: resolve auth redirect bug",
    author: "JAESEOK",
    date: "2026-04-09T14:00:00Z",
    repoOwner: "devshinj",
    repoName: "my-app",
    branch: "main",
    filesChanged: ["src/lib/auth.ts"],
    additions: 10,
    deletions: 3,
  },
];

describe("buildAnalysisPrompt", () => {
  it("builds a structured prompt for Gemini", () => {
    const prompt = buildAnalysisPrompt(sampleCommits, "my-app", "2026-04-09");
    expect(prompt).toContain("my-app");
    expect(prompt).toContain("2026-04-09");
    expect(prompt).toContain("feat: add user login page");
    expect(prompt).toContain("fix: resolve auth redirect bug");
    expect(prompt).toContain("JSON");
  });
});

describe("parseAnalysisResponse", () => {
  it("parses valid Gemini JSON response", () => {
    const response = JSON.stringify({
      tasks: [
        {
          title: "사용자 인증 시스템 구현",
          description: "로그인 페이지를 추가하고 인증 리다이렉트 버그를 수정함",
          complexity: "Medium",
        },
      ],
    });

    const tasks = parseAnalysisResponse(response, "my-app", "2026-04-09", ["abc123", "def456"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("사용자 인증 시스템 구현");
    expect(tasks[0].project).toBe("my-app");
    expect(tasks[0].date).toBe("2026-04-09");
    expect(tasks[0].complexity).toBe("Medium");
    expect(tasks[0].commitShas).toEqual(["abc123", "def456"]);
  });

  it("handles response with markdown code fences", () => {
    const response = '```json\n{"tasks":[{"title":"테스트","description":"설명","complexity":"Low"}]}\n```';
    const tasks = parseAnalysisResponse(response, "my-app", "2026-04-09", ["abc123"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("테스트");
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

```bash
npx vitest run src/__tests__/infra/gemini-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: gemini-client.ts 구현**

```typescript
// src/infra/gemini/gemini-client.ts
import { GoogleGenAI } from "@google/genai";
import type { CommitRecord, DailyTask } from "@/core/types";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return client;
}

export function buildAnalysisPrompt(commits: CommitRecord[], project: string, date: string): string {
  const commitSummaries = commits.map((c) =>
    `- [${c.sha.slice(0, 7)}] ${c.message} (files: ${c.filesChanged.join(", ") || "none"}, +${c.additions}/-${c.deletions})`
  ).join("\n");

  return `프로젝트 "${project}"에서 ${date}에 수행된 커밋들을 분석하여 일일 업무 태스크로 정리해주세요.

커밋 목록:
${commitSummaries}

다음 JSON 형식으로 응답해주세요:
{
  "tasks": [
    {
      "title": "태스크 제목 (한 줄 요약)",
      "description": "수행한 작업의 상세 설명 (2-3문장)",
      "complexity": "Low | Medium | High | Critical"
    }
  ]
}

규칙:
- 관련된 커밋들은 하나의 태스크로 묶어주세요
- 복잡도는 변경 규모와 난이도를 고려하여 추정해주세요
- 제목과 설명은 한국어로 작성해주세요
- JSON만 응답해주세요`;
}

export function parseAnalysisResponse(
  response: string,
  project: string,
  date: string,
  commitShas: string[]
): DailyTask[] {
  // Markdown code fence 제거
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  const validComplexities = ["Low", "Medium", "High", "Critical"];

  return parsed.tasks.map((t: any) => ({
    title: t.title,
    description: t.description,
    date,
    project,
    complexity: validComplexities.includes(t.complexity) ? t.complexity : "Medium",
    commitShas,
  }));
}

export async function analyzeCommits(
  commits: CommitRecord[],
  project: string,
  date: string
): Promise<DailyTask[]> {
  const genai = getClient();
  const prompt = buildAnalysisPrompt(commits, project, date);

  const result = await genai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
  });

  const text = result.text || "";
  const shas = commits.map((c) => c.sha);
  return parseAnalysisResponse(text, project, date, shas);
}

export async function analyzeCommitWithDiff(
  commit: CommitRecord,
  diff: string
): Promise<string> {
  const genai = getClient();

  const prompt = `다음 Git 커밋의 코드 변경을 분석하여, 이 커밋이 무엇을 했는지 한 줄로 요약해주세요.

커밋 메시지: ${commit.message}
변경된 파일: ${commit.filesChanged.join(", ")}

Diff (일부):
${diff.slice(0, 3000)}

한국어로 한 줄 요약만 응답해주세요.`;

  const result = await genai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
  });

  return result.text || commit.message;
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/infra/gemini-client.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/gemini/ src/__tests__/infra/gemini-client.test.ts
git commit -m "feat: implement Gemini client for commit analysis and task extraction"
```

---

## Task 7: Notion 클라이언트

> **Skill:** `notion-db-sync` 스킬 참조 — Two-Database Design, Property Building, Duplicate Prevention 섹션

**Files:**
- Create: `src/infra/notion/notion-client.ts`
- Test: `src/__tests__/infra/notion-client.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/__tests__/infra/notion-client.test.ts
import { describe, it, expect } from "vitest";
import { buildCommitLogProperties, buildDailyTaskProperties } from "@/infra/notion/notion-client";
import type { CommitRecord, DailyTask } from "@/core/types";

describe("buildCommitLogProperties", () => {
  it("maps CommitRecord to Notion properties", () => {
    const commit: CommitRecord = {
      sha: "abc123def",
      message: "feat: add login page",
      author: "JAESEOK",
      date: "2026-04-09T10:00:00Z",
      repoOwner: "devshinj",
      repoName: "my-app",
      branch: "main",
      filesChanged: ["src/app/login/page.tsx", "src/lib/auth.ts"],
      additions: 70,
      deletions: 5,
    };

    const props = buildCommitLogProperties(commit);
    expect(props.Title.title[0].text.content).toBe("feat: add login page");
    expect(props.Project.select.name).toBe("my-app");
    expect(props.Date.date.start).toBe("2026-04-09T10:00:00Z");
    expect(props.Author.rich_text[0].text.content).toBe("JAESEOK");
    expect(props["Commit SHA"].rich_text[0].text.content).toBe("abc123def");
    expect(props.Branch.select.name).toBe("main");
  });
});

describe("buildDailyTaskProperties", () => {
  it("maps DailyTask to Notion properties", () => {
    const task: DailyTask = {
      title: "사용자 인증 시스템 구현",
      description: "로그인 페이지를 추가하고 리다이렉트 버그를 수정함",
      date: "2026-04-09",
      project: "my-app",
      complexity: "Medium",
      commitShas: ["abc123", "def456"],
    };

    const props = buildDailyTaskProperties(task);
    expect(props["제목"].title[0].text.content).toBe("사용자 인증 시스템 구현");
    expect(props["작업 설명"].rich_text[0].text.content).toBe("로그인 페이지를 추가하고 리다이렉트 버그를 수정함");
    expect(props["작업일"].date.start).toBe("2026-04-09");
    expect(props["프로젝트"].select.name).toBe("my-app");
    expect(props["작업 복잡도"].select.name).toBe("Medium");
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

```bash
npx vitest run src/__tests__/infra/notion-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: notion-client.ts 구현**

```typescript
// src/infra/notion/notion-client.ts
import { Client } from "@notionhq/client";
import type { CommitRecord, DailyTask } from "@/core/types";

let notionClient: Client | null = null;

function getClient(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

export function buildCommitLogProperties(commit: CommitRecord) {
  return {
    Title: { title: [{ text: { content: commit.message.slice(0, 100) } }] },
    Project: { select: { name: commit.repoName } },
    Date: { date: { start: commit.date } },
    Author: { rich_text: [{ text: { content: commit.author } }] },
    "Commit SHA": { rich_text: [{ text: { content: commit.sha } }] },
    "Files Changed": {
      rich_text: [{ text: { content: commit.filesChanged.join("\n").slice(0, 2000) } }],
    },
    Branch: { select: { name: commit.branch } },
  };
}

export function buildDailyTaskProperties(task: DailyTask) {
  return {
    "제목": { title: [{ text: { content: task.title } }] },
    "작업 설명": { rich_text: [{ text: { content: task.description.slice(0, 2000) } }] },
    "작업일": { date: { start: task.date } },
    "프로젝트": { select: { name: task.project } },
    "작업 복잡도": { select: { name: task.complexity } },
  };
}

export async function createCommitLogPage(commit: CommitRecord): Promise<string> {
  const client = getClient();
  const response = await client.pages.create({
    parent: { database_id: process.env.NOTION_COMMIT_DB_ID! },
    properties: buildCommitLogProperties(commit) as any,
  });
  return response.id;
}

export async function createDailyTaskPage(task: DailyTask): Promise<string> {
  const client = getClient();
  const response = await client.pages.create({
    parent: { database_id: process.env.NOTION_TASK_DB_ID! },
    properties: buildDailyTaskProperties(task) as any,
  });
  return response.id;
}

export async function isCommitAlreadySynced(sha: string): Promise<boolean> {
  const client = getClient();
  const response = await client.databases.query({
    database_id: process.env.NOTION_COMMIT_DB_ID!,
    filter: {
      property: "Commit SHA",
      rich_text: { equals: sha },
    },
  });
  return response.results.length > 0;
}

export async function isDailyTaskExists(project: string, date: string): Promise<string | null> {
  const client = getClient();
  const response = await client.databases.query({
    database_id: process.env.NOTION_TASK_DB_ID!,
    filter: {
      and: [
        { property: "프로젝트", select: { equals: project } },
        { property: "작업일", date: { equals: date } },
      ],
    },
  });
  return response.results.length > 0 ? response.results[0].id : null;
}

export async function updateDailyTaskPage(pageId: string, task: DailyTask): Promise<void> {
  const client = getClient();
  await client.pages.update({
    page_id: pageId,
    properties: buildDailyTaskProperties(task) as any,
  });
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/infra/notion-client.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/notion/ src/__tests__/infra/notion-client.test.ts
git commit -m "feat: implement Notion client for commit log and daily task DB operations"
```

---

## Task 8: Core 분석 로직 (Commit Grouper + Task Extractor)

> **Skill:** `git-commit-analyzer` 스킬 참조 — Stage 3 (Commit Grouping and Task Extraction) 섹션

**Files:**
- Create: `src/core/analyzer/commit-grouper.ts`
- Create: `src/core/analyzer/task-extractor.ts`
- Create: `src/core/mapper/commit-mapper.ts`
- Create: `src/core/mapper/notion-mapper.ts`
- Test: `src/__tests__/core/commit-grouper.test.ts`
- Test: `src/__tests__/core/task-extractor.test.ts`

- [ ] **Step 1: commit-grouper 테스트 작성**

```typescript
// src/__tests__/core/commit-grouper.test.ts
import { describe, it, expect } from "vitest";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import type { CommitRecord } from "@/core/types";

describe("groupCommitsByDateAndProject", () => {
  const commits: CommitRecord[] = [
    {
      sha: "a1", message: "feat: add login", author: "JAESEOK",
      date: "2026-04-09T10:00:00Z", repoOwner: "devshinj", repoName: "app-a",
      branch: "main", filesChanged: ["login.tsx"], additions: 50, deletions: 0,
    },
    {
      sha: "a2", message: "fix: auth bug", author: "JAESEOK",
      date: "2026-04-09T14:00:00Z", repoOwner: "devshinj", repoName: "app-a",
      branch: "main", filesChanged: ["auth.ts"], additions: 10, deletions: 3,
    },
    {
      sha: "b1", message: "docs: update readme", author: "JAESEOK",
      date: "2026-04-09T11:00:00Z", repoOwner: "devshinj", repoName: "app-b",
      branch: "main", filesChanged: ["README.md"], additions: 5, deletions: 2,
    },
    {
      sha: "a3", message: "refactor: cleanup", author: "JAESEOK",
      date: "2026-04-10T09:00:00Z", repoOwner: "devshinj", repoName: "app-a",
      branch: "main", filesChanged: ["utils.ts"], additions: 0, deletions: 20,
    },
  ];

  it("groups commits by date (YYYY-MM-DD) and project (repoName)", () => {
    const groups = groupCommitsByDateAndProject(commits);

    expect(groups).toHaveLength(3);

    const appA_apr9 = groups.find((g) => g.project === "app-a" && g.date === "2026-04-09");
    expect(appA_apr9).toBeDefined();
    expect(appA_apr9!.commits).toHaveLength(2);

    const appB_apr9 = groups.find((g) => g.project === "app-b" && g.date === "2026-04-09");
    expect(appB_apr9).toBeDefined();
    expect(appB_apr9!.commits).toHaveLength(1);

    const appA_apr10 = groups.find((g) => g.project === "app-a" && g.date === "2026-04-10");
    expect(appA_apr10).toBeDefined();
    expect(appA_apr10!.commits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

```bash
npx vitest run src/__tests__/core/commit-grouper.test.ts
```

Expected: FAIL

- [ ] **Step 3: commit-grouper.ts 구현**

```typescript
// src/core/analyzer/commit-grouper.ts
import type { CommitRecord } from "@/core/types";

export interface CommitGroup {
  project: string;
  date: string; // YYYY-MM-DD
  commits: CommitRecord[];
}

export function groupCommitsByDateAndProject(commits: CommitRecord[]): CommitGroup[] {
  const groupMap = new Map<string, CommitGroup>();

  for (const commit of commits) {
    const date = commit.date.split("T")[0]; // ISO → YYYY-MM-DD
    const key = `${commit.repoName}::${date}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, { project: commit.repoName, date, commits: [] });
    }
    groupMap.get(key)!.commits.push(commit);
  }

  return Array.from(groupMap.values());
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/core/commit-grouper.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: task-extractor 테스트 작성**

```typescript
// src/__tests__/core/task-extractor.test.ts
import { describe, it, expect } from "vitest";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";

describe("isAmbiguousCommitMessage", () => {
  it("detects ambiguous messages", () => {
    expect(isAmbiguousCommitMessage("fix")).toBe(true);
    expect(isAmbiguousCommitMessage("update")).toBe(true);
    expect(isAmbiguousCommitMessage("wip")).toBe(true);
    expect(isAmbiguousCommitMessage("test")).toBe(true);
    expect(isAmbiguousCommitMessage(".")).toBe(true);
    expect(isAmbiguousCommitMessage("minor changes")).toBe(true);
  });

  it("recognizes clear messages", () => {
    expect(isAmbiguousCommitMessage("feat: add user authentication with OAuth2")).toBe(false);
    expect(isAmbiguousCommitMessage("fix: resolve null pointer in login handler")).toBe(false);
    expect(isAmbiguousCommitMessage("refactor: extract database connection pool to separate module")).toBe(false);
  });
});
```

- [ ] **Step 6: task-extractor.ts 구현**

```typescript
// src/core/analyzer/task-extractor.ts
import type { CommitRecord, DailyTask } from "@/core/types";

const AMBIGUOUS_PATTERNS = [
  /^(fix|update|wip|test|refactor|change|modify|edit|tmp|temp|misc|cleanup|clean)$/i,
  /^\.+$/,
  /^(minor|small|quick)\s*(changes?|fix(es)?|update)?$/i,
  /^[a-f0-9]{7,}$/i, // SHA만 있는 경우
];

export function isAmbiguousCommitMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 10) return true;
  return AMBIGUOUS_PATTERNS.some((p) => p.test(trimmed));
}

export function getAmbiguousCommits(commits: CommitRecord[]): CommitRecord[] {
  return commits.filter((c) => isAmbiguousCommitMessage(c.message));
}

export function buildFallbackTask(commits: CommitRecord[], project: string, date: string): DailyTask {
  const messages = commits.map((c) => `- ${c.message}`).join("\n");
  const filesList = [...new Set(commits.flatMap((c) => c.filesChanged))];
  const totalAdditions = commits.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = commits.reduce((sum, c) => sum + c.deletions, 0);

  return {
    title: `${project} 작업 (${commits.length}개 커밋)`,
    description: `커밋 내역:\n${messages}\n\n변경 파일: ${filesList.slice(0, 10).join(", ")}\n총 변경: +${totalAdditions}/-${totalDeletions}`,
    date,
    project,
    complexity: totalAdditions + totalDeletions > 200 ? "High" : totalAdditions + totalDeletions > 50 ? "Medium" : "Low",
    commitShas: commits.map((c) => c.sha),
  };
}
```

- [ ] **Step 7: 테스트 실행하여 통과 확인**

```bash
npx vitest run src/__tests__/core/
```

Expected: ALL PASS

- [ ] **Step 8: 커밋**

```bash
git add src/core/ src/__tests__/core/
git commit -m "feat: implement core commit grouping and task extraction logic"
```

---

## Task 9: 폴링 스케줄러 (파이프라인 오케스트레이션)

> **Skill:** `nextjs-polling-service` 스킬 참조 — Polling Manager Pattern, Pipeline Execution Order, instrumentation.ts 섹션

**Files:**
- Create: `src/scheduler/polling-manager.ts`
- Create: `instrumentation.ts`

- [ ] **Step 1: polling-manager.ts 구현**

```typescript
// src/scheduler/polling-manager.ts
import cron from "node-cron";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import { getActiveRepositories, updateLastSyncedSha, insertSyncLog } from "@/infra/db/repository";
import { fetchCommitsSince } from "@/infra/github/github-client";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { fetchCommitDiff } from "@/infra/github/github-client";
import { createCommitLogPage, createDailyTaskPage, isCommitAlreadySynced, isDailyTaskExists, updateDailyTaskPage } from "@/infra/notion/notion-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { getAmbiguousCommits, isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import type { CommitRecord } from "@/core/types";

let db: Database.Database | null = null;
let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(process.cwd(), "data", "tracker.db"));
    createTables(db);
  }
  return db;
}

export function getSchedulerStatus() {
  return {
    isRunning,
    lastRunAt,
    nextRunAt: cronTask ? null : null, // node-cron doesn't expose next run
    intervalMin: 15,
  };
}

async function enrichAmbiguousCommits(commits: CommitRecord[]): Promise<CommitRecord[]> {
  const enriched: CommitRecord[] = [];
  for (const commit of commits) {
    if (isAmbiguousCommitMessage(commit.message)) {
      const diff = await fetchCommitDiff(commit.repoOwner, commit.repoName, commit.sha);
      const summary = await analyzeCommitWithDiff(commit, diff);
      enriched.push({ ...commit, message: summary });
    } else {
      enriched.push(commit);
    }
  }
  return enriched;
}

export async function runSyncCycle(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Sync already in progress, skipping");
    return;
  }

  isRunning = true;
  const database = getDb();

  try {
    const repos = getActiveRepositories(database);

    for (const repo of repos) {
      const startTime = new Date().toISOString();
      try {
        // 1. 새 커밋 수집
        const commits = await fetchCommitsSince(repo.owner, repo.repo, repo.branch, repo.last_synced_sha);

        if (commits.length === 0) {
          console.log(`[Scheduler] ${repo.owner}/${repo.repo}: no new commits`);
          continue;
        }

        console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${commits.length} new commits`);

        // 2. 커밋 로그 Notion DB 동기화
        for (const commit of commits) {
          const alreadySynced = await isCommitAlreadySynced(commit.sha);
          if (!alreadySynced) {
            await createCommitLogPage(commit);
          }
        }

        // 3. 모호한 커밋 메시지 보강 (Gemini diff 분석)
        const enrichedCommits = await enrichAmbiguousCommits(commits);

        // 4. 날짜/프로젝트별 그룹핑
        const groups = groupCommitsByDateAndProject(enrichedCommits);

        // 5. 각 그룹에 대해 Gemini 분석 → 일일 태스크 생성
        let tasksCreated = 0;
        for (const group of groups) {
          const tasks = await analyzeCommits(group.commits, group.project, group.date);

          for (const task of tasks) {
            const existingPageId = await isDailyTaskExists(task.project, task.date);
            if (existingPageId) {
              await updateDailyTaskPage(existingPageId, task);
            } else {
              await createDailyTaskPage(task);
              tasksCreated++;
            }
          }
        }

        // 6. 마지막 SHA 업데이트
        updateLastSyncedSha(database, repo.id, commits[0].sha);

        // 7. 성공 로그
        insertSyncLog(database, {
          repositoryId: repo.id,
          status: "success",
          commitsProcessed: commits.length,
          tasksCreated,
          errorMessage: null,
        });

        console.log(`[Scheduler] ${repo.owner}/${repo.repo}: synced ${commits.length} commits, created ${tasksCreated} tasks`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        insertSyncLog(database, {
          repositoryId: repo.id,
          status: "error",
          commitsProcessed: 0,
          tasksCreated: 0,
          errorMessage: errorMsg,
        });
        console.error(`[Scheduler] ${repo.owner}/${repo.repo}: sync failed -`, errorMsg);
      }
    }

    lastRunAt = new Date().toISOString();
  } finally {
    isRunning = false;
  }
}

export function startScheduler(intervalMin: number = 15): void {
  if (cronTask) {
    console.log("[Scheduler] Already running");
    return;
  }

  // 즉시 한번 실행
  runSyncCycle().catch(console.error);

  // 주기적 실행
  cronTask = cron.schedule(`*/${intervalMin} * * * *`, () => {
    runSyncCycle().catch(console.error);
  });

  console.log(`[Scheduler] Started with ${intervalMin}min interval`);
}

export function stopScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[Scheduler] Stopped");
  }
}
```

- [ ] **Step 2: instrumentation.ts 구현**

```typescript
// instrumentation.ts (프로젝트 루트)
export async function register() {
  // 서버 사이드에서만 스케줄러 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/scheduler/polling-manager");
    startScheduler(15);
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/scheduler/ instrumentation.ts
git commit -m "feat: implement polling scheduler with pipeline orchestration"
```

---

## Task 10: Auth.js HRMS OAuth2 인증

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Modify: `src/app/layout.tsx`
- Create: `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: auth.ts 설정**

```typescript
// src/lib/auth.ts
import NextAuth from "next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "hrms",
      name: "HRMS",
      type: "oidc",
      issuer: process.env.AUTH_HRMS_ISSUER,
      clientId: process.env.AUTH_HRMS_ID,
      clientSecret: process.env.AUTH_HRMS_SECRET,
      authorization: {
        params: {
          scope: "openid profile email department",
          display: "popup",
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          department: profile.department,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        token.department = (profile as any).department;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.department) {
        (session.user as any).department = token.department;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
```

- [ ] **Step 2: API 라우트 핸들러**

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 3: 로그인 페이지**

```tsx
// src/app/(auth)/login/page.tsx
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Repo Task Tracker</CardTitle>
          <CardDescription>HRMS 계정으로 로그인하세요</CardDescription>
        </CardHeader>
        <form
          action={async () => {
            "use server";
            await signIn("hrms");
          }}
        >
          <Button type="submit" className="w-full">
            HRMS로 로그인
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 루트 레이아웃에 SessionProvider 추가**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo Task Tracker",
  description: "Git 커밋을 분석하여 Notion에 일일 업무 기록을 자동 생성합니다",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SessionProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: 커밋**

```bash
git add src/lib/auth.ts src/app/api/auth/ src/app/\(auth\)/ src/app/layout.tsx
git commit -m "feat: implement HRMS OAuth2 authentication with Auth.js v5"
```

---

## Task 11: API Routes (저장소 CRUD + 동기화 + 태스크 조회)

**Files:**
- Create: `src/app/api/repos/route.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/tasks/route.ts`
- Create: `src/app/api/cron/route.ts`

- [ ] **Step 1: repos API**

```typescript
// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import {
  insertRepository,
  getActiveRepositories,
  deleteRepository,
  toggleRepository,
  getRepositoryByOwnerRepo,
} from "@/infra/db/repository";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  try {
    const repos = getActiveRepositories(db);
    return NextResponse.json(repos);
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { owner, repo, branch = "main" } = body;

  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getRepositoryByOwnerRepo(db, owner, repo);
    if (existing) {
      return NextResponse.json({ error: "Repository already registered" }, { status: 409 });
    }

    insertRepository(db, { owner, repo, branch });
    return NextResponse.json({ message: "Repository registered" }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  try {
    deleteRepository(db, Number(id));
    return NextResponse.json({ message: "Deleted" });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: sync API**

```typescript
// src/app/api/sync/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runSyncCycle } from "@/scheduler/polling-manager";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await runSyncCycle();
    return NextResponse.json({ message: "Sync completed" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: tasks API**

```typescript
// src/app/api/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");
  const date = searchParams.get("date");

  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  const filters: any[] = [];
  if (project) filters.push({ property: "프로젝트", select: { equals: project } });
  if (date) filters.push({ property: "작업일", date: { equals: date } });

  const response = await notion.databases.query({
    database_id: process.env.NOTION_TASK_DB_ID!,
    filter: filters.length > 0 ? { and: filters } : undefined,
    sorts: [{ property: "작업일", direction: "descending" }],
  });

  return NextResponse.json(response.results);
}
```

- [ ] **Step 4: cron API (스케줄러 상태)**

```typescript
// src/app/api/cron/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSchedulerStatus } from "@/scheduler/polling-manager";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSchedulerStatus());
}
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/
git commit -m "feat: implement API routes for repos, sync, tasks, and cron status"
```

---

## Task 12: 대시보드 레이아웃 & 페이지 UI

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/page.tsx`

- [ ] **Step 1: 대시보드 레이아웃**

```tsx
// src/app/(dashboard)/layout.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { PageContainer } from "@/components/layout/page-container";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex">
      <Sidebar />
      <PageContainer>{children}</PageContainer>
    </div>
  );
}
```

- [ ] **Step 2: 대시보드 홈 페이지**

```tsx
// src/app/(dashboard)/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/data-display/stat-card";
import { StatusIndicator } from "@/components/data-display/status-indicator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export default function DashboardPage() {
  const { toast } = useToast();
  const [repos, setRepos] = useState<any[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/repos").then((r) => r.json()).then(setRepos);
    fetch("/api/cron").then((r) => r.json()).then(setSchedulerStatus);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        toast("동기화 완료", "success");
      } else {
        const data = await res.json();
        toast(data.error || "동기화 실패", "error");
      }
    } catch {
      toast("동기화 중 오류 발생", "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <Header
        title="대시보드"
        description="Git 커밋 모니터링 및 Notion 동기화 현황"
        actions={
          <Button onClick={handleSync} loading={syncing}>
            지금 동기화
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="등록된 저장소" value={repos.length} />
        <StatCard
          label="스케줄러 상태"
          value={schedulerStatus?.isRunning ? "실행 중" : "대기"}
        />
        <StatCard
          label="마지막 동기화"
          value={schedulerStatus?.lastRunAt
            ? new Date(schedulerStatus.lastRunAt).toLocaleString("ko-KR")
            : "없음"
          }
        />
      </div>

      <Card>
        <h2 className="text-lg font-semibold mb-4">등록된 저장소</h2>
        {repos.length === 0 ? (
          <p className="text-sm text-gray-500">등록된 저장소가 없습니다. 저장소 관리에서 추가하세요.</p>
        ) : (
          <div className="space-y-3">
            {repos.map((repo: any) => (
              <div key={repo.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium">{repo.owner}/{repo.repo}</p>
                  <p className="text-sm text-gray-500">브랜치: {repo.branch}</p>
                </div>
                <StatusIndicator status={repo.is_active ? "success" : "idle"} label={repo.is_active ? "활성" : "비활성"} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(dashboard\)/layout.tsx src/app/\(dashboard\)/page.tsx
git commit -m "feat: implement dashboard layout and home page"
```

---

## Task 13: 저장소 관리 페이지

**Files:**
- Create: `src/app/(dashboard)/repos/page.tsx`

- [ ] **Step 1: 저장소 관리 페이지 구현**

```tsx
// src/app/(dashboard)/repos/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/data-display/empty-state";
import { useToast } from "@/components/ui/toast";

export default function ReposPage() {
  const { toast } = useToast();
  const [repos, setRepos] = useState<any[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [loading, setLoading] = useState(false);

  const fetchRepos = () => {
    fetch("/api/repos").then((r) => r.json()).then(setRepos);
  };

  useEffect(() => { fetchRepos(); }, []);

  const handleAdd = async () => {
    // URL 파싱: https://github.com/owner/repo → { owner, repo }
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      toast("올바른 GitHub 저장소 URL을 입력하세요", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: match[1], repo: match[2].replace(".git", ""), branch }),
      });

      if (res.ok) {
        toast("저장소가 등록되었습니다", "success");
        setShowDialog(false);
        setRepoUrl("");
        setBranch("main");
        fetchRepos();
      } else {
        const data = await res.json();
        toast(data.error || "등록 실패", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/repos?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("저장소가 삭제되었습니다", "success");
      fetchRepos();
    }
  };

  return (
    <div>
      <Header
        title="저장소 관리"
        description="모니터링할 GitHub 저장소를 등록하고 관리합니다"
        actions={<Button onClick={() => setShowDialog(true)}>저장소 추가</Button>}
      />

      {repos.length === 0 ? (
        <EmptyState
          title="등록된 저장소가 없습니다"
          description="GitHub 저장소를 추가하여 커밋 모니터링을 시작하세요"
          action={<Button onClick={() => setShowDialog(true)}>첫 저장소 추가</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>저장소</TableHead>
              <TableHead>브랜치</TableHead>
              <TableHead>마지막 동기화 SHA</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.map((repo: any) => (
              <TableRow key={repo.id}>
                <TableCell className="font-medium">{repo.owner}/{repo.repo}</TableCell>
                <TableCell>{repo.branch}</TableCell>
                <TableCell className="font-mono text-xs">{repo.last_synced_sha?.slice(0, 7) || "-"}</TableCell>
                <TableCell>
                  <Badge variant={repo.is_active ? "success" : "default"}>
                    {repo.is_active ? "활성" : "비활성"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(repo.id)}>삭제</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showDialog} onClose={() => setShowDialog(false)} title="저장소 추가">
        <div className="space-y-4">
          <Input
            label="GitHub 저장소 URL"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <Input
            label="브랜치"
            placeholder="main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDialog(false)}>취소</Button>
            <Button onClick={handleAdd} loading={loading}>등록</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/\(dashboard\)/repos/
git commit -m "feat: implement repository management page with add/delete"
```

---

## Task 14: 일일 태스크 페이지

**Files:**
- Create: `src/app/(dashboard)/tasks/page.tsx`

- [ ] **Step 1: 태스크 목록 페이지 구현**

```tsx
// src/app/(dashboard)/tasks/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/data-display/empty-state";

const complexityVariant: Record<string, "default" | "success" | "warning" | "error"> = {
  Low: "success",
  Medium: "default",
  High: "warning",
  Critical: "error",
};

function extractProperty(page: any, name: string): string {
  const prop = page.properties[name];
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.[0]?.plain_text || "";
  if (prop.type === "rich_text") return prop.rich_text?.[0]?.plain_text || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [dateFilter, setDateFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFilter) params.set("date", dateFilter);

    fetch(`/api/tasks?${params}`)
      .then((r) => r.json())
      .then(setTasks)
      .finally(() => setLoading(false));
  }, [dateFilter]);

  return (
    <div>
      <Header title="일일 태스크" description="Gemini가 분석한 프로젝트별 일일 업무 기록" />

      <div className="mb-4 max-w-xs">
        <Input
          label="날짜 필터"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">로딩 중...</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          title="태스크가 없습니다"
          description="동기화를 실행하면 커밋 분석 결과가 여기에 표시됩니다"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>작업일</TableHead>
              <TableHead>복잡도</TableHead>
              <TableHead>작업 설명</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((page: any) => (
              <TableRow key={page.id}>
                <TableCell className="font-medium">{extractProperty(page, "제목")}</TableCell>
                <TableCell>
                  <Badge variant="info">{extractProperty(page, "프로젝트")}</Badge>
                </TableCell>
                <TableCell>{extractProperty(page, "작업일")}</TableCell>
                <TableCell>
                  <Badge variant={complexityVariant[extractProperty(page, "작업 복잡도")] || "default"}>
                    {extractProperty(page, "작업 복잡도")}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md truncate">{extractProperty(page, "작업 설명")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/\(dashboard\)/tasks/
git commit -m "feat: implement daily tasks page with date filtering"
```

---

## Task 15: 캘린더 뷰 페이지

**Files:**
- Create: `src/app/(dashboard)/calendar/page.tsx`

- [ ] **Step 1: 캘린더 페이지 구현**

```tsx
// src/app/(dashboard)/calendar/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function extractProperty(page: any, name: string): string {
  const prop = page.properties[name];
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.[0]?.plain_text || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  useEffect(() => {
    // 월 전체 태스크 로드 (Notion API는 range 필터 지원)
    fetch("/api/tasks").then((r) => r.json()).then(setTasks);
  }, [year, month]);

  const tasksByDate = new Map<string, any[]>();
  for (const task of tasks) {
    const date = extractProperty(task, "작업일");
    if (!tasksByDate.has(date)) tasksByDate.set(date, []);
    tasksByDate.get(date)!.push(task);
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const weekDays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div>
      <Header title="캘린더" description="날짜별 수행 태스크를 확인합니다" />

      <Card>
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" onClick={prevMonth}>&lt; 이전</Button>
          <h2 className="text-lg font-semibold">
            {year}년 {month + 1}월
          </h2>
          <Button variant="ghost" onClick={nextMonth}>다음 &gt;</Button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
          {weekDays.map((day) => (
            <div key={day} className="bg-gray-50 p-2 text-center text-xs font-medium text-gray-500">
              {day}
            </div>
          ))}

          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-white p-2 min-h-[100px]" />
          ))}

          {days.map((day) => {
            const dateStr = formatDate(day);
            const dayTasks = tasksByDate.get(dateStr) || [];
            const isToday = dateStr === formatDate(new Date());
            const isSelected = dateStr === selectedDate;

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`bg-white p-2 min-h-[100px] cursor-pointer transition-colors hover:bg-blue-50 ${
                  isSelected ? "ring-2 ring-blue-500" : ""
                }`}
              >
                <span className={`text-sm font-medium ${isToday ? "bg-blue-600 text-white rounded-full w-6 h-6 inline-flex items-center justify-center" : "text-gray-700"}`}>
                  {day.getDate()}
                </span>
                <div className="mt-1 space-y-1">
                  {dayTasks.slice(0, 3).map((t: any) => (
                    <div key={t.id} className="text-xs truncate text-gray-600 bg-blue-50 rounded px-1 py-0.5">
                      {extractProperty(t, "제목")}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="text-xs text-gray-400">+{dayTasks.length - 3}개 더</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {selectedDate && (
        <Card className="mt-4">
          <h3 className="text-lg font-semibold mb-3">{selectedDate} 태스크</h3>
          {(tasksByDate.get(selectedDate) || []).length === 0 ? (
            <p className="text-sm text-gray-500">이 날짜에 기록된 태스크가 없습니다</p>
          ) : (
            <div className="space-y-3">
              {(tasksByDate.get(selectedDate) || []).map((t: any) => (
                <div key={t.id} className="border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{extractProperty(t, "제목")}</span>
                    <Badge variant="info">{extractProperty(t, "프로젝트")}</Badge>
                    <Badge>{extractProperty(t, "작업 복잡도")}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{extractProperty(t, "작업 설명")}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/\(dashboard\)/calendar/
git commit -m "feat: implement calendar view with daily task visualization"
```

---

## Task 16: 설정 페이지

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: 설정 페이지 구현**

```tsx
// src/app/(dashboard)/settings/page.tsx
"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export default function SettingsPage() {
  const { toast } = useToast();
  const [notionCommitDbId, setNotionCommitDbId] = useState("");
  const [notionTaskDbId, setNotionTaskDbId] = useState("");

  const handleSave = () => {
    // 설정은 환경 변수로 관리하므로, 여기서는 안내만 제공
    toast("설정은 .env.local 파일에서 직접 수정하세요", "info");
  };

  return (
    <div>
      <Header title="설정" description="서비스 구성을 관리합니다" />

      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Notion 데이터베이스</CardTitle>
            <CardDescription>Notion에 생성된 데이터베이스 ID를 설정합니다</CardDescription>
          </CardHeader>
          <div className="space-y-4">
            <Input
              label="커밋 로그 DB ID"
              placeholder="Notion 데이터베이스 ID"
              value={notionCommitDbId}
              onChange={(e) => setNotionCommitDbId(e.target.value)}
            />
            <Input
              label="일일 태스크 DB ID"
              placeholder="Notion 데이터베이스 ID"
              value={notionTaskDbId}
              onChange={(e) => setNotionTaskDbId(e.target.value)}
            />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>폴링 설정</CardTitle>
            <CardDescription>커밋 수집 주기를 설정합니다 (기본: 15분)</CardDescription>
          </CardHeader>
          <p className="text-sm text-gray-500">
            현재 폴링 주기는 서버 시작 시 설정됩니다.
            <code className="bg-gray-100 px-1 rounded">instrumentation.ts</code>에서 변경 가능합니다.
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API 키 상태</CardTitle>
            <CardDescription>연결된 외부 서비스 상태를 확인합니다</CardDescription>
          </CardHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>GitHub Token</span>
              <span className={process.env.NEXT_PUBLIC_HAS_GITHUB_TOKEN ? "text-green-600" : "text-red-600"}>
                {process.env.NEXT_PUBLIC_HAS_GITHUB_TOKEN ? "✓ 연결됨" : "✗ 미설정"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Notion API Key</span>
              <span className="text-gray-500">서버 사이드에서 확인</span>
            </div>
            <div className="flex justify-between">
              <span>Gemini API Key</span>
              <span className="text-gray-500">서버 사이드에서 확인</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/\(dashboard\)/settings/
git commit -m "feat: implement settings page with service status display"
```

---

## Task 17: Next.js 설정 & 최종 통합

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: next.config.ts 설정**

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 2: data 디렉토리 초기화**

```bash
mkdir -p data
touch data/.gitkeep
```

- [ ] **Step 3: 빌드 테스트**

```bash
npm run build
```

Expected: 빌드 성공

- [ ] **Step 4: 테스트 실행**

```bash
npm run test
```

Expected: ALL PASS

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "feat: finalize Next.js config and integration"
```

---

## Task 18: E2E 검증

- [ ] **Step 1: 로컬 서버 시작**

```bash
npm run dev
```

Expected: `http://localhost:3000`에서 서버 시작, 콘솔에 `[Scheduler] Started with 15min interval` 출력

- [ ] **Step 2: 로그인 테스트**

브라우저에서 `http://localhost:3000` 접속 → `/login`으로 리다이렉트 확인 → HRMS 로그인

- [ ] **Step 3: 저장소 등록 테스트**

`/repos`에서 GitHub 저장소 URL 입력하여 등록. SQLite DB에 저장 확인.

- [ ] **Step 4: 수동 동기화 테스트**

대시보드에서 "지금 동기화" 클릭 → 콘솔 로그 확인 → Notion DB에 커밋 로그와 일일 태스크 페이지 생성 확인

- [ ] **Step 5: Notion 뷰 확인**

Notion에서 일일 태스크 DB를 열어 캘린더 뷰, 보드 뷰 전환하여 데이터 확인

- [ ] **Step 6: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "chore: post-integration fixes"
```
