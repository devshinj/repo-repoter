# HRMS MCP 통합 — 자동 업무 등록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HRMS MCP 엔드포인트를 통해 Git 커밋 기반 일일 업무를 HRMS에 자동/수동 등록하는 기능 구현

**Architecture:** Next.js 백엔드에서 HRMS MCP를 JSON-RPC over HTTP로 직접 호출. 사용자별 MCP Key 관리, HRMS 프로젝트↔저장소 매핑, 전일 커밋 수집→Gemini 요약→태스크 생성 파이프라인. 기존 레이어 규칙(app→infra/core, scheduler→infra/core, core 순수함수) 준수.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, better-sqlite3, node-cron, Gemini API, Tailwind CSS + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-06-11-hrms-mcp-integration-design.md`

---

### Task 1: DB 스키마 — HRMS 테이블 4개 추가

**Files:**
- Modify: `src/infra/db/schema.ts` — `createTables()` 함수에 테이블 추가

- [ ] **Step 1: createTables()에 HRMS 테이블 4개 추가**

`src/infra/db/schema.ts`의 `createTables()` 함수 내 기존 `db.exec()` 블록의 마지막 `CREATE INDEX` 구문들 뒤에 다음을 추가:

```typescript
    CREATE TABLE IF NOT EXISTS hrms_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      encrypted_key TEXT NOT NULL,
      hrms_user_name TEXT,
      scopes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hrms_project_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hrms_project_id INTEGER NOT NULL,
      hrms_project_name TEXT NOT NULL,
      auto_register INTEGER NOT NULL DEFAULT 0,
      cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, hrms_project_id)
    );

    CREATE TABLE IF NOT EXISTS hrms_mapping_repos (
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      PRIMARY KEY (mapping_id, repository_id)
    );

    CREATE TABLE IF NOT EXISTS hrms_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mapping_id INTEGER NOT NULL REFERENCES hrms_project_mappings(id) ON DELETE CASCADE,
      hrms_task_id INTEGER,
      target_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hrms_task_logs_mapping_date
      ON hrms_task_logs(mapping_id, target_date);

    CREATE INDEX IF NOT EXISTS idx_hrms_project_mappings_user
      ON hrms_project_mappings(user_id);
```

- [ ] **Step 2: 서버 재시작으로 테이블 생성 확인**

Run: `npm run build`
Expected: 빌드 성공. 서버 시작 시 `createTables()`가 자동 실행되어 테이블 생성.

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/schema.ts
git commit -m "feat: HRMS 통합을 위한 DB 테이블 4개 추가 (hrms_api_keys, hrms_project_mappings, hrms_mapping_repos, hrms_task_logs)"
```

---

### Task 2: DB 접근 함수 — HRMS Key 관리

**Files:**
- Create: `src/infra/db/hrms.ts`
- Test: `src/__tests__/infra/db/hrms.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/infra/db/hrms.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  upsertHrmsApiKey,
  getHrmsApiKey,
  deleteHrmsApiKey,
} from "@/infra/db/hrms";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  return db;
}

describe("hrms_api_keys", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts and retrieves an API key", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserName: "신재석",
      scopes: JSON.stringify({ resources: "all", permissions: ["read", "write", "create"] }),
    });

    const row = getHrmsApiKey(db, "user1");
    expect(row).not.toBeNull();
    expect(row!.encrypted_key).toBe("enc_abc");
    expect(row!.hrms_user_name).toBe("신재석");
  });

  it("upserts (updates on conflict)", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_old",
      hrmsUserName: "old",
      scopes: "{}",
    });
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_new",
      hrmsUserName: "new",
      scopes: "{}",
    });

    const row = getHrmsApiKey(db, "user1");
    expect(row!.encrypted_key).toBe("enc_new");
    expect(row!.hrms_user_name).toBe("new");
  });

  it("deletes an API key", () => {
    upsertHrmsApiKey(db, {
      userId: "user1",
      encryptedKey: "enc_abc",
      hrmsUserName: "test",
      scopes: "{}",
    });

    deleteHrmsApiKey(db, "user1");
    expect(getHrmsApiKey(db, "user1")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/hrms.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: DB 접근 함수 구현**

`src/infra/db/hrms.ts`:

```typescript
import Database from "better-sqlite3";

// ── hrms_api_keys ──

interface UpsertHrmsApiKeyInput {
  userId: string;
  encryptedKey: string;
  hrmsUserName: string | null;
  scopes: string | null;
}

export function upsertHrmsApiKey(db: Database.Database, input: UpsertHrmsApiKeyInput): void {
  db.prepare(
    `INSERT INTO hrms_api_keys (user_id, encrypted_key, hrms_user_name, scopes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       hrms_user_name = excluded.hrms_user_name,
       scopes = excluded.scopes,
       updated_at = datetime('now')`
  ).run(input.userId, input.encryptedKey, input.hrmsUserName, input.scopes);
}

export function getHrmsApiKey(db: Database.Database, userId: string) {
  return db.prepare(
    "SELECT * FROM hrms_api_keys WHERE user_id = ?"
  ).get(userId) as any | null;
}

export function deleteHrmsApiKey(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM hrms_api_keys WHERE user_id = ?").run(userId);
}

// ── hrms_project_mappings + hrms_mapping_repos ──

interface InsertMappingInput {
  userId: string;
  hrmsProjectId: number;
  hrmsProjectName: string;
  autoRegister: boolean;
  cronTime: string;
  repositoryIds: number[];
}

