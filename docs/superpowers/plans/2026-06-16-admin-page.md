# 관리자 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` 독립 라우트에 암호 인증 기반 관리자 페이지를 구축하여 사용자 관리(조회/비활성화/삭제)와 시스템 모니터링(스케줄러/동기화 로그/HRMS 로그)을 제공한다.

**Architecture:** 기존 `(dashboard)` 그룹과 완전히 분리된 `src/app/admin/` 라우트 그룹을 사용한다. 관리자 인증은 NextAuth와 독립적으로 환경변수 `ADMIN_PASSWORD` 비교 + 서명된 쿠키 토큰으로 구현한다. 관리자 API는 모두 `/api/admin/` 하위에 배치하며, 기존 DB 테이블의 원본 레코드를 직접 수정한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui, better-sqlite3, jose (JWT 서명)

**Spec:** `docs/superpowers/specs/2026-06-16-admin-page-design.md`

**Mockup:** `.superpowers/brainstorm/1779-1781576630/content/admin-layout-v3.html`

---

## 파일 구조

```
수정:
  src/infra/db/schema.ts           — users 테이블에 is_active 컬럼 추가 (마이그레이션)
  src/lib/auth.ts                  — signIn 콜백에서 is_active 체크 추가
  deploy/.env.example              — ADMIN_PASSWORD 추가

생성:
  src/lib/admin-auth.ts            — 관리자 토큰 생성/검증 유틸리티 (jose)
  src/infra/db/admin-repository.ts — 관리자 전용 DB 쿼리 함수 모음

  src/app/api/admin/auth/route.ts           — POST 관리자 인증
  src/app/api/admin/users/route.ts          — GET 사용자 목록
  src/app/api/admin/users/[id]/route.ts     — PATCH 비활성화, DELETE 삭제
  src/app/api/admin/scheduler/route.ts      — GET 스케줄러 현황
  src/app/api/admin/scheduler/repos/[id]/route.ts          — PATCH 동기화 토글
  src/app/api/admin/scheduler/repos/[id]/auto-report/route.ts — PATCH 보고서 토글
  src/app/api/admin/scheduler/hrms-mappings/[id]/route.ts   — PATCH HRMS 토글
  src/app/api/admin/scheduler/logicraft-mappings/[id]/route.ts — PATCH LogiCraft 토글
  src/app/api/admin/sync-logs/route.ts      — GET 동기화 로그
  src/app/api/admin/hrms-logs/route.ts      — GET HRMS 로그

  src/components/admin/admin-auth-gate.tsx   — 암호 입력 + 세션 게이트
  src/components/admin/admin-nav.tsx         — 상단 네비게이션 바
  src/components/admin/user-table.tsx        — 사용자 관리 테이블
  src/components/admin/scheduler-table.tsx   — 스케줄러 관리 테이블
  src/components/admin/sync-log-table.tsx    — 동기화 로그 테이블
  src/components/admin/hrms-log-table.tsx    — HRMS 로그 테이블

  src/app/admin/layout.tsx          — 관리자 레이아웃
  src/app/admin/page.tsx            — 사용자 관리 탭
  src/app/admin/scheduler/page.tsx  — 스케줄러 탭
  src/app/admin/sync-logs/page.tsx  — 동기화 로그 탭
  src/app/admin/hrms-logs/page.tsx  — HRMS 로그 탭
```

---

## Task 1: DB 스키마 — `is_active` 컬럼 추가

**Files:**
- Modify: `src/infra/db/schema.ts`

- [ ] **Step 1: `createTables`의 users 테이블 정의에 `is_active` 추가**

`src/infra/db/schema.ts`의 `CREATE TABLE IF NOT EXISTS users` 안에 `is_active` 컬럼 추가:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  provider TEXT NOT NULL DEFAULT 'credentials',
  provider_account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: `migrateSchema`에 `is_active` 마이그레이션 추가**

`migrateSchema` 함수 끝에 추가 (기존 users 테이블 마이그레이션 블록 뒤):

```typescript
// users: is_active 컬럼 추가
const latestUserColumns = db.prepare("PRAGMA table_info(users)").all() as any[];
const latestUserColumnNames = latestUserColumns.map((c: any) => c.name);
if (!latestUserColumnNames.includes("is_active")) {
  db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/infra/db/schema.ts
git commit -m "feat: users 테이블에 is_active 컬럼 추가"
```

---