export function insertMapping(db: Database.Database, input: InsertMappingInput): number {
  const result = db.prepare(
    `INSERT INTO hrms_project_mappings (user_id, hrms_project_id, hrms_project_name, auto_register, cron_time)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.userId, input.hrmsProjectId, input.hrmsProjectName, input.autoRegister ? 1 : 0, input.cronTime);

  const mappingId = result.lastInsertRowid as number;

  const repoStmt = db.prepare(
    "INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (?, ?)"
  );
  for (const repoId of input.repositoryIds) {
    repoStmt.run(mappingId, repoId);
  }

  return mappingId;
}

export function getMappingsByUser(db: Database.Database, userId: string) {
  const mappings = db.prepare(
    "SELECT * FROM hrms_project_mappings WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[];

  return mappings.map((m: any) => {
    const repos = db.prepare(
      `SELECT r.id, r.owner, r.repo, r.label
       FROM hrms_mapping_repos mr
       JOIN repositories r ON r.id = mr.repository_id
       WHERE mr.mapping_id = ?`
    ).all(m.id) as any[];
    return { ...m, repos };
  });
}

export function getMappingById(db: Database.Database, id: number) {
  const mapping = db.prepare(
    "SELECT * FROM hrms_project_mappings WHERE id = ?"
  ).get(id) as any | null;

  if (!mapping) return null;

  const repos = db.prepare(
    `SELECT r.id, r.owner, r.repo, r.label
     FROM hrms_mapping_repos mr
     JOIN repositories r ON r.id = mr.repository_id
     WHERE mr.mapping_id = ?`
  ).all(id) as any[];

  return { ...mapping, repos };
}

interface UpdateMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
  repositoryIds?: number[];
}

export function updateMapping(db: Database.Database, id: number, input: UpdateMappingInput): void {
  if (input.hrmsProjectName !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET hrms_project_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.hrmsProjectName, id);
  }
  if (input.autoRegister !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET auto_register = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.autoRegister ? 1 : 0, id);
  }
  if (input.cronTime !== undefined) {
    db.prepare("UPDATE hrms_project_mappings SET cron_time = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.cronTime, id);
  }
  if (input.repositoryIds !== undefined) {
    db.prepare("DELETE FROM hrms_mapping_repos WHERE mapping_id = ?").run(id);
    const stmt = db.prepare("INSERT INTO hrms_mapping_repos (mapping_id, repository_id) VALUES (?, ?)");
    for (const repoId of input.repositoryIds) {
      stmt.run(id, repoId);
    }
  }
}

export function deleteMapping(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM hrms_project_mappings WHERE id = ?").run(id);
}

// ── hrms_task_logs ──

interface InsertTaskLogInput {
  mappingId: number;
  hrmsTaskId: number | null;
  targetDate: string;
  title: string;
  description: string;
  status: "success" | "error";
  errorMessage: string | null;
}

export function insertTaskLog(db: Database.Database, input: InsertTaskLogInput): void {
  db.prepare(
    `INSERT INTO hrms_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(input.mappingId, input.hrmsTaskId, input.targetDate, input.title, input.description, input.status, input.errorMessage);
}

export function getTaskLogs(db: Database.Database, userId: string, limit = 50) {
  return db.prepare(
    `SELECT tl.*, pm.hrms_project_name
     FROM hrms_task_logs tl
     JOIN hrms_project_mappings pm ON pm.id = tl.mapping_id
     WHERE pm.user_id = ?
     ORDER BY tl.created_at DESC
     LIMIT ?`
  ).all(userId, limit) as any[];
}

export function hasSuccessLog(db: Database.Database, mappingId: number, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM hrms_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' LIMIT 1"
  ).get(mappingId, targetDate);
  return !!row;
}

export function getAutoRegisterMappings(db: Database.Database) {
  return db.prepare(
    `SELECT pm.*, hak.encrypted_key
     FROM hrms_project_mappings pm
     JOIN hrms_api_keys hak ON hak.user_id = pm.user_id
     WHERE pm.auto_register = 1`
  ).all() as any[];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/hrms.test.ts`
Expected: PASS

- [ ] **Step 5: 매핑/로그 테스트 추가 및 실행**

`src/__tests__/infra/db/hrms.test.ts`에 다음 describe 블록을 추가:

```typescript
describe("hrms_project_mappings", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // 테스트용 저장소 삽입
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "org", "frontend", "main", "user1", "https://github.com/org/frontend");
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(2, "org", "backend", "main", "user1", "https://github.com/org/backend");
  });

  it("creates a mapping with repos and retrieves it", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: true,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1, 2],
    });

    const mappings = getMappingsByUser(db, "user1");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].hrms_project_name).toBe("CUVIA");
    expect(mappings[0].repos).toHaveLength(2);
  });

  it("updates mapping repos", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1, 2],
    });

    updateMapping(db, id, { repositoryIds: [1], autoRegister: true });

    const m = getMappingById(db, id);
    expect(m!.repos).toHaveLength(1);
    expect(m!.auto_register).toBe(1);
  });

  it("deletes mapping cascades to repos", () => {
    const id = insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1],
    });

    deleteMapping(db, id);
    expect(getMappingById(db, id)).toBeNull();
  });
});

describe("hrms_task_logs", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "org", "frontend", "main", "user1", "https://github.com/org/frontend");
    insertMapping(db, {
      userId: "user1",
      hrmsProjectId: 93,
      hrmsProjectName: "CUVIA",
      autoRegister: false,
      cronTime: "0 9 * * 1-5",
      repositoryIds: [1],
    });
  });

  it("inserts log and checks duplicate", () => {
    expect(hasSuccessLog(db, 1, "2026-06-10")).toBe(false);

    insertTaskLog(db, {
      mappingId: 1,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    expect(hasSuccessLog(db, 1, "2026-06-10")).toBe(true);
  });

  it("retrieves logs by user", () => {
    insertTaskLog(db, {
      mappingId: 1,
      hrmsTaskId: 8050,
      targetDate: "2026-06-10",
      title: "test",
      description: "desc",
      status: "success",
      errorMessage: null,
    });

    const logs = getTaskLogs(db, "user1");
    expect(logs).toHaveLength(1);
    expect(logs[0].hrms_project_name).toBe("CUVIA");
  });
});
```

import 문에 `insertMapping, getMappingsByUser, getMappingById, updateMapping, deleteMapping, insertTaskLog, getTaskLogs, hasSuccessLog`을 추가.

Run: `npx vitest run src/__tests__/infra/db/hrms.test.ts`
Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/infra/db/hrms.ts src/__tests__/infra/db/hrms.test.ts
git commit -m "feat: HRMS DB 접근 함수 구현 (api_keys, mappings, task_logs CRUD)"
```

---

### Task 3: HRMS MCP 클라이언트

**Files:**
- Create: `src/infra/hrms/hrms-client.ts`
- Test: `src/__tests__/infra/hrms/hrms-client.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/infra/hrms/hrms-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildJsonRpcPayload, parseToolResult, HrmsMcpError } from "@/infra/hrms/hrms-client";

describe("buildJsonRpcPayload", () => {
  it("builds valid JSON-RPC 2.0 payload", () => {
    const payload = buildJsonRpcPayload("whoami", {});
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.method).toBe("tools/call");
    expect(payload.params.name).toBe("whoami");
    expect(payload.params.arguments).toEqual({});
    expect(typeof payload.id).toBe("number");
  });
});

describe("parseToolResult", () => {
  it("extracts data from successful response", () => {
    const response = {
      result: {
        content: [{ type: "text", text: '{"data":{"user":{"name":"test"}},"warnings":[]}' }],
      },
      jsonrpc: "2.0",
      id: 1,
    };
    const data = parseToolResult(response);
    expect(data.data.user.name).toBe("test");
  });

  it("throws HrmsMcpError on JSON-RPC error", () => {
    const response = {
      error: { code: -32000, message: "Not found" },
      jsonrpc: "2.0",
      id: 1,
    };
    expect(() => parseToolResult(response)).toThrow(HrmsMcpError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/hrms/hrms-client.test.ts`
Expected: FAIL

- [ ] **Step 3: 클라이언트 구현**

`src/infra/hrms/hrms-client.ts`:

```typescript
const hrmsEndpoint = "https://hrms.cudo.co.kr:9700/api/mcp";

let requestId = 0;

export class HrmsMcpError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HrmsMcpError";
  }
}

export function buildJsonRpcPayload(toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: ++requestId,
    method: "tools/call" as const,
    params: { name: toolName, arguments: args },
  };
}

export function parseToolResult(response: any): any {
  if (response.error) {
    throw new HrmsMcpError(
      response.error.code?.toString() ?? "UNKNOWN",
      response.error.message ?? "Unknown MCP error",
    );
  }

  const textContent = response.result?.content?.find((c: any) => c.type === "text");
  if (!textContent?.text) {
    throw new HrmsMcpError("EMPTY_RESPONSE", "No text content in MCP response");
  }

  return JSON.parse(textContent.text);
}

async function callMcpTool(apiKey: string, toolName: string, args: Record<string, unknown>): Promise<any> {
  const payload = buildJsonRpcPayload(toolName, args);

  const res = await fetch(hrmsEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new HrmsMcpError("HTTP_ERROR", `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return parseToolResult(json);
}

// ── 비즈니스 함수 ──

export interface HrmsUserInfo {
  id: string;
  name: string;
  email: string;
  permissions: { can_read: boolean; can_write: boolean; can_create: boolean; can_delete: boolean };
}

export async function verifyApiKey(apiKey: string): Promise<HrmsUserInfo> {
  const result = await callMcpTool(apiKey, "whoami", {});
  return {
    id: result.data.user.id,
    name: result.data.user.name,
    email: result.data.user.email,
    permissions: result.my_permissions,
  };
}

export interface HrmsProject {
  id: number;
  name: string;
  description: string | null;
  status: string;
  projectType: string | null;
  teamId: number;
}

export async function listProjects(apiKey: string): Promise<HrmsProject[]> {
  const result = await callMcpTool(apiKey, "list_projects", {});
  return result.data.projects;
}

export async function getProject(apiKey: string, id: number): Promise<HrmsProject> {
  const result = await callMcpTool(apiKey, "get_project", { id });
  return result.data.project ?? result.data;
}

export interface CreateTaskParams {
  title: string;
  description: string;
  projectId: number;
  status?: string;
  priority?: string;
  dueDate?: string;
  timeSpentMinutes?: number;
}

export interface CreatedTask {
  id: number;
  title: string;
}

export async function createTask(apiKey: string, params: CreateTaskParams): Promise<CreatedTask> {
  const result = await callMcpTool(apiKey, "create_task", {
    title: params.title,
    description: params.description,
    projectId: params.projectId,
    status: params.status ?? "done",
    priority: params.priority ?? "medium",
    dueDate: params.dueDate,
    timeSpentMinutes: params.timeSpentMinutes,
  });
  return result.data?.task ?? result.data;
}