## Task 2: 로그인 차단 — 비활성 사용자 로그인 거부

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/infra/db/repository.ts` (getUserByEmail 반환 타입에 is_active 포함 확인)

- [ ] **Step 1: `auth.ts`의 signIn 콜백에서 is_active 체크 추가**

`src/lib/auth.ts`의 `signIn` 콜백을 수정한다. Credentials 로그인과 OAuth 로그인 양쪽 모두에서 `is_active`를 체크한다:

```typescript
async signIn({ user, account, profile }) {
  const db = getDb();

  if (account?.provider === "credentials") {
    // Credentials 로그인: authorize에서 이미 user를 가져왔으므로 is_active만 체크
    const dbUser = getUserByEmail(db, user.email || "");
    if (dbUser && !dbUser.is_active) return false;
  }

  if (account?.provider && account.provider !== "credentials" && profile) {
    const dbUser = upsertOAuthUser(db, {
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
```

주의: `upsertOAuthUser`가 반환하는 객체에 `is_active` 필드가 포함되는지 확인한다. `SELECT *`로 가져오므로 마이그레이션 후 자동 포함된다.

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/auth.ts
git commit -m "feat: 비활성 사용자 로그인 거부 — signIn 콜백에 is_active 체크 추가"
```

---

## Task 3: 관리자 인증 유틸리티 (`admin-auth.ts`)

**Files:**
- Create: `src/lib/admin-auth.ts`

- [ ] **Step 1: jose 설치 확인**

Run: `npm ls jose`

jose가 없으면:
Run: `npm install jose`

- [ ] **Step 2: `admin-auth.ts` 작성**

`src/lib/admin-auth.ts`:

```typescript
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const adminCookieName = "admin-token";

function getSecret() {
  const secret = process.env.AUTH_SECRET || "fallback-admin-secret";
  return new TextEncoder().encode(secret);
}

export async function createAdminToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function setAdminCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(adminCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // maxAge 미설정 → 세션 쿠키 (브라우저 닫으면 만료)
  });
}

export async function getAdminTokenFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(adminCookieName)?.value;
}

export async function clearAdminCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(adminCookieName);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const token = await getAdminTokenFromCookie();
  if (!token) return false;
  return verifyAdminToken(token);
}

/** API 라우트에서 사용 — Request 헤더의 쿠키에서 토큰 추출 */
export async function verifyAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(adminCookieName)?.value;
  if (!token) return false;
  return verifyAdminToken(token);
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/admin-auth.ts
git commit -m "feat: 관리자 인증 유틸리티 — JWT 토큰 생성/검증, 세션 쿠키 관리"
```

---

## Task 4: 관리자 인증 API (`/api/admin/auth`)

**Files:**
- Create: `src/app/api/admin/auth/route.ts`

- [ ] **Step 1: 인증 라우트 작성**

`src/app/api/admin/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createAdminToken, setAdminCookie, clearAdminCookie } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD가 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { password } = body;

  if (password !== adminPassword) {
    return NextResponse.json({ error: "암호가 일치하지 않습니다" }, { status: 401 });
  }

  const token = await createAdminToken();
  await setAdminCookie(token);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/admin/auth/route.ts
git commit -m "feat: 관리자 인증 API — POST 로그인, DELETE 로그아웃"
```

---

## Task 5: 관리자 전용 DB 쿼리 함수 (`admin-repository.ts`)

**Files:**
- Create: `src/infra/db/admin-repository.ts`

- [ ] **Step 1: 관리자 전용 쿼리 함수 작성**

`src/infra/db/admin-repository.ts`:

```typescript
import Database from "better-sqlite3";

// ── 사용자 관리 ──

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  provider: string;
  is_active: number;
  created_at: string;
  repo_count: number;
}

export interface AdminUserStats {
  total: number;
  active: number;
  inactive: number;
}

export function getAllUsers(db: Database.Database): AdminUser[] {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.provider, u.is_active, u.created_at,
           COUNT(r.id) AS repo_count
    FROM users u
    LEFT JOIN repositories r ON r.user_id = CAST(u.id AS TEXT)
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all() as AdminUser[];
}

export function getUserStats(db: Database.Database): AdminUserStats {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive
    FROM users
  `).get() as any;
  return { total: row.total || 0, active: row.active || 0, inactive: row.inactive || 0 };
}

export function setUserActive(db: Database.Database, userId: number, isActive: boolean): void {
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, userId);
}

export function deleteUser(db: Database.Database, userId: number): void {
  const userIdStr = String(userId);
  const transaction = db.transaction(() => {
    // hrms_task_logs → hrms_mapping_repos → hrms_project_mappings 순서로 삭제
    const mappingIds = db.prepare(
      "SELECT id FROM hrms_project_mappings WHERE user_id = ?"
    ).all(userIdStr).map((r: any) => r.id);
    for (const mid of mappingIds) {
      db.prepare("DELETE FROM hrms_task_logs WHERE mapping_id = ?").run(mid);
      db.prepare("DELETE FROM hrms_mapping_repos WHERE mapping_id = ?").run(mid);
    }
    db.prepare("DELETE FROM hrms_project_mappings WHERE user_id = ?").run(userIdStr);

    // hrms_logicraft_task_logs → hrms_logicraft_mappings
    const lcMappingIds = db.prepare(
      "SELECT id FROM hrms_logicraft_mappings WHERE user_id = ?"
    ).all(userIdStr).map((r: any) => r.id);
    for (const mid of lcMappingIds) {
      db.prepare("DELETE FROM hrms_logicraft_task_logs WHERE mapping_id = ?").run(mid);
    }
    db.prepare("DELETE FROM hrms_logicraft_mappings WHERE user_id = ?").run(userIdStr);

    db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM logicraft_api_keys WHERE user_id = ?").run(userIdStr);
    db.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(userIdStr);

    // repositories cascade로 commit_cache, sync_logs, reports, hrms_mapping_repos 삭제
    db.prepare("DELETE FROM repositories WHERE user_id = ?").run(userIdStr);

    // 마지막: 사용자 삭제
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  transaction();
}

// ── 스케줄러 현황 ──

export interface SchedulerRepoRow {
  repo_id: number;
  owner: string;
  repo: string;
  branch: string;
  polling_interval_min: number;
  is_active: number;
  auto_report_enabled: number;
  sync_status: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export function getSchedulerRepos(db: Database.Database): SchedulerRepoRow[] {
  return db.prepare(`
    SELECT
      r.id AS repo_id, r.owner, r.repo, r.branch,
      r.polling_interval_min, r.is_active, r.auto_report_enabled,
      r.sync_status, r.user_id,
      u.name AS user_name, u.email AS user_email,
      sl.completed_at AS last_sync_at, sl.status AS last_sync_status
    FROM repositories r
    JOIN users u ON CAST(u.id AS TEXT) = r.user_id
    LEFT JOIN (
      SELECT repository_id, completed_at, status,
             ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY completed_at DESC) AS rn
      FROM sync_logs
    ) sl ON sl.repository_id = r.id AND sl.rn = 1
    ORDER BY u.name, r.repo
  `).all() as SchedulerRepoRow[];
}

export interface HrmsMappingRow {
  id: number;
  repo_ids: string;
  auto_register: number;
  cron_time: string;
  hrms_project_name: string;
  user_id: string;
}

export function getHrmsMappings(db: Database.Database): HrmsMappingRow[] {
  return db.prepare(`
    SELECT hpm.id, hpm.auto_register, hpm.cron_time, hpm.hrms_project_name, hpm.user_id,
           GROUP_CONCAT(hmr.repository_id) AS repo_ids
    FROM hrms_project_mappings hpm
    LEFT JOIN hrms_mapping_repos hmr ON hmr.mapping_id = hpm.id
    GROUP BY hpm.id
  `).all() as HrmsMappingRow[];
}

export interface LogicraftMappingRow {
  id: number;
  auto_register: number;
  cron_time: string;
  logicraft_project_name: string;
  user_id: string;
  hrms_project_id: number;
}

export function getLogicraftMappings(db: Database.Database): LogicraftMappingRow[] {
  return db.prepare(`
    SELECT id, auto_register, cron_time, logicraft_project_name, user_id, hrms_project_id
    FROM hrms_logicraft_mappings
  `).all() as LogicraftMappingRow[];
}

export function toggleRepoActive(db: Database.Database, repoId: number, isActive: boolean): void {
  db.prepare("UPDATE repositories SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, repoId);
}

export function toggleRepoAutoReport(db: Database.Database, repoId: number, enabled: boolean): void {
  db.prepare("UPDATE repositories SET auto_report_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, repoId);
}

export function toggleHrmsAutoRegister(db: Database.Database, mappingId: number, enabled: boolean): void {
  db.prepare("UPDATE hrms_project_mappings SET auto_register = ? WHERE id = ?").run(enabled ? 1 : 0, mappingId);
}

export function toggleLogicraftAutoRegister(db: Database.Database, mappingId: number, enabled: boolean): void {
  db.prepare("UPDATE hrms_logicraft_mappings SET auto_register = ? WHERE id = ?").run(enabled ? 1 : 0, mappingId);
}

// ── 동기화 로그 ──

export interface SyncLogRow {
  id: number;
  completed_at: string | null;
  repo_name: string;
  user_name: string;
  status: string;
  commits_processed: number;
  tasks_created: number;
  error_message: string | null;
}

export function getSyncLogs(
  db: Database.Database,
  filters: { userId?: string; repoId?: string; status?: string; limit?: number }
): SyncLogRow[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.userId) {
    conditions.push("sl.user_id = ?");
    params.push(filters.userId);
  }
  if (filters.repoId) {
    conditions.push("sl.repository_id = ?");
    params.push(Number(filters.repoId));
  }
  if (filters.status) {
    conditions.push("sl.status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;

  return db.prepare(`
    SELECT sl.id, sl.completed_at, r.repo AS repo_name,
           u.name AS user_name, sl.status,
           sl.commits_processed, sl.tasks_created, sl.error_message
    FROM sync_logs sl
    JOIN repositories r ON r.id = sl.repository_id
    JOIN users u ON CAST(u.id AS TEXT) = sl.user_id
    ${where}
    ORDER BY sl.completed_at DESC
    LIMIT ?
  `).all(...params, limit) as SyncLogRow[];
}

// ── HRMS 로그 ──

export interface HrmsLogRow {
  id: number;
  created_at: string;
  user_name: string;
  hrms_project_name: string;
  target_date: string;
  title: string;
  status: string;
  error_message: string | null;
}

export interface HrmsLogStats {
  total: number;
  success: number;
  error: number;
  skipped: number;
}

export function getHrmsLogs(
  db: Database.Database,
  filters: { userId?: string; projectId?: string; status?: string; date?: string; limit?: number }
): HrmsLogRow[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.userId) {
    conditions.push("hpm.user_id = ?");
    params.push(filters.userId);
  }
  if (filters.projectId) {
    conditions.push("hpm.hrms_project_id = ?");
    params.push(Number(filters.projectId));
  }
  if (filters.status) {
    conditions.push("htl.status = ?");
    params.push(filters.status);
  }
  if (filters.date) {
    conditions.push("htl.target_date = ?");
    params.push(filters.date);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;

  return db.prepare(`
    SELECT htl.id, htl.created_at, u.name AS user_name,
           hpm.hrms_project_name, htl.target_date, htl.title,
           htl.status, htl.error_message
    FROM hrms_task_logs htl
    JOIN hrms_project_mappings hpm ON hpm.id = htl.mapping_id
    JOIN users u ON CAST(u.id AS TEXT) = hpm.user_id
    ${where}
    ORDER BY htl.created_at DESC
    LIMIT ?
  `).all(...params, limit) as HrmsLogRow[];
}

export function getHrmsLogStats(db: Database.Database, date?: string): HrmsLogStats {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM hrms_task_logs
    WHERE DATE(created_at) = ?
  `).get(targetDate) as any;
  return {
    total: row.total || 0,
    success: row.success || 0,
    error: row.error || 0,
    skipped: row.skipped || 0,
  };
}

// ── 필터용 목록 ──

export function getAllUsersForFilter(db: Database.Database): { id: number; name: string }[] {
  return db.prepare("SELECT id, name FROM users ORDER BY name").all() as any[];
}

export function getAllReposForFilter(db: Database.Database): { id: number; repo: string; user_id: string }[] {
  return db.prepare("SELECT id, repo, user_id FROM repositories ORDER BY repo").all() as any[];
}

export function getAllHrmsProjectsForFilter(db: Database.Database): { hrms_project_id: number; hrms_project_name: string }[] {
  return db.prepare(
    "SELECT DISTINCT hrms_project_id, hrms_project_name FROM hrms_project_mappings ORDER BY hrms_project_name"
  ).all() as any[];
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/admin-repository.ts
git commit -m "feat: 관리자 전용 DB 쿼리 함수 — 사용자/스케줄러/로그 CRUD"
```

---

## Task 6: 사용자 관리 API (`/api/admin/users`)

**Files:**
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`

- [ ] **Step 1: 사용자 목록 API 작성**

`src/app/api/admin/users/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getAllUsers, getUserStats } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const users = getAllUsers(db);
  const stats = getUserStats(db);

  return NextResponse.json({ users, stats });
}
```

- [ ] **Step 2: 사용자 비활성화/삭제 API 작성**

`src/app/api/admin/users/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { setUserActive, deleteUser } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { isActive } = body;

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  setUserActive(db, Number(id), isActive);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  deleteUser(db, Number(id));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/users/route.ts src/app/api/admin/users/[id]/route.ts
git commit -m "feat: 관리자 사용자 관리 API — 목록 조회, 비활성화, 삭제"
```

---

## Task 7: 스케줄러 관리 API (`/api/admin/scheduler`)

**Files:**
- Create: `src/app/api/admin/scheduler/route.ts`
- Create: `src/app/api/admin/scheduler/repos/[id]/route.ts`
- Create: `src/app/api/admin/scheduler/repos/[id]/auto-report/route.ts`
- Create: `src/app/api/admin/scheduler/hrms-mappings/[id]/route.ts`
- Create: `src/app/api/admin/scheduler/logicraft-mappings/[id]/route.ts`

- [ ] **Step 1: 스케줄러 현황 API 작성**

`src/app/api/admin/scheduler/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getSchedulerStatus } from "@/scheduler/polling-manager";
import { getSchedulerRepos, getHrmsMappings, getLogicraftMappings } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = getSchedulerStatus();
  const db = getDb();
  const repos = getSchedulerRepos(db);
  const hrmsMappings = getHrmsMappings(db);
  const logicraftMappings = getLogicraftMappings(db);

  return NextResponse.json({ scheduler: status, repos, hrmsMappings, logicraftMappings });
}
```

- [ ] **Step 2: 저장소 동기화 토글 API 작성**

`src/app/api/admin/scheduler/repos/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { toggleRepoActive } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { isActive } = body;

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  toggleRepoActive(db, Number(id), isActive);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 보고서 자동 생성 토글 API 작성**

`src/app/api/admin/scheduler/repos/[id]/auto-report/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { toggleRepoAutoReport } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  toggleRepoAutoReport(db, Number(id), enabled);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: HRMS 자동 등록 토글 API 작성**

`src/app/api/admin/scheduler/hrms-mappings/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { toggleHrmsAutoRegister } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  toggleHrmsAutoRegister(db, Number(id), enabled);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: LogiCraft 자동 등록 토글 API 작성**

`src/app/api/admin/scheduler/logicraft-mappings/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { toggleLogicraftAutoRegister } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  toggleLogicraftAutoRegister(db, Number(id), enabled);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/admin/scheduler/
git commit -m "feat: 관리자 스케줄러 API — 현황 조회 + 4가지 자동화 토글"
```

---

## Task 8: 로그 API (`/api/admin/sync-logs`, `/api/admin/hrms-logs`)

**Files:**
- Create: `src/app/api/admin/sync-logs/route.ts`
- Create: `src/app/api/admin/hrms-logs/route.ts`

- [ ] **Step 1: 동기화 로그 API 작성**

`src/app/api/admin/sync-logs/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getSyncLogs, getAllUsersForFilter, getAllReposForFilter } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const db = getDb();

  const logs = getSyncLogs(db, {
    userId: searchParams.get("userId") || undefined,
    repoId: searchParams.get("repoId") || undefined,
    status: searchParams.get("status") || undefined,
    limit: Number(searchParams.get("limit")) || 100,
  });
  const users = getAllUsersForFilter(db);
  const repos = getAllReposForFilter(db);

  return NextResponse.json({ logs, filters: { users, repos } });
}
```

- [ ] **Step 2: HRMS 로그 API 작성**

`src/app/api/admin/hrms-logs/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsLogs, getHrmsLogStats, getAllUsersForFilter, getAllHrmsProjectsForFilter } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const db = getDb();

  const logs = getHrmsLogs(db, {
    userId: searchParams.get("userId") || undefined,
    projectId: searchParams.get("projectId") || undefined,
    status: searchParams.get("status") || undefined,
    date: searchParams.get("date") || undefined,
    limit: Number(searchParams.get("limit")) || 100,
  });
  const stats = getHrmsLogStats(db, searchParams.get("date") || undefined);
  const users = getAllUsersForFilter(db);
  const projects = getAllHrmsProjectsForFilter(db);

  return NextResponse.json({ logs, stats, filters: { users, projects } });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/sync-logs/route.ts src/app/api/admin/hrms-logs/route.ts
git commit -m "feat: 관리자 로그 API — 동기화 로그 + HRMS 로그 필터 조회"
```

---

## Task 9: 관리자 인증 게이트 컴포넌트

**Files:**
- Create: `src/components/admin/admin-auth-gate.tsx`

- [ ] **Step 1: 인증 게이트 컴포넌트 작성**

`src/components/admin/admin-auth-gate.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface AdminAuthGateProps {
  children: React.ReactNode;
}

export function AdminAuthGate({ children }: AdminAuthGateProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/admin/users`, { credentials: "include" });
      setAuthenticated(res.ok);
    } catch {
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${basePath}/api/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });

      if (res.ok) {
        setAuthenticated(true);
        setPassword("");
      } else {
        const data = await res.json();
        setError(data.error || "인증 실패");
      }
    } catch {
      setError("서버 연결 실패");
    } finally {
      setLoading(false);
    }
  }

  // 초기 로딩
  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  // 인증 완료
  if (authenticated) {
    return <>{children}</>;
  }

  // 로그인 폼
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-[360px]">
        <CardContent className="pt-6">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">🔒 관리자 인증</h1>
            <p className="text-sm text-muted-foreground mt-1">관리자 암호를 입력하세요</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="password"
              placeholder="관리자 암호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? "확인 중..." : "진입"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/admin/admin-auth-gate.tsx