export async function listCommonCodes(apiKey: string, groupCode?: string) {
  const args: Record<string, unknown> = {};
  if (groupCode) args.groupCode = groupCode;
  const result = await callMcpTool(apiKey, "list_common_codes", args);
  return result.data;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/hrms/hrms-client.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/hrms/hrms-client.ts src/__tests__/infra/hrms/hrms-client.test.ts
git commit -m "feat: HRMS MCP JSON-RPC 클라이언트 구현"
```

---

### Task 4: 소요시간 추정 — core 순수 함수

**Files:**
- Create: `src/core/analyzer/time-estimator.ts`
- Test: `src/__tests__/core/time-estimator.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/core/time-estimator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";

function makeCommit(additions: number, deletions: number): CommitRecord {
  return {
    sha: "abc123",
    message: "test",
    author: "test",
    date: "2026-06-10T10:00:00Z",
    repoOwner: "org",
    repoName: "repo",
    branch: "main",
    filesChanged: ["file.ts"],
    additions,
    deletions,
  };
}

describe("estimateWorkMinutes", () => {
  it("returns 60 min minimum for empty commits", () => {
    expect(estimateWorkMinutes([])).toBe(60);
  });

  it("estimates 20 min for small commit (<=50 lines)", () => {
    expect(estimateWorkMinutes([makeCommit(10, 5)])).toBe(60); // 20 min but min is 60
  });

  it("estimates 40 min for medium commit (51-200 lines)", () => {
    expect(estimateWorkMinutes([makeCommit(100, 50)])).toBe(60); // 40 min but min is 60
  });

  it("estimates 60 min for large commit (>200 lines)", () => {
    expect(estimateWorkMinutes([makeCommit(200, 50)])).toBe(60);
  });

  it("sums multiple commits", () => {
    const commits = [
      makeCommit(100, 50),  // 40 min (medium)
      makeCommit(200, 50),  // 60 min (large)
      makeCommit(10, 5),    // 20 min (small)
    ];
    expect(estimateWorkMinutes(commits)).toBe(120); // 40+60+20 = 120
  });

  it("caps at 480 minutes (8 hours)", () => {
    const commits = Array(20).fill(null).map(() => makeCommit(300, 100)); // 20 * 60 = 1200
    expect(estimateWorkMinutes(commits)).toBe(480);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/core/time-estimator.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/core/analyzer/time-estimator.ts`:

```typescript
import type { CommitRecord } from "@/core/types";

export function estimateWorkMinutes(commits: CommitRecord[]): number {
  if (commits.length === 0) return 60;

  let total = 0;
  for (const c of commits) {
    const lines = c.additions + c.deletions;
    if (lines <= 50) total += 20;
    else if (lines <= 200) total += 40;
    else total += 60;
  }

  return Math.max(60, Math.min(480, total));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/core/time-estimator.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/analyzer/time-estimator.ts src/__tests__/core/time-estimator.test.ts
git commit -m "feat: 커밋 기반 소요시간 추정 순수 함수 구현"
```

---

### Task 5: Gemini 프롬프트 — HRMS 업무 요약용

**Files:**
- Modify: `src/infra/gemini/gemini-client.ts` — `buildHrmsTaskPrompt`, `generateHrmsTaskDescription` 추가
- Test: `src/__tests__/infra/gemini-client.test.ts` — 테스트 추가

- [ ] **Step 1: 테스트 추가**

`src/__tests__/infra/gemini-client.test.ts` 파일 끝에 다음 describe 추가:

```typescript
import { buildHrmsTaskPrompt } from "@/infra/gemini/gemini-client";

describe("buildHrmsTaskPrompt", () => {
  it("builds prompt with multiple repos and estimated time", () => {
    const prompt = buildHrmsTaskPrompt("CUVIA", "2026-06-10", [
      {
        repoName: "cuvia-frontend",
        commits: [sampleCommits[0]],
      },
      {
        repoName: "cuvia-backend",
        commits: [sampleCommits[1]],
      },
    ], 120);

    expect(prompt).toContain("CUVIA");
    expect(prompt).toContain("2026-06-10");
    expect(prompt).toContain("cuvia-frontend");
    expect(prompt).toContain("cuvia-backend");
    expect(prompt).toContain("120");
    expect(prompt).toContain("추정 총 작업 시간");
  });

  it("handles single repo", () => {
    const prompt = buildHrmsTaskPrompt("LogiCraft", "2026-06-10", [
      { repoName: "logicraft", commits: sampleCommits },
    ], 60);

    expect(prompt).toContain("LogiCraft");
    expect(prompt).toContain("logicraft");
    expect(prompt).toContain("2건");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/gemini-client.test.ts`
Expected: FAIL — `buildHrmsTaskPrompt` export 없음

- [ ] **Step 3: 구현**

`src/infra/gemini/gemini-client.ts` 파일 끝(`analyzeCommitWithDiff` 함수 아래)에 다음 추가:

```typescript
export function buildHrmsTaskPrompt(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number,
): string {
  const repoSections = repoCommits.map(({ repoName, commits }) => {
    const totalAdd = commits.reduce((s, c) => s + c.additions, 0);
    const totalDel = commits.reduce((s, c) => s + c.deletions, 0);
    const commitLines = commits
      .map((c) => `- [${c.sha.slice(0, 7)}] ${c.message} (+${c.additions}/-${c.deletions})`)
      .join("\n");
    return `## ${repoName} (${commits.length}건, +${totalAdd}/-${totalDel})\n${commitLines}`;
  }).join("\n\n");

  return `HRMS 프로젝트 "${projectName}"에서 ${date}에 수행된 작업을 업무 보고 형식으로 정리해주세요.

[저장소별 커밋 목록]
${repoSections}

추정 총 작업 시간: 약 ${estimatedMinutes}분

규칙:
- 관련 커밋을 논리적 작업 단위로 묶어 정리
- 각 작업 항목은 "- " 로 시작
- 마지막에 "추정 작업 시간: 약 N시간 M분" 을 기재 (${estimatedMinutes}분 기준)
- 한국어로 작성, 저장소명 언급 불필요 — 프로젝트 전체 관점에서 서술
- 텍스트만 응답 (JSON/마크다운 코드블록 불필요)`;
}

export async function generateHrmsTaskDescription(
  projectName: string,
  date: string,
  repoCommits: Array<{ repoName: string; commits: CommitRecord[] }>,
  estimatedMinutes: number,
): Promise<string> {
  const genai = getClient();
  const prompt = buildHrmsTaskPrompt(projectName, date, repoCommits, estimatedMinutes);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    })
  );

  return result.text ?? "";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/gemini-client.test.ts`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/gemini/gemini-client.ts src/__tests__/infra/gemini-client.test.ts
git commit -m "feat: HRMS 업무 요약용 Gemini 프롬프트 추가"
```

---

### Task 6: API Routes — MCP Key 관리

**Files:**
- Create: `src/app/api/hrms/key/route.ts`

- [ ] **Step 1: Key API route 구현**

`src/app/api/hrms/key/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey, upsertHrmsApiKey, deleteHrmsApiKey } from "@/infra/db/hrms";
import { encrypt, decrypt, maskToken } from "@/infra/crypto/token-encryption";
import { verifyApiKey } from "@/infra/hrms/hrms-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const row = getHrmsApiKey(db, session.user.id);

  if (!row) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
    hrmsUserName: row.hrms_user_name,
    scopes: row.scopes ? JSON.parse(row.scopes) : null,
    maskedKey: maskToken(decrypt(row.encrypted_key)),
    createdAt: row.created_at,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  if (!apiKey.startsWith("sk_")) {
    return NextResponse.json({ error: "Invalid API key format (must start with sk_)" }, { status: 400 });
  }

  try {
    const userInfo = await verifyApiKey(apiKey);

    if (!userInfo.permissions.can_create) {
      return NextResponse.json({ error: "API key must have 'create' permission for task registration" }, { status: 400 });
    }

    const db = getDb();
    upsertHrmsApiKey(db, {
      userId: session.user.id,
      encryptedKey: encrypt(apiKey),
      hrmsUserName: userInfo.name,
      scopes: JSON.stringify(userInfo.permissions),
    });

    return NextResponse.json({
      message: "API key registered",
      hrmsUserName: userInfo.name,
      permissions: userInfo.permissions,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: `HRMS verification failed: ${err.message}` }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  deleteHrmsApiKey(db, session.user.id);
  return NextResponse.json({ message: "API key deleted" });
}
```

- [ ] **Step 2: 수동 테스트**

서버 실행 후 개발자 도구 또는 curl로:
```bash
curl http://localhost:3000/api/hrms/key
```
Expected: `{ "registered": false }` (미등록 상태)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/hrms/key/route.ts
git commit -m "feat: HRMS MCP Key 관리 API route (GET/POST/DELETE)"
```

---

### Task 7: API Routes — HRMS 프로젝트/공통코드 프록시

**Files:**
- Create: `src/app/api/hrms/projects/route.ts`
- Create: `src/app/api/hrms/common-codes/route.ts`

- [ ] **Step 1: 프로젝트 목록 프록시 API**

`src/app/api/hrms/projects/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listProjects } from "@/infra/hrms/hrms-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const projects = await listProjects(apiKey);
    return NextResponse.json(projects);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
```

- [ ] **Step 2: 공통코드 프록시 API**

`src/app/api/hrms/common-codes/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listCommonCodes } from "@/infra/hrms/hrms-client";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const groupCode = request.nextUrl.searchParams.get("groupCode") ?? undefined;

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const codes = await listCommonCodes(apiKey, groupCode);
    return NextResponse.json(codes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/hrms/projects/route.ts src/app/api/hrms/common-codes/route.ts
git commit -m "feat: HRMS 프로젝트/공통코드 프록시 API route"
```

---

### Task 8: API Routes — 매핑 CRUD

**Files:**
- Create: `src/app/api/hrms/mappings/route.ts`
- Create: `src/app/api/hrms/mappings/[id]/route.ts`

- [ ] **Step 1: 매핑 목록/생성 API**

`src/app/api/hrms/mappings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey, getMappingsByUser, insertMapping } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { getProject } from "@/infra/hrms/hrms-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const mappings = getMappingsByUser(db, session.user.id);
  return NextResponse.json(mappings);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { hrmsProjectId, repositoryIds, autoRegister, cronTime } = body;

  if (!hrmsProjectId || !Array.isArray(repositoryIds) || repositoryIds.length === 0) {
    return NextResponse.json({ error: "hrmsProjectId and repositoryIds[] are required" }, { status: 400 });
  }

  const db = getDb();
  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const project = await getProject(apiKey, hrmsProjectId);

    const mappingId = insertMapping(db, {
      userId: session.user.id,
      hrmsProjectId,
      hrmsProjectName: project.name,
      autoRegister: autoRegister ?? false,
      cronTime: cronTime ?? "0 9 * * 1-5",
      repositoryIds,
    });

    return NextResponse.json({ id: mappingId, message: "Mapping created" }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
```

- [ ] **Step 2: 매핑 수정/삭제 API**

`src/app/api/hrms/mappings/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getMappingById, updateMapping, deleteMapping } from "@/infra/db/hrms";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const mappingId = parseInt(id, 10);
  const db = getDb();

  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const body = await request.json();
  updateMapping(db, mappingId, {
    hrmsProjectName: body.hrmsProjectName,
    autoRegister: body.autoRegister,
    cronTime: body.cronTime,
    repositoryIds: body.repositoryIds,
  });

  return NextResponse.json({ message: "Mapping updated" });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const mappingId = parseInt(id, 10);
  const db = getDb();

  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  deleteMapping(db, mappingId);
  return NextResponse.json({ message: "Mapping deleted" });
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/hrms/mappings/route.ts src/app/api/hrms/mappings/\[id\]/route.ts
git commit -m "feat: HRMS 프로젝트 매핑 CRUD API route"
```

---

### Task 9: API Routes — 업무 등록 트리거 + 이력

**Files:**
- Create: `src/app/api/hrms/register/route.ts`
- Create: `src/app/api/hrms/register/history/route.ts`

- [ ] **Step 1: 등록 실행 로직 (register route)**

`src/app/api/hrms/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import {
  getHrmsApiKey,
  getMappingById,
  hasSuccessLog,
  insertTaskLog,
} from "@/infra/db/hrms";
import { getCommitsByDateRange } from "@/infra/db/repository";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskDescription } from "@/infra/gemini/gemini-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { mappingId, targetDate } = body;

  if (!mappingId) {
    return NextResponse.json({ error: "mappingId is required" }, { status: 400 });
  }

  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const date = targetDate ?? getYesterdayDate();

  if (hasSuccessLog(db, mappingId, date)) {
    return NextResponse.json({ error: `Already registered for ${date}` }, { status: 409 });
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];

  if (cacheCommits.length === 0) {
    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "skip",
      description: "커밋 없음",
      status: "error",
      errorMessage: "No commits found for target date",
    });
    return NextResponse.json({ message: "No commits found", skipped: true });
  }

  // 저장소별로 커밋 그룹핑
  const repoMap = new Map<number, { repoName: string; commits: CommitRecord[] }>();
  for (const repo of mapping.repos) {
    repoMap.set(repo.id, {
      repoName: repo.label || `${repo.owner}/${repo.repo}`,
      commits: [],
    });
  }
  for (const c of cacheCommits) {
    const entry = repoMap.get(c.repository_id);
    if (entry) {
      entry.commits.push({
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: c.committed_at,
        repoOwner: "",
        repoName: "",
        branch: c.branch,
        filesChanged: [],
        additions: 0,
        deletions: 0,
      });
    }
  }

  const repoCommits = Array.from(repoMap.values()).filter((r) => r.commits.length > 0);
  const allCommits = repoCommits.flatMap((r) => r.commits);
  const estimatedMinutes = estimateWorkMinutes(allCommits);

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const description = await generateHrmsTaskDescription(
      mapping.hrms_project_name,
      date,
      repoCommits,
      estimatedMinutes,
    );
    const title = `[${mapping.hrms_project_name}] ${date} 개발 업무`;

    const created = await createTask(apiKey, {
      title,
      description,
      projectId: mapping.hrms_project_id,
      status: "done",
      priority: "medium",
      dueDate: date,
      timeSpentMinutes: estimatedMinutes,
    });

    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
    });

    return NextResponse.json({
      message: "Task registered",
      hrmsTaskId: created.id,
      title,
      estimatedMinutes,
    }, { status: 201 });
  } catch (err: any) {
    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: `[${mapping.hrms_project_name}] ${date} 개발 업무`,
      description: "",
      status: "error",
      errorMessage: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 이력 조회 API**

`src/app/api/hrms/register/history/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getTaskLogs } from "@/infra/db/hrms";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const db = getDb();
  const logs = getTaskLogs(db, session.user.id, limit);
  return NextResponse.json(logs);
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/hrms/register/route.ts src/app/api/hrms/register/history/route.ts
git commit -m "feat: HRMS 업무 등록 실행 + 이력 조회 API route"
```

---

### Task 10: HRMS 자동 등록 스케줄러

**Files:**
- Create: `src/scheduler/hrms-scheduler.ts`
- Modify: `instrumentation.ts`

- [ ] **Step 1: 스케줄러 구현**

`src/scheduler/hrms-scheduler.ts`:

```typescript
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/infra/db/connection";
import {
  getAutoRegisterMappings,
  getMappingById,
  hasSuccessLog,
  insertTaskLog,
} from "@/infra/db/hrms";
import { getCommitsByDateRange } from "@/infra/db/repository";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskDescription } from "@/infra/gemini/gemini-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";

const jobs = new Map<number, ScheduledTask>();

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function executeRegistration(mappingId: number): Promise<void> {
  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping) return;

  const date = getYesterdayDate();

  if (hasSuccessLog(db, mappingId, date)) {
    console.log(`[HrmsScheduler] mapping=${mappingId}: already registered for ${date}, skipping`);
    return;
  }

  const keyRow = db.prepare("SELECT encrypted_key FROM hrms_api_keys WHERE user_id = ?").get(mapping.user_id) as any;
  if (!keyRow) {
    console.error(`[HrmsScheduler] mapping=${mappingId}: no API key for user`);
    return;
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];

  if (cacheCommits.length === 0) {
    console.log(`[HrmsScheduler] mapping=${mappingId}: no commits on ${date}, skipping`);
    return;
  }

  const repoMap = new Map<number, { repoName: string; commits: CommitRecord[] }>();
  for (const repo of mapping.repos) {
    repoMap.set(repo.id, {
      repoName: repo.label || `${repo.owner}/${repo.repo}`,
      commits: [],
    });
  }
  for (const c of cacheCommits) {
    const entry = repoMap.get(c.repository_id);
    if (entry) {
      entry.commits.push({
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: c.committed_at,
        repoOwner: "",
        repoName: "",
        branch: c.branch,
        filesChanged: [],
        additions: 0,
        deletions: 0,
      });
    }
  }

  const repoCommits = Array.from(repoMap.values()).filter((r) => r.commits.length > 0);
  const allCommits = repoCommits.flatMap((r) => r.commits);
  const estimatedMinutes = estimateWorkMinutes(allCommits);
  const title = `[${mapping.hrms_project_name}] ${date} 개발 업무`;

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const description = await generateHrmsTaskDescription(
      mapping.hrms_project_name,
      date,
      repoCommits,
      estimatedMinutes,
    );

    const created = await createTask(apiKey, {
      title,
      description,
      projectId: mapping.hrms_project_id,
      status: "done",
      priority: "medium",
      dueDate: date,
      timeSpentMinutes: estimatedMinutes,
    });

    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
    });

    console.log(`[HrmsScheduler] mapping=${mappingId}: registered task #${created.id} for ${date}`);
  } catch (err: any) {
    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title,
      description: "",
      status: "error",
      errorMessage: err.message,
    });
    console.error(`[HrmsScheduler] mapping=${mappingId}: failed -`, err.message);
  }
}

export function refreshJob(mappingId: number): void {
  // 기존 job 제거
  const existing = jobs.get(mappingId);
  if (existing) {
    existing.stop();
    jobs.delete(mappingId);
  }

  // 매핑이 auto_register=true이면 새 job 등록
  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping || !mapping.auto_register) return;

  const cronExpr = mapping.cron_time || "0 9 * * 1-5";
  const task = cron.schedule(cronExpr, () => {
    executeRegistration(mappingId).catch(console.error);
  });
  jobs.set(mappingId, task);
  console.log(`[HrmsScheduler] Job registered for mapping=${mappingId} (${cronExpr})`);
}

export function startHrmsScheduler(): void {
  const db = getDb();
  const mappings = getAutoRegisterMappings(db);

  for (const m of mappings) {
    const cronExpr = m.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeRegistration(m.id).catch(console.error);
    });
    jobs.set(m.id, task);
  }

  console.log(`[HrmsScheduler] Started — ${mappings.length} auto-register jobs`);
}

export function stopHrmsScheduler(): void {
  for (const [id, task] of jobs) {
    task.stop();
  }
  jobs.clear();
  console.log("[HrmsScheduler] Stopped");
}
```

- [ ] **Step 2: instrumentation.ts에 스케줄러 등록**

`instrumentation.ts`를 다음으로 수정:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/scheduler/polling-manager");
    const { startReportScheduler } = await import("@/scheduler/report-scheduler");
    const { startHrmsScheduler } = await import("@/scheduler/hrms-scheduler");
    startScheduler(15);
    startReportScheduler();
    startHrmsScheduler();
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/scheduler/hrms-scheduler.ts instrumentation.ts
git commit -m "feat: HRMS 자동 업무 등록 스케줄러 구현"
```