git commit -m "feat: 관리자 인증 게이트 컴포넌트 — 암호 입력 폼 + 세션 체크"
```

---

## Task 10: 관리자 네비게이션 컴포넌트

**Files:**
- Create: `src/components/admin/admin-nav.tsx`

- [ ] **Step 1: 네비게이션 컴포넌트 작성**

`src/components/admin/admin-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const tabs = [
  { label: "사용자 관리", href: "/admin" },
  { label: "스케줄러", href: "/admin/scheduler" },
  { label: "동기화 로그", href: "/admin/sync-logs" },
  { label: "HRMS 로그", href: "/admin/hrms-logs" },
];

export function AdminNav() {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch(`${basePath}/api/admin/auth`, { method: "DELETE", credentials: "include" });
    window.location.reload();
  }

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b bg-card">
      <div className="flex items-center gap-4">
        <span className="text-base font-bold">AutoBriify Admin</span>
        <nav className="flex gap-0.5">
          {tabs.map((tab) => {
            const isActive =
              tab.href === "/admin"
                ? pathname === "/admin" || pathname === `${basePath}/admin`
                : pathname.startsWith(tab.href) || pathname.startsWith(`${basePath}${tab.href}`);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-3.5 py-1.5 text-sm rounded-md transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <button
        onClick={handleLogout}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        로그아웃 ✕
      </button>
    </header>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/admin/admin-nav.tsx
git commit -m "feat: 관리자 네비게이션 바 — 4개 탭 + 로그아웃"
```

---

## Task 11: 관리자 레이아웃

**Files:**
- Create: `src/app/admin/layout.tsx`

- [ ] **Step 1: 레이아웃 작성**

`src/app/admin/layout.tsx`:

```tsx
import { AdminAuthGate } from "@/components/admin/admin-auth-gate";
import { AdminNav } from "@/components/admin/admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-background">
        <AdminNav />
        <main className="p-5">{children}</main>
      </div>
    </AdminAuthGate>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat: 관리자 레이아웃 — AuthGate + AdminNav + 콘텐츠 영역"
```

---

## Task 12: 사용자 관리 테이블 + 페이지

**Files:**
- Create: `src/components/admin/user-table.tsx`
- Create: `src/app/admin/page.tsx`

- [ ] **Step 1: 사용자 테이블 컴포넌트 작성**

`src/components/admin/user-table.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/data-display/stat-card";
import { ConfirmDialog } from "@/components/data-display/confirm-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface User {
  id: number;
  name: string;
  email: string;
  provider: string;
  is_active: number;
  created_at: string;
  repo_count: number;
}

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

export function UserTable() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0 });
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await fetch(`${basePath}/api/admin/users`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setStats(data.stats);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function toggleActive(user: User) {
    await fetch(`${basePath}/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.is_active }),
      credentials: "include",
    });
    fetchUsers();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`${basePath}/api/admin/users/${deleteTarget.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    setDeleteTarget(null);
    fetchUsers();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="전체 사용자" value={stats.total} />
        <StatCard label="활성" value={stats.active} />
        <StatCard label="비활성" value={stats.inactive} />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>로그인</TableHead>
              <TableHead>저장소</TableHead>
              <TableHead>가입일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={user.is_active ? "" : "opacity-50"}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.provider === "hrms" ? "default" : "secondary"}>
                    {user.provider === "hrms" ? "HRMS" : "Credentials"}
                  </Badge>
                </TableCell>
                <TableCell>{user.repo_count}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(user.created_at).toLocaleDateString("ko-KR")}
                </TableCell>
                <TableCell>
                  <Badge variant={user.is_active ? "default" : "destructive"}>
                    {user.is_active ? "활성" : "비활성"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(user)}
                      className="text-xs"
                    >
                      {user.is_active ? "비활성화" : "활성화"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(user)}
                      className="text-xs text-destructive hover:text-destructive"
                    >
                      삭제
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  등록된 사용자가 없습니다
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="사용자 삭제"
          description={`"${deleteTarget.name}" (${deleteTarget.email}) 사용자와 모든 관련 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          onConfirm={handleDelete}
          variant="destructive"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 사용자 관리 페이지 작성**

`src/app/admin/page.tsx`:

```tsx
import { UserTable } from "@/components/admin/user-table";

export default function AdminUsersPage() {
  return <UserTable />;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/admin/user-table.tsx src/app/admin/page.tsx
git commit -m "feat: 관리자 사용자 관리 페이지 — 통계 카드 + 테이블 + 비활성화/삭제"
```

---

## Task 13: 스케줄러 관리 테이블 + 페이지

**Files:**
- Create: `src/components/admin/scheduler-table.tsx`
- Create: `src/app/admin/scheduler/page.tsx`

- [ ] **Step 1: 스케줄러 테이블 컴포넌트 작성**

`src/components/admin/scheduler-table.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface SchedulerStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  syncStartedAt: string | null;
  scheduled: boolean;
  intervalMin: number;
}

interface RepoRow {
  repo_id: number;
  owner: string;
  repo: string;
  branch: string;
  polling_interval_min: number;
  is_active: number;
  auto_report_enabled: number;
  sync_status: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

interface HrmsMapping {
  id: number;
  repo_ids: string;
  auto_register: number;
  cron_time: string;
  hrms_project_name: string;
  user_id: string;
}

interface LogicraftMapping {
  id: number;
  auto_register: number;
  cron_time: string;
  logicraft_project_name: string;
  user_id: string;
  hrms_project_id: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

const statusColors: Record<string, string> = {
  success: "bg-green-900/50 text-green-400",
  error: "bg-red-900/50 text-red-400",
  syncing: "bg-blue-900/50 text-blue-400",
  pending: "bg-zinc-800 text-zinc-400",
  idle: "bg-zinc-800 text-zinc-400",
};

export function SchedulerTable() {
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [hrmsMappings, setHrmsMappings] = useState<HrmsMapping[]>([]);
  const [logicraftMappings, setLogicraftMappings] = useState<LogicraftMapping[]>([]);

  const fetchData = useCallback(async () => {
    const res = await fetch(`${basePath}/api/admin/scheduler`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setScheduler(data.scheduler);
      setRepos(data.repos);
      setHrmsMappings(data.hrmsMappings);
      setLogicraftMappings(data.logicraftMappings);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function toggleSync(repoId: number, current: number) {
    await fetch(`${basePath}/api/admin/scheduler/repos/${repoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
      credentials: "include",
    });
    fetchData();
  }

  async function toggleAutoReport(repoId: number, current: number) {
    await fetch(`${basePath}/api/admin/scheduler/repos/${repoId}/auto-report`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !current }),
      credentials: "include",
    });
    fetchData();
  }

  async function toggleHrms(mappingId: number, current: number) {
    await fetch(`${basePath}/api/admin/scheduler/hrms-mappings/${mappingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !current }),
      credentials: "include",
    });
    fetchData();
  }

  async function toggleLogicraft(mappingId: number, current: number) {
    await fetch(`${basePath}/api/admin/scheduler/logicraft-mappings/${mappingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !current }),
      credentials: "include",
    });
    fetchData();
  }

  function findHrmsMapping(repoId: number): HrmsMapping | undefined {
    return hrmsMappings.find((m) => m.repo_ids?.split(",").includes(String(repoId)));
  }

  function findLogicraftMapping(userId: string): LogicraftMapping | undefined {
    return logicraftMappings.find((m) => m.user_id === userId);
  }

  return (
    <div className="space-y-5">
      {/* 스케줄러 상태 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Cron 스케줄러</p>
              <p className="text-sm text-muted-foreground mt-1">
                마지막 실행: {scheduler?.lastRunAt ? new Date(scheduler.lastRunAt).toLocaleString("ko-KR") : "—"}
              </p>
            </div>
            <Badge variant={scheduler?.scheduled ? "default" : "destructive"} className="text-sm">
              ● {scheduler?.scheduled ? "Running" : "Stopped"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 저장소별 스케줄링 관리 */}
      <div>
        <h3 className="font-semibold mb-3">저장소별 스케줄링 관리</h3>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사용자</TableHead>
                <TableHead>저장소</TableHead>
                <TableHead>마지막 동기화</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-center border-l">
                  <span className="text-blue-400">동기화</span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="text-purple-400">HRMS 등록</span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="text-pink-400">LogiCraft</span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="text-yellow-400">보고서</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => {
                const hrms = findHrmsMapping(repo.repo_id);
                const lc = findLogicraftMapping(repo.user_id);
                const statusClass = statusColors[repo.last_sync_status || "idle"] || statusColors.idle;

                return (
                  <TableRow key={repo.repo_id} className={repo.is_active ? "" : "opacity-50"}>
                    <TableCell>
                      <div className="font-medium">{repo.user_name}</div>
                      <div className="text-xs text-muted-foreground">{repo.user_email}</div>
                    </TableCell>
                    <TableCell>
                      <div>{repo.repo}</div>
                      <div className="text-xs text-muted-foreground">
                        {repo.branch} · {repo.polling_interval_min}분
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {timeAgo(repo.last_sync_at)}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs ${statusClass}`}>
                        {repo.last_sync_status || "idle"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center border-l">
                      <Switch
                        checked={!!repo.is_active}
                        onCheckedChange={() => toggleSync(repo.repo_id, repo.is_active)}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {hrms ? (
                        <div className="flex flex-col items-center gap-1">
                          <Switch
                            checked={!!hrms.auto_register}
                            onCheckedChange={() => toggleHrms(hrms.id, hrms.auto_register)}
                            size="sm"
                          />
                          {hrms.auto_register ? (
                            <span className="text-[10px] text-purple-400">{hrms.cron_time.split(" ").slice(1, 3).join(":")}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {lc ? (
                        <div className="flex flex-col items-center gap-1">
                          <Switch
                            checked={!!lc.auto_register}
                            onCheckedChange={() => toggleLogicraft(lc.id, lc.auto_register)}
                            size="sm"
                          />
                          {lc.auto_register ? (
                            <span className="text-[10px] text-pink-400">{lc.cron_time.split(" ").slice(1, 3).join(":")}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!repo.auto_report_enabled}
                        onCheckedChange={() => toggleAutoReport(repo.repo_id, repo.auto_report_enabled)}
                        size="sm"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {repos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    등록된 저장소가 없습니다
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* 범례 */}
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> 동기화
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-purple-500" /> HRMS
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-pink-500" /> LogiCraft
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-yellow-500" /> 보고서
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 스케줄러 페이지 작성**

`src/app/admin/scheduler/page.tsx`:

```tsx
import { SchedulerTable } from "@/components/admin/scheduler-table";

export default function AdminSchedulerPage() {
  return <SchedulerTable />;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/admin/scheduler-table.tsx src/app/admin/scheduler/page.tsx
git commit -m "feat: 관리자 스케줄러 페이지 — 크론 상태 + 4가지 자동화 토글 테이블"
```

---

## Task 14: 동기화 로그 테이블 + 페이지

**Files:**
- Create: `src/components/admin/sync-log-table.tsx`
- Create: `src/app/admin/sync-logs/page.tsx`

- [ ] **Step 1: 동기화 로그 테이블 컴포넌트 작성**

`src/components/admin/sync-log-table.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface SyncLog {
  id: number;
  completed_at: string | null;
  repo_name: string;
  user_name: string;
  status: string;
  commits_processed: number;
  tasks_created: number;
  error_message: string | null;
}

interface FilterOption {
  id: number;
  name?: string;
  repo?: string;
}

export function SyncLogTable() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [userOptions, setUserOptions] = useState<FilterOption[]>([]);
  const [repoOptions, setRepoOptions] = useState<FilterOption[]>([]);
  const [filters, setFilters] = useState({ userId: "", repoId: "", status: "" });

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.repoId) params.set("repoId", filters.repoId);
    if (filters.status) params.set("status", filters.status);

    const res = await fetch(`${basePath}/api/admin/sync-logs?${params}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setUserOptions(data.filters.users);
      setRepoOptions(data.filters.repos);
    }
  }, [filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={filters.userId} onValueChange={(v) => setFilters((f) => ({ ...f, userId: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="전체 사용자" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 사용자</SelectItem>
            {userOptions.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.repoId} onValueChange={(v) => setFilters((f) => ({ ...f, repoId: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="전체 저장소" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 저장소</SelectItem>
            {repoOptions.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.repo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="전체 상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="success">success</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>저장소</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>커밋</TableHead>
              <TableHead>태스크</TableHead>
              <TableHead>에러</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">
                  {log.completed_at ? new Date(log.completed_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                </TableCell>
                <TableCell>{log.repo_name}</TableCell>
                <TableCell className="text-muted-foreground">{log.user_name}</TableCell>
                <TableCell>
                  <Badge variant={log.status === "success" ? "default" : "destructive"}>
                    {log.status}
                  </Badge>
                </TableCell>
                <TableCell>{log.commits_processed}</TableCell>
                <TableCell>{log.tasks_created}</TableCell>
                <TableCell className="text-destructive text-sm max-w-[200px] truncate">
                  {log.error_message || "—"}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  동기화 로그가 없습니다
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 동기화 로그 페이지 작성**

`src/app/admin/sync-logs/page.tsx`:

```tsx
import { SyncLogTable } from "@/components/admin/sync-log-table";

export default function AdminSyncLogsPage() {
  return <SyncLogTable />;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/admin/sync-log-table.tsx src/app/admin/sync-logs/page.tsx
git commit -m "feat: 관리자 동기화 로그 페이지 — 필터 + 로그 테이블"
```

---

## Task 15: HRMS 로그 테이블 + 페이지

**Files:**
- Create: `src/components/admin/hrms-log-table.tsx`
- Create: `src/app/admin/hrms-logs/page.tsx`

- [ ] **Step 1: HRMS 로그 테이블 컴포넌트 작성**

`src/components/admin/hrms-log-table.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/data-display/stat-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface HrmsLog {
  id: number;
  created_at: string;
  user_name: string;
  hrms_project_name: string;
  target_date: string;
  title: string;
  status: string;
  error_message: string | null;
}

interface HrmsLogStats {
  total: number;
  success: number;
  error: number;
  skipped: number;
}

interface FilterOption {
  id?: number;
  name?: string;
  hrms_project_id?: number;
  hrms_project_name?: string;
}

const statusVariants: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  success: "default",
  error: "destructive",
  skipped: "secondary",
  in_progress: "outline",
};

export function HrmsLogTable() {
  const [logs, setLogs] = useState<HrmsLog[]>([]);
  const [stats, setStats] = useState<HrmsLogStats>({ total: 0, success: 0, error: 0, skipped: 0 });
  const [userOptions, setUserOptions] = useState<FilterOption[]>([]);
  const [projectOptions, setProjectOptions] = useState<FilterOption[]>([]);
  const [filters, setFilters] = useState({ userId: "", projectId: "", status: "", date: "" });

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.status) params.set("status", filters.status);
    if (filters.date) params.set("date", filters.date);

    const res = await fetch(`${basePath}/api/admin/hrms-logs?${params}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setStats(data.stats);
      setUserOptions(data.filters.users);
      setProjectOptions(data.filters.projects);
    }
  }, [filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="오늘 등록" value={stats.total} />
        <StatCard label="성공" value={stats.success} />
        <StatCard label="실패" value={stats.error} />
        <StatCard label="건너뜀" value={stats.skipped} />
      </div>

      <div className="flex gap-2">
        <Select value={filters.userId} onValueChange={(v) => setFilters((f) => ({ ...f, userId: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="전체 사용자" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 사용자</SelectItem>
            {userOptions.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.projectId} onValueChange={(v) => setFilters((f) => ({ ...f, projectId: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="전체 프로젝트" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 프로젝트</SelectItem>
            {projectOptions.map((p) => (
              <SelectItem key={p.hrms_project_id} value={String(p.hrms_project_id)}>
                {p.hrms_project_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="전체 상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="success">success</SelectItem>
            <SelectItem value="error">error</SelectItem>
            <SelectItem value="skipped">skipped</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filters.date}
          onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))}
          className="w-[160px]"
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>HRMS 프로젝트</TableHead>
              <TableHead>대상일</TableHead>
              <TableHead>업무 제목</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>에러</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell>{log.user_name}</TableCell>
                <TableCell>{log.hrms_project_name}</TableCell>
                <TableCell className="text-muted-foreground">{log.target_date}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{log.title || "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariants[log.status] || "secondary"}>
                    {log.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-destructive text-sm max-w-[200px] truncate">
                  {log.error_message || "—"}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  HRMS 등록 로그가 없습니다
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: HRMS 로그 페이지 작성**

`src/app/admin/hrms-logs/page.tsx`:

```tsx
import { HrmsLogTable } from "@/components/admin/hrms-log-table";

export default function AdminHrmsLogsPage() {
  return <HrmsLogTable />;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/admin/hrms-log-table.tsx src/app/admin/hrms-logs/page.tsx
git commit -m "feat: 관리자 HRMS 로그 페이지 — 통계 카드 + 필터 + 로그 테이블"
```

---

## Task 16: 환경변수 문서 + 빌드 검증

**Files:**
- Modify: `deploy/.env.example`

- [ ] **Step 1: `.env.example`에 `ADMIN_PASSWORD` 추가**

`deploy/.env.example`에 추가:

```
# Admin
ADMIN_PASSWORD=your-admin-password-here
```

- [ ] **Step 2: 전체 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add deploy/.env.example
git commit -m "chore: .env.example에 ADMIN_PASSWORD 추가"
```

---

## Task 17: 브라우저 수동 테스트

- [ ] **Step 1: 환경변수 설정**

`.env.local` 또는 `.env`에 추가:
```
ADMIN_PASSWORD=test1234
```

- [ ] **Step 2: 개발 서버 시작**

Run: `npm run dev`

- [ ] **Step 3: 인증 테스트**

1. 브라우저에서 `http://localhost:3000/briify/admin` 접근
2. 암호 입력 폼이 표시되는지 확인
3. 잘못된 암호 입력 → 에러 메시지 표시 확인
4. 올바른 암호 (`test1234`) 입력 → 관리자 화면 표시 확인
5. 브라우저 탭 닫고 다시 열기 → 다시 암호 입력 필요 확인

- [ ] **Step 4: 사용자 관리 테스트**

1. 사용자 목록이 표시되는지 확인
2. 통계 카드 (전체/활성/비활성) 숫자 확인
3. 비활성화 버튼 클릭 → 상태 변경 확인
4. 해당 사용자로 로그인 시도 → 거부되는지 확인
5. 다시 활성화 → 로그인 가능 확인

- [ ] **Step 5: 스케줄러 탭 테스트**

1. 스케줄러 상태 카드 표시 확인
2. 저장소 목록 + 4가지 토글 표시 확인
3. 동기화 토글 끄기 → 해당 사용자 대시보드에서 저장소 상태 변경 확인
4. HRMS/LogiCraft/보고서 토글 변경 → 해당 사용자 설정에 반영 확인

- [ ] **Step 6: 로그 탭 테스트**

1. 동기화 로그 탭 → 필터 동작 확인
2. HRMS 로그 탭 → 통계 카드 + 필터 + 로그 테이블 확인

- [ ] **Step 7: 로그아웃 테스트**

1. 로그아웃 버튼 클릭 → 암호 입력 폼으로 돌아가는지 확인