---

### Task 11: 사이드바 메뉴 추가

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: navItems에 HRMS 메뉴 추가**

`src/components/layout/sidebar.tsx`에서 `lucide-react` import에 `Briefcase`를 추가:

```typescript
import { LayoutDashboard, GitFork, CalendarDays, FileText, Settings, LogOut, ExternalLink, Briefcase } from "lucide-react";
```

`navItems` 배열의 `Settings` 항목 앞에 HRMS 메뉴 추가:

```typescript
const navItems = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/repos", label: "저장소 관리", icon: GitFork },
  { href: "/task-calendar", label: "태스크 캘린더", icon: CalendarDays },
  { href: "/reports", label: "업무 보고서", icon: FileText },
  { href: "/hrms", label: "HRMS 업무 관리", icon: Briefcase },
  { href: "/settings", label: "설정", icon: Settings },
];
```

- [ ] **Step 2: 기존 HRMS 태스크 외부 링크 제거**

사이드바에서 기존 `HRMS 태스크` 외부 링크 버튼(`<a href="https://hrms.cudo.co.kr:9700/tasks">`)과 그 위의 `<Separator>` 를 제거. 이제 navItems에 내부 페이지가 있으므로 불필요.

- [ ] **Step 3: 브라우저에서 사이드바 확인**

서버 시작 후 사이드바에서 "HRMS 업무 관리" 메뉴 항목이 표시되는지, 클릭 시 `/hrms`로 이동하는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: 사이드바에 HRMS 업무 관리 메뉴 추가"
```

---

### Task 12: UI 페이지 — HRMS 업무 관리

**Files:**
- Create: `src/app/(dashboard)/hrms/page.tsx`
- Create: `src/components/hrms/api-key-form.tsx`
- Create: `src/components/hrms/mapping-card.tsx`
- Create: `src/components/hrms/mapping-modal.tsx`
- Create: `src/components/hrms/register-history.tsx`

이 태스크는 UI 컴포넌트가 많아 하위 단계별로 진행한다.

- [ ] **Step 1: API Key 등록 폼 컴포넌트**

`src/components/hrms/api-key-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";

interface ApiKeyFormProps {
  onRegistered: () => void;
}

export function ApiKeyForm({ onRegistered }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/hrms/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      onRegistered();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-lg mx-auto mt-12">
      <CardHeader className="text-center">
        <KeyRound className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
        <CardTitle>HRMS MCP API Key 등록</CardTitle>
        <CardDescription>
          HRMS 업무 자동 등록을 사용하려면 MCP API Key를 먼저 등록해주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <a
          href="https://mc1024.notion.site/HRMS-MCP-37b60ffc8ee08012bc4af8cbd6d00e73"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          사용 가이드 보기
        </a>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="password"
            placeholder="sk_xxxxxxxx_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !apiKey}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "등록"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 매핑 카드 컴포넌트**

`src/components/hrms/mapping-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pencil, Trash2, Loader2 } from "lucide-react";

interface MappingCardProps {
  mapping: any;
  onRegister: (mappingId: number) => Promise<void>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
}

export function MappingCard({ mapping, onRegister, onEdit, onDelete }: MappingCardProps) {
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleRegister() {
    setRegistering(true);
    try {
      await onRegister(mapping.id);
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete() {
    if (!confirm("이 매핑을 삭제하시겠습니까?")) return;
    setDeleting(true);
    try {
      await onDelete(mapping.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{mapping.hrms_project_name}</CardTitle>
          <Badge variant={mapping.auto_register ? "default" : "secondary"}>
            {mapping.auto_register ? `자동 ${mapping.cron_time}` : "수동"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          저장소: {mapping.repos.map((r: any) => r.label || `${r.owner}/${r.repo}`).join(", ")}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRegister} disabled={registering}>
            {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span className="ml-1">수동 등록</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEdit(mapping)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: 매핑 추가/수정 모달 컴포넌트**

`src/components/hrms/mapping-modal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface MappingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editing?: any;
}

export function MappingModal({ open, onClose, onSave, editing }: MappingModalProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [autoRegister, setAutoRegister] = useState(false);
  const [cronTime, setCronTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/hrms/projects").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
    ])
      .then(([p, r]) => {
        setProjects(Array.isArray(p) ? p : []);
        setRepos(Array.isArray(r) ? r : []);
      })
      .catch(() => setError("데이터를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (editing) {
      setSelectedProjectId(String(editing.hrms_project_id));
      setSelectedRepoIds(editing.repos.map((r: any) => r.id));
      setAutoRegister(!!editing.auto_register);
      const timeParts = (editing.cron_time || "0 9 * * 1-5").split(" ");
      setCronTime(`${timeParts[1]?.padStart(2, "0")}:${timeParts[0]?.padStart(2, "0")}`);
    } else {
      setSelectedProjectId("");
      setSelectedRepoIds([]);
      setAutoRegister(false);
      setCronTime("09:00");
    }
  }, [editing, open]);

  function toggleRepo(repoId: number) {
    setSelectedRepoIds((prev) =>
      prev.includes(repoId) ? prev.filter((id) => id !== repoId) : [...prev, repoId]
    );
  }

  async function handleSave() {
    if (!selectedProjectId || selectedRepoIds.length === 0) {
      setError("프로젝트와 저장소를 선택해주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const [hour, minute] = cronTime.split(":").map(Number);
    const cronExpr = `${minute} ${hour} * * 1-5`;

    const payload = {
      hrmsProjectId: parseInt(selectedProjectId, 10),
      repositoryIds: selectedRepoIds,
      autoRegister,
      cronTime: cronExpr,
    };

    try {
      const url = editing ? `/api/hrms/mappings/${editing.id}` : "/api/hrms/mappings";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        return;
      }

      onSave();
      onClose();
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "프로젝트 매핑 수정" : "프로젝트 매핑 추가"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>HRMS 프로젝트</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>연결할 저장소</Label>
              <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
                {repos.map((r: any) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedRepoIds.includes(r.id)}
                      onCheckedChange={() => toggleRepo(r.id)}
                    />
                    {r.label || `${r.owner}/${r.repo}`}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>자동 등록</Label>
              <Switch checked={autoRegister} onCheckedChange={setAutoRegister} />
            </div>

            {autoRegister && (
              <div className="space-y-2">
                <Label>등록 시각</Label>
                <Input type="time" value={cronTime} onChange={(e) => setCronTime(e.target.value)} />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: 등록 이력 테이블 컴포넌트**

`src/components/hrms/register-history.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";

interface RegisterHistoryProps {
  logs: any[];
}

export function RegisterHistory({ logs }: RegisterHistoryProps) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">등록 이력이 없습니다.</p>;
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium">날짜</th>
            <th className="text-left px-3 py-2 font-medium">프로젝트</th>
            <th className="text-left px-3 py-2 font-medium">상태</th>
            <th className="text-left px-3 py-2 font-medium">제목</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <tr key={log.id} className="border-t">
              <td className="px-3 py-2">{log.target_date}</td>
              <td className="px-3 py-2">{log.hrms_project_name}</td>
              <td className="px-3 py-2">
                <Badge variant={log.status === "success" ? "default" : "destructive"}>
                  {log.status === "success" ? "성공" : "실패"}
                </Badge>
              </td>
              <td className="px-3 py-2 truncate max-w-xs">
                {log.status === "error" ? log.error_message : log.title}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: 메인 페이지 조합**

참고: `PageContainer`는 `(dashboard)/layout.tsx`에서 감싸고 있으므로 페이지에서는 직접 사용하지 않는다. 페이지는 children만 반환하면 된다.

`src/app/(dashboard)/hrms/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Info } from "lucide-react";
import { ApiKeyForm } from "@/components/hrms/api-key-form";
import { MappingCard } from "@/components/hrms/mapping-card";
import { MappingModal } from "@/components/hrms/mapping-modal";
import { RegisterHistory } from "@/components/hrms/register-history";

export default function HrmsPage() {
  const [keyInfo, setKeyInfo] = useState<any>(null);
  const [mappings, setMappings] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const loadData = useCallback(async () => {
    try {
      const keyRes = await fetch("/api/hrms/key");
      const keyData = await keyRes.json();
      setKeyInfo(keyData);

      if (keyData.registered) {
        const [mappingsRes, logsRes] = await Promise.all([
          fetch("/api/hrms/mappings"),
          fetch("/api/hrms/register/history?limit=20"),
        ]);
        setMappings(await mappingsRes.json());
        setLogs(await logsRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRegister(mappingId: number) {
    const res = await fetch("/api/hrms/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingId }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error);
    else alert(data.skipped ? "커밋 없음 — 등록 건너뜀" : `등록 완료 (HRMS #${data.hrmsTaskId})`);
    loadData();
  }

  async function handleDelete(mappingId: number) {
    const res = await fetch(`/api/hrms/mappings/${mappingId}`, { method: "DELETE" });
    if (res.ok) loadData();
  }

  async function handleDeleteKey() {
    if (!confirm("API Key를 삭제하시겠습니까? 모든 매핑의 자동 등록이 중단됩니다.")) return;
    await fetch("/api/hrms/key", { method: "DELETE" });
    setKeyInfo(null);
    setMappings([]);
    setLogs([]);
    loadData();
  }

  if (loading) return <div />;

  if (!keyInfo?.registered) {
    return <ApiKeyForm onRegistered={loadData} />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">HRMS 업무 관리</h1>
        <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 프로젝트 매핑 추가
        </Button>
      </div>

      {/* 사용자 정보 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          연결: <span className="font-medium text-foreground">{keyInfo.hrmsUserName}</span>
          {" "}({keyInfo.maskedKey})
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleDeleteKey}>Key 삭제</Button>
        </div>
      </div>

      {/* 안내 문구 */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>자동 등록은 설정된 시각에 전일 업무를 HRMS에 등록합니다. 전일 하루 동안의 커밋을 분석하여 업무 내용을 작성합니다.</span>
      </div>

      {/* 매핑 카드 목록 */}
      <div className="grid gap-4">
        {mappings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            프로젝트 매핑이 없습니다. 위 버튼으로 추가해주세요.
          </p>
        ) : (
          mappings.map((m: any) => (
            <MappingCard
              key={m.id}
              mapping={m}
              onRegister={handleRegister}
              onEdit={(mapping) => { setEditing(mapping); setModalOpen(true); }}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* 등록 이력 */}
      <div>
        <h3 className="text-sm font-medium mb-3">등록 이력</h3>
        <RegisterHistory logs={logs} />
      </div>

      <MappingModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={loadData}
        editing={editing}
      />
    </div>
  );
}
```

- [ ] **Step 6: 브라우저에서 전체 동작 확인**

서버 시작 후 `/hrms` 페이지에서:
1. Key 미등록 시 → API Key 등록 폼 표시, 가이드 링크 동작
2. Key 등록 → whoami 검증 → 사용자 정보 표시
3. 프로젝트 매핑 추가 → HRMS 프로젝트 선택, 저장소 체크, 자동등록 설정
4. 수동 등록 버튼 → 전일 커밋 수집 → Gemini 요약 → HRMS 태스크 생성
5. 등록 이력 테이블에 결과 표시

- [ ] **Step 7: 커밋**

```bash
git add src/app/\(dashboard\)/hrms/page.tsx src/components/hrms/
git commit -m "feat: HRMS 업무 관리 UI 페이지 구현"
```

---

### Task 13: 스케줄러 ↔ 매핑 API 연동

매핑 생성/수정/삭제 시 스케줄러 job을 동기화하는 연동.

**Files:**
- Modify: `src/app/api/hrms/mappings/route.ts`
- Modify: `src/app/api/hrms/mappings/[id]/route.ts`

- [ ] **Step 1: 매핑 생성 시 스케줄러 등록**

`src/app/api/hrms/mappings/route.ts`의 POST 함수에서 `insertMapping()` 호출 후, `refreshJob()` 호출 추가:

```typescript
import { refreshJob } from "@/scheduler/hrms-scheduler";

// POST 함수 내, return 직전:
    refreshJob(mappingId);

    return NextResponse.json({ id: mappingId, message: "Mapping created" }, { status: 201 });
```

- [ ] **Step 2: 매핑 수정/삭제 시 스케줄러 갱신**

`src/app/api/hrms/mappings/[id]/route.ts`에 import 추가 및 호출:

```typescript
import { refreshJob } from "@/scheduler/hrms-scheduler";

// PUT 함수 내, return 직전:
  refreshJob(mappingId);
  return NextResponse.json({ message: "Mapping updated" });

// DELETE 함수 내, deleteMapping() 후:
  refreshJob(mappingId); // mapping 삭제 후 호출하면 job만 제거됨
  return NextResponse.json({ message: "Mapping deleted" });
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/hrms/mappings/route.ts src/app/api/hrms/mappings/\[id\]/route.ts
git commit -m "feat: 매핑 변경 시 HRMS 스케줄러 job 동기화"
```

---

### Task 14: shadcn/ui 컴포넌트 사전 설치

UI에서 사용하는 shadcn/ui 컴포넌트 중 아직 설치되지 않은 것들을 확인하고 설치.

**Files:** (자동 생성됨)

- [ ] **Step 1: 누락 컴포넌트 확인 및 설치**

UI에서 사용하는 컴포넌트: Dialog, Switch, Checkbox, Select, Label, Badge, Card, Button, Input.
기존에 없는 컴포넌트만 설치:

```bash
ls src/components/ui/
```

누락된 컴포넌트에 대해:
```bash
npx shadcn@latest add dialog switch checkbox select label
```

(이미 있는 것은 건너뛴다)

- [ ] **Step 2: 커밋**

```bash
git add src/components/ui/
git commit -m "chore: HRMS UI에 필요한 shadcn/ui 컴포넌트 추가"
```

---

### Task 15: 빌드 검증 및 통합 테스트

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 모든 기존 테스트 + 신규 테스트 PASS

- [ ] **Step 2: 빌드 성공 확인**

```bash
npm run build
```

Expected: 빌드 성공, 타입 에러 없음

- [ ] **Step 3: E2E 수동 테스트**

서버 실행 후 전체 흐름 수동 검증:
1. `/hrms` 접속 → Key 등록 폼
2. MCP Key 등록 → whoami 검증 → 사용자 정보 표시
3. 프로젝트 매핑 추가 (HRMS 프로젝트 선택 + 저장소 연결 + 자동등록 ON)
4. 수동 등록 → 전일 커밋 수집 → Gemini 요약 → HRMS 태스크 생성 확인
5. 등록 이력 확인
6. HRMS 웹에서 실제 태스크 생성 확인 (https://hrms.cudo.co.kr:9700/tasks)

- [ ] **Step 4: 최종 커밋 (필요시)**

빌드/테스트 중 발견된 이슈 수정 후 커밋.
