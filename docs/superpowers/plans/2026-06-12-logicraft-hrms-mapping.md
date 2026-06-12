# LogiCraft HRMS 매핑 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HRMS 업무 등록 시스템에 LogiCraft 설계 산출물 기반 업무 이력 등록 기능을 추가한다.

**Architecture:** 기존 repo 매핑과 병렬로 별도 테이블/클라이언트/API를 신설한다. LogiCraft MCP 엔드포인트(`https://logicraft.cudo.co.kr:10000/api/mcp`)에 JSON-RPC 2.0으로 호출하여 일일 수정 ITEM을 수집하고, Gemini로 요약한 뒤 HRMS 태스크로 등록한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, SQLite (better-sqlite3), JSON-RPC 2.0, Gemini API, node-cron, shadcn/ui

---

## File Structure

```
신규:
  src/core/types.ts                          — LogiCraft 관련 타입 추가
  src/infra/logicraft/logicraft-client.ts    — LogiCraft MCP JSON-RPC 클라이언트
  src/infra/db/logicraft.ts                  — LogiCraft DB 접근 함수
  src/app/api/logicraft/key/route.ts         — API key CRUD
  src/app/api/logicraft/verify/route.ts      — API key 검증 + 프로젝트 목록
  src/app/api/logicraft/mappings/route.ts    — 매핑 GET/POST
  src/app/api/logicraft/mappings/[id]/route.ts — 매핑 PUT/DELETE
  src/app/api/logicraft/register/route.ts    — 업무 등록
  src/app/api/logicraft/tasks/route.ts       — 등록 이력 조회
  src/components/hrms/logicraft-mapping-modal.tsx  — 매핑 생성/수정 모달
  src/components/hrms/logicraft-mapping-card.tsx   — LogiCraft 매핑 카드

변경:
  src/infra/db/schema.ts                     — 3개 테이블 + 마이그레이션 추가
  src/infra/gemini/gemini-client.ts          — LogiCraft 전용 프롬프트 + 생성 함수
  src/app/(dashboard)/hrms/page.tsx          — LogiCraft 섹션 통합
  src/scheduler/hrms-scheduler.ts            — LogiCraft 자동 등록 job 추가
```

---

### Task 1: 타입 정의 + DB 스키마

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/infra/db/schema.ts`

- [ ] **Step 1: core/types.ts에 LogiCraft 타입 추가**

`src/core/types.ts` 파일 끝에 다음 타입을 추가한다:

```typescript
/** LogiCraft 프로젝트 정보 */
export interface LogicraftProject {
  id: string; // UUID
  name: string;
  description: string | null;
  visibility: string;
}

/** LogiCraft ITEM 요약 (list_items 응답) */
export interface LogicraftItemSummary {
  id: string;        // e.g. "REQ-005"
  type: string;       // e.g. "requirement"
  title: string;
  status: string;
  domain_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/** LogiCraft 변경 제안 요약 */
export interface LogicraftProposal {
  id: string;
  target_id: string;
  status: string;     // "open" | "accepted" | "rejected" | "conflict" | "withdrawn"
  rationale: string;
  created_at: string;
  resolved_at: string | null;
}

/** LogiCraft 일일 활동 수집 결과 */
export interface LogicraftDailyActivity {
  projectName: string;
  date: string;
  modifiedItems: LogicraftItemSummary[];
  proposals: LogicraftProposal[];
}
```

- [ ] **Step 2: schema.ts의 createTables에 3개 테이블 추가**

`src/infra/db/schema.ts`의 `createTables` 함수 내부, 기존 `CREATE INDEX IF NOT EXISTS idx_hrms_project_mappings_user` 뒤에 다음을 추가한다:

```sql
CREATE TABLE IF NOT EXISTS logicraft_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hrms_logicraft_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  hrms_project_id INTEGER NOT NULL,
  hrms_project_name TEXT NOT NULL,
  logicraft_project_id TEXT NOT NULL,
  logicraft_project_name TEXT NOT NULL,
  auto_register INTEGER NOT NULL DEFAULT 0,
  cron_time TEXT NOT NULL DEFAULT '0 9 * * 1-5',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, logicraft_project_id)
);

CREATE TABLE IF NOT EXISTS hrms_logicraft_task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES hrms_logicraft_mappings(id) ON DELETE CASCADE,
  hrms_task_id INTEGER,
  target_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_task_logs_mapping_date_status
  ON hrms_logicraft_task_logs(mapping_id, target_date, status);

CREATE INDEX IF NOT EXISTS idx_hrms_logicraft_mappings_user
  ON hrms_logicraft_mappings(user_id);
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/core/types.ts src/infra/db/schema.ts
git commit -m "feat: LogiCraft 타입 정의 및 DB 스키마 추가"
```

---

### Task 2: LogiCraft MCP 클라이언트

**Files:**
- Create: `src/infra/logicraft/logicraft-client.ts`

- [ ] **Step 1: logicraft-client.ts 작성**

`src/infra/logicraft/logicraft-client.ts`를 생성한다. HRMS 클라이언트(`src/infra/hrms/hrms-client.ts`)와 동일한 JSON-RPC 2.0 패턴을 따른다:

```typescript
import type { LogicraftProject, LogicraftItemSummary, LogicraftProposal } from "@/core/types";

const logicraftEndpoint = "https://logicraft.cudo.co.kr:10000/api/mcp";

let requestId = 0;

export class LogicraftMcpError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LogicraftMcpError";
  }
}

function buildJsonRpcPayload(toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: ++requestId,
    method: "tools/call" as const,
    params: { name: toolName, arguments: args },
  };
}

function parseToolResult(response: any): any {
  if (response.error) {
    throw new LogicraftMcpError(
      response.error.code?.toString() ?? "UNKNOWN",
      response.error.message ?? "Unknown MCP error",
    );
  }

  const textContent = response.result?.content?.find((c: any) => c.type === "text");
  if (!textContent?.text) {
    throw new LogicraftMcpError("EMPTY_RESPONSE", "No text content in MCP response");
  }

  return JSON.parse(textContent.text);
}

async function callMcpTool(apiKey: string, toolName: string, args: Record<string, unknown>): Promise<any> {
  const payload = buildJsonRpcPayload(toolName, args);

  const res = await fetch(logicraftEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new LogicraftMcpError("HTTP_ERROR", `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return parseToolResult(json);
}

// ── Business functions ──

export async function verifyApiKey(apiKey: string): Promise<LogicraftProject[]> {
  return listProjects(apiKey);
}

export async function listProjects(apiKey: string): Promise<LogicraftProject[]> {
  const result = await callMcpTool(apiKey, "list_projects", {});
  return result.projects ?? result.data?.projects ?? [];
}

export async function listItems(
  apiKey: string,
  projectId: string,
  type: string,
  options?: { limit?: number; offset?: number },
): Promise<LogicraftItemSummary[]> {
  const args: Record<string, unknown> = { project_id: projectId, type };
  if (options?.limit) args.limit = options.limit;
  if (options?.offset) args.offset = options.offset;
  const result = await callMcpTool(apiKey, "list_items", args);
  return result.items ?? result.data?.items ?? [];
}

export async function listProposals(
  apiKey: string,
  projectId: string,
  status?: string,
): Promise<LogicraftProposal[]> {
  const args: Record<string, unknown> = { project_id: projectId };
  if (status) args.status = status;
  const result = await callMcpTool(apiKey, "list_proposals", args);
  return result.proposals ?? result.data?.proposals ?? [];
}

export async function getItem(
  apiKey: string,
  projectId: string,
  id: string,
): Promise<any> {
  const result = await callMcpTool(apiKey, "get_item", { project_id: projectId, id });
  return result.item ?? result.data?.item ?? result;
}

export async function listNotes(
  apiKey: string,
  projectId: string,
  search?: string,
): Promise<any[]> {
  const args: Record<string, unknown> = { project_id: projectId };
  if (search) args.search = search;
  const result = await callMcpTool(apiKey, "list_notes", args);
  return result.notes ?? result.data?.notes ?? [];
}

/** 주요 ITEM 타입 목록 — 일일 활동 수집 시 순회 대상 */
export const activityItemTypes = [
  "requirement",
  "feature",
  "adr",
  "domain_feature",
  "api_endpoint",
  "screen_spec",
  "domain",
  "use_case",
  "erd",
  "diagram_sequence",
  "test_scenario",
] as const;
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/infra/logicraft/logicraft-client.ts
git commit -m "feat: LogiCraft MCP JSON-RPC 클라이언트 추가"
```

---

### Task 3: DB 접근 레이어

**Files:**
- Create: `src/infra/db/logicraft.ts`

- [ ] **Step 1: logicraft.ts 작성**

`src/infra/db/logicraft.ts`를 생성한다. `src/infra/db/hrms.ts`와 동일한 패턴:

```typescript
import Database from "better-sqlite3";

// ── logicraft_api_keys ──

export function upsertLogicraftApiKey(
  db: Database.Database,
  input: { userId: string; encryptedKey: string },
): void {
  db.prepare(
    `INSERT INTO logicraft_api_keys (user_id, encrypted_key)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       updated_at = datetime('now')`,
  ).run(input.userId, input.encryptedKey);
}

export function getLogicraftApiKey(db: Database.Database, userId: string) {
  return (
    (db
      .prepare(
        "SELECT id, user_id, encrypted_key, created_at, updated_at FROM logicraft_api_keys WHERE user_id = ?",
      )
      .get(userId) as any) ?? null
  );
}

export function deleteLogicraftApiKey(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM logicraft_api_keys WHERE user_id = ?").run(userId);
}

// ── hrms_logicraft_mappings ──

interface InsertLogicraftMappingInput {
  userId: string;
  hrmsProjectId: number;
  hrmsProjectName: string;
  logicraftProjectId: string;
  logicraftProjectName: string;
  autoRegister: boolean;
  cronTime: string;
}

export function insertLogicraftMapping(db: Database.Database, input: InsertLogicraftMappingInput): number {
  const result = db.prepare(
    `INSERT INTO hrms_logicraft_mappings
       (user_id, hrms_project_id, hrms_project_name, logicraft_project_id, logicraft_project_name, auto_register, cron_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    input.hrmsProjectId,
    input.hrmsProjectName,
    input.logicraftProjectId,
    input.logicraftProjectName,
    input.autoRegister ? 1 : 0,
    input.cronTime,
  );
  return result.lastInsertRowid as number;
}

export function getLogicraftMappingsByUser(db: Database.Database, userId: string) {
  return db.prepare(
    `SELECT id, user_id, hrms_project_id, hrms_project_name,
            logicraft_project_id, logicraft_project_name,
            auto_register, cron_time, created_at, updated_at
     FROM hrms_logicraft_mappings
     WHERE user_id = ?
     ORDER BY created_at DESC`,
  ).all(userId) as any[];
}

export function getLogicraftMappingById(db: Database.Database, id: number) {
  return (
    (db
      .prepare(
        `SELECT id, user_id, hrms_project_id, hrms_project_name,
                logicraft_project_id, logicraft_project_name,
                auto_register, cron_time, created_at, updated_at
         FROM hrms_logicraft_mappings WHERE id = ?`,
      )
      .get(id) as any) ?? null
  );
}

interface UpdateLogicraftMappingInput {
  hrmsProjectName?: string;
  autoRegister?: boolean;
  cronTime?: string;
}

export function updateLogicraftMapping(db: Database.Database, id: number, input: UpdateLogicraftMappingInput): void {
  if (input.hrmsProjectName !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET hrms_project_name = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.hrmsProjectName, id);
  }
  if (input.autoRegister !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET auto_register = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.autoRegister ? 1 : 0, id);
  }
  if (input.cronTime !== undefined) {
    db.prepare(
      "UPDATE hrms_logicraft_mappings SET cron_time = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(input.cronTime, id);
  }
}

export function deleteLogicraftMapping(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM hrms_logicraft_mappings WHERE id = ?").run(id);
}

// ── hrms_logicraft_task_logs ──

interface InsertLogicraftTaskLogInput {
  mappingId: number;
  hrmsTaskId: number | null;
  targetDate: string;
  title: string;
  description: string;
  status: "success" | "error";
  errorMessage: string | null;
}

export function insertLogicraftTaskLog(db: Database.Database, input: InsertLogicraftTaskLogInput): void {
  db.prepare(
    `INSERT INTO hrms_logicraft_task_logs (mapping_id, hrms_task_id, target_date, title, description, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.mappingId, input.hrmsTaskId, input.targetDate, input.title, input.description, input.status, input.errorMessage);
}

export function getLogicraftTaskLogs(db: Database.Database, userId: string, limit = 50) {
  return db.prepare(
    `SELECT tl.*, lm.hrms_project_name, lm.logicraft_project_name
     FROM hrms_logicraft_task_logs tl
     JOIN hrms_logicraft_mappings lm ON lm.id = tl.mapping_id
     WHERE lm.user_id = ?
     ORDER BY tl.created_at DESC
     LIMIT ?`,
  ).all(userId, limit) as any[];
}

export function hasLogicraftSuccessLog(db: Database.Database, mappingId: number, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM hrms_logicraft_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' LIMIT 1",
  ).get(mappingId, targetDate);
  return !!row;
}

export function getLastLogicraftSuccessLog(db: Database.Database, mappingId: number, targetDate: string) {
  return (
    (db
      .prepare(
        "SELECT hrms_task_id FROM hrms_logicraft_task_logs WHERE mapping_id = ? AND target_date = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1",
      )
      .get(mappingId, targetDate) as { hrms_task_id: number | null } | undefined) ?? null
  );
}

export function getAutoRegisterLogicraftMappings(db: Database.Database) {
  return db.prepare(
    `SELECT lm.*, lak.encrypted_key AS logicraft_encrypted_key, hak.encrypted_key AS hrms_encrypted_key
     FROM hrms_logicraft_mappings lm
     JOIN logicraft_api_keys lak ON lak.user_id = lm.user_id
     JOIN hrms_api_keys hak ON hak.user_id = lm.user_id
     WHERE lm.auto_register = 1`,
  ).all() as any[];
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/logicraft.ts
git commit -m "feat: LogiCraft DB 접근 레이어 추가"
```

---

### Task 4: Gemini LogiCraft 전용 프롬프트

**Files:**
- Modify: `src/infra/gemini/gemini-client.ts`

- [ ] **Step 1: LogiCraft 전용 프롬프트 빌더 + 생성 함수 추가**

`src/infra/gemini/gemini-client.ts` 파일 끝에 다음 함수를 추가한다:

```typescript
import type { LogicraftItemSummary, LogicraftProposal } from "@/core/types";

export function buildLogicraftTaskPrompt(
  projectName: string,
  logicraftProjectName: string,
  date: string,
  items: LogicraftItemSummary[],
  proposals: LogicraftProposal[],
): string {
  const itemLines = items
    .map((item) => `- [${item.id}] ${item.type}: ${item.title} (상태: ${item.status}, v${item.version})`)
    .join("\n");

  const proposalLines = proposals.length > 0
    ? proposals
        .map((p) => `- [${p.target_id}] ${p.status}: ${p.rationale}`)
        .join("\n")
    : "없음";

  return `아래 LogiCraft 설계 산출물 수정 이력을 기반으로 ${date} 업무 내용을 작성해주세요.

[프로젝트: ${logicraftProjectName}]

[수정된 ITEM 목록 (${items.length}건)]
${itemLines || "없음"}

[변경 제안 (${proposals.length}건)]
${proposalLines}

출력 형식:
첫 줄은 반드시 "TITLE: " 로 시작하는 업무 제목 (작업 내역을 아우르는 20자 이내 요약, 프로젝트명·날짜 포함 금지)
다음 줄부터 업무 상세 내용

작성 규칙:
- ITEM ID와 타입을 구체적으로 언급 (예: "REQ-005 요구사항 정의", "FEAT-012 기능 상세화")
- 어떤 설계 산출물을 어떻게 변경했는지 구체적으로 기재
- 관련된 ITEM 수정은 하나의 항목으로 묶되, 서로 다른 작업은 별도 항목으로 분리
- 각 항목은 "- " 로 시작하는 개조식
- 한국어, 텍스트만 응답 (JSON/마크다운 코드블록 불필요)

제목 예시:
- "도메인 모델 요구사항 정의"
- "API 엔드포인트 설계 및 시퀀스 다이어그램 작성"`;
}

export async function generateLogicraftTaskContent(
  projectName: string,
  logicraftProjectName: string,
  date: string,
  items: LogicraftItemSummary[],
  proposals: LogicraftProposal[],
): Promise<{ title: string; description: string }> {
  const genai = getClient();
  const prompt = buildLogicraftTaskPrompt(projectName, logicraftProjectName, date, items, proposals);

  const result = await withRetry(() =>
    genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    }),
  );

  return parseHrmsTaskResponse(result.text ?? "");
}
```

주의: `LogicraftItemSummary`, `LogicraftProposal` import를 파일 상단 기존 import 옆에 추가한다:

```typescript
import type { CommitRecord, DailyTask, LogicraftItemSummary, LogicraftProposal } from "@/core/types";
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/infra/gemini/gemini-client.ts
git commit -m "feat: LogiCraft 전용 Gemini 프롬프트 및 생성 함수 추가"
```

---

### Task 5: API 라우트 — Key 관리

**Files:**
- Create: `src/app/api/logicraft/key/route.ts`
- Create: `src/app/api/logicraft/verify/route.ts`

- [ ] **Step 1: /api/logicraft/key 라우트 작성**

`src/app/api/logicraft/key/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftApiKey, upsertLogicraftApiKey, deleteLogicraftApiKey } from "@/infra/db/logicraft";
import { encrypt, decrypt, maskToken } from "@/infra/crypto/token-encryption";
import { verifyApiKey } from "@/infra/logicraft/logicraft-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const row = getLogicraftApiKey(db, session.user.id);

  if (!row) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
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

  try {
    const projects = await verifyApiKey(apiKey);

    const db = getDb();
    upsertLogicraftApiKey(db, {
      userId: session.user.id,
      encryptedKey: encrypt(apiKey),
    });

    return NextResponse.json({
      message: "LogiCraft API key registered",
      projectCount: projects.length,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: `LogiCraft verification failed: ${err.message}` }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  deleteLogicraftApiKey(db, session.user.id);
  return NextResponse.json({ message: "LogiCraft API key deleted" });
}
```

- [ ] **Step 2: /api/logicraft/verify 라우트 작성**

`src/app/api/logicraft/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftApiKey } from "@/infra/db/logicraft";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listProjects } from "@/infra/logicraft/logicraft-client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  let { apiKey } = body;

  // "__stored__" 이면 DB에 저장된 key 사용
  if (apiKey === "__stored__") {
    const db = getDb();
    const row = getLogicraftApiKey(db, session.user.id);
    if (!row) return NextResponse.json({ error: "No stored LogiCraft API key" }, { status: 400 });
    apiKey = decrypt(row.encrypted_key);
  }

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  try {
    const projects = await listProjects(apiKey);
    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json({ error: `LogiCraft API verification failed: ${err.message}` }, { status: 400 });
  }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/logicraft/key/route.ts src/app/api/logicraft/verify/route.ts
git commit -m "feat: LogiCraft API key 관리 라우트 추가"
```

---

### Task 6: API 라우트 — 매핑 CRUD

**Files:**
- Create: `src/app/api/logicraft/mappings/route.ts`
- Create: `src/app/api/logicraft/mappings/[id]/route.ts`

- [ ] **Step 1: /api/logicraft/mappings 라우트 작성 (GET + POST)**

`src/app/api/logicraft/mappings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftMappingsByUser, insertLogicraftMapping } from "@/infra/db/logicraft";
import { refreshLogicraftJob } from "@/scheduler/hrms-scheduler";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const mappings = getLogicraftMappingsByUser(db, session.user.id);
  return NextResponse.json(mappings);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { hrmsProjectId, hrmsProjectName, logicraftProjectId, logicraftProjectName, autoRegister, cronTime } = body;

  if (!hrmsProjectId || !logicraftProjectId) {
    return NextResponse.json({ error: "hrmsProjectId and logicraftProjectId are required" }, { status: 400 });
  }

  const db = getDb();

  try {
    const id = insertLogicraftMapping(db, {
      userId: session.user.id,
      hrmsProjectId,
      hrmsProjectName: hrmsProjectName ?? "",
      logicraftProjectId,
      logicraftProjectName: logicraftProjectName ?? "",
      autoRegister: autoRegister ?? false,
      cronTime: cronTime ?? "0 9 * * 1-5",
    });

    if (autoRegister) {
      refreshLogicraftJob(id);
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "이미 매핑된 LogiCraft 프로젝트입니다." }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: /api/logicraft/mappings/[id] 라우트 작성 (PUT + DELETE)**

`src/app/api/logicraft/mappings/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftMappingById, updateLogicraftMapping, deleteLogicraftMapping } from "@/infra/db/logicraft";
import { refreshLogicraftJob } from "@/scheduler/hrms-scheduler";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const db = getDb();
  const mapping = getLogicraftMappingById(db, id);

  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const body = await request.json();
  updateLogicraftMapping(db, id, {
    hrmsProjectName: body.hrmsProjectName,
    autoRegister: body.autoRegister,
    cronTime: body.cronTime,
  });

  refreshLogicraftJob(id);

  return NextResponse.json({ message: "Updated" });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const db = getDb();
  const mapping = getLogicraftMappingById(db, id);

  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  deleteLogicraftMapping(db, id);
  refreshLogicraftJob(id);

  return NextResponse.json({ message: "Deleted" });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: `refreshLogicraftJob`이 아직 없으므로 컴파일 에러 발생 — Task 10에서 해결. 여기서는 주석으로 import를 비활성화하거나, 빈 export를 scheduler에 먼저 추가한다.

`src/scheduler/hrms-scheduler.ts` 파일 끝에 임시 stub 추가:

```typescript
export function refreshLogicraftJob(_mappingId: number): void {
  // Task 10에서 구현
}
```

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/logicraft/mappings/ src/scheduler/hrms-scheduler.ts
git commit -m "feat: LogiCraft 매핑 CRUD API 라우트 추가"
```

---

### Task 7: API 라우트 — 업무 등록 + 이력 조회

**Files:**
- Create: `src/app/api/logicraft/register/route.ts`
- Create: `src/app/api/logicraft/tasks/route.ts`

- [ ] **Step 1: /api/logicraft/register 라우트 작성**

`src/app/api/logicraft/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey } from "@/infra/db/hrms";
import {
  getLogicraftApiKey,
  getLogicraftMappingById,
  hasLogicraftSuccessLog,
  getLastLogicraftSuccessLog,
  insertLogicraftTaskLog,
} from "@/infra/db/logicraft";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { listItems, listProposals, activityItemTypes } from "@/infra/logicraft/logicraft-client";
import { generateLogicraftTaskContent } from "@/infra/gemini/gemini-client";
import type { LogicraftItemSummary, LogicraftProposal } from "@/core/types";

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isOnDate(isoTimestamp: string, targetDate: string): boolean {
  return isoTimestamp.startsWith(targetDate);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { mappingId, targetDate, force } = body;

  if (!mappingId) {
    return NextResponse.json({ error: "mappingId is required" }, { status: 400 });
  }

  const db = getDb();
  const mapping = getLogicraftMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const hrmsKeyRow = getHrmsApiKey(db, session.user.id);
  if (!hrmsKeyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const logicraftKeyRow = getLogicraftApiKey(db, session.user.id);
  if (!logicraftKeyRow) {
    return NextResponse.json({ error: "LogiCraft API key not registered" }, { status: 400 });
  }

  const date = targetDate ?? getYesterdayDate();
  const hrmsApiKey = decrypt(hrmsKeyRow.encrypted_key);
  const logicraftApiKey = decrypt(logicraftKeyRow.encrypted_key);

  // 중복 체크
  if (hasLogicraftSuccessLog(db, mappingId, date) && !force) {
    let existsInHrms = false;
    try {
      const tasks = await listTasks(hrmsApiKey, {
        projectId: mapping.hrms_project_id,
        dueFrom: date,
        dueTo: date,
      });
      existsInHrms = tasks.length > 0;
    } catch { /* HRMS 조회 실패 시 로컬 기록 기준 */ }

    if (existsInHrms) {
      return NextResponse.json({ duplicate: true, date }, { status: 200 });
    }
  }

  // LogiCraft 활동 수집
  const modifiedItems: LogicraftItemSummary[] = [];
  for (const type of activityItemTypes) {
    try {
      const items = await listItems(logicraftApiKey, mapping.logicraft_project_id, type, { limit: 200 });
      const filtered = items.filter((item) => isOnDate(item.updated_at, date));
      modifiedItems.push(...filtered);
    } catch { /* 타입별 조회 실패 무시 */ }
  }

  let proposals: LogicraftProposal[] = [];
  try {
    const allProposals = await listProposals(logicraftApiKey, mapping.logicraft_project_id);
    proposals = allProposals.filter(
      (p) => isOnDate(p.created_at, date) || (p.resolved_at && isOnDate(p.resolved_at, date)),
    );
  } catch { /* 제안 조회 실패 무시 */ }

  if (modifiedItems.length === 0 && proposals.length === 0) {
    insertLogicraftTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "skip",
      description: "활동 없음",
      status: "error",
      errorMessage: "No LogiCraft activity found for target date",
    });
    return NextResponse.json({ message: "No activity found", skipped: true });
  }

  try {
    const generated = await generateLogicraftTaskContent(
      mapping.hrms_project_name,
      mapping.logicraft_project_name,
      date,
      modifiedItems,
      proposals,
    );
    const { title, description } = generated;

    // 작업 시간 추정: ITEM 수 기반 간단 추정
    const estimatedMinutes = Math.max(60, Math.min(480, (modifiedItems.length + proposals.length) * 30));

    let hrmsTaskId: number;
    let action: "created" | "updated";

    if (force) {
      let existingTaskId: number | null = null;
      try {
        const tasks = await listTasks(hrmsApiKey, {
          projectId: mapping.hrms_project_id,
          dueFrom: date,
          dueTo: date,
        });
        if (tasks.length > 0) existingTaskId = tasks[0].id;
      } catch {
        const prevLog = getLastLogicraftSuccessLog(db, mappingId, date);
        existingTaskId = prevLog?.hrms_task_id ?? null;
      }

      if (existingTaskId) {
        await updateTask(hrmsApiKey, { id: existingTaskId, title, description, status: "done", timeSpentMinutes: estimatedMinutes });
        hrmsTaskId = existingTaskId;
        action = "updated";
      } else {
        const created = await createTask(hrmsApiKey, {
          title, description, projectId: mapping.hrms_project_id,
          assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
          status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = created.id;
        action = "created";
      }
    } else {
      const created = await createTask(hrmsApiKey, {
        title, description, projectId: mapping.hrms_project_id,
        assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
        status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
      });
      hrmsTaskId = created.id;
      action = "created";
    }

    insertLogicraftTaskLog(db, {
      mappingId, hrmsTaskId, targetDate: date, title, description, status: "success", errorMessage: null,
    });

    return NextResponse.json({ message: action === "updated" ? "Task updated" : "Task registered", hrmsTaskId, title, estimatedMinutes, action }, { status: 201 });
  } catch (err: any) {
    insertLogicraftTaskLog(db, {
      mappingId, hrmsTaskId: null, targetDate: date, title: "등록 실패", description: "", status: "error", errorMessage: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: /api/logicraft/tasks 라우트 작성**

`src/app/api/logicraft/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftTaskLogs } from "@/infra/db/logicraft";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);

  const db = getDb();
  const logs = getLogicraftTaskLogs(db, session.user.id, limit);
  return NextResponse.json(logs);
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/logicraft/register/route.ts src/app/api/logicraft/tasks/route.ts
git commit -m "feat: LogiCraft 업무 등록 및 이력 조회 API 라우트 추가"
```

---

### Task 8: UI — LogicraftMappingModal

**Files:**
- Create: `src/components/hrms/logicraft-mapping-modal.tsx`

- [ ] **Step 1: logicraft-mapping-modal.tsx 작성**

`src/components/hrms/logicraft-mapping-modal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";

interface LogicraftMappingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editing?: any;
}

export function LogicraftMappingModal({ open, onClose, onSave, editing }: LogicraftMappingModalProps) {
  const [step, setStep] = useState<"key" | "select">("key");
  const [apiKey, setApiKey] = useState("");
  const [keyRegistered, setKeyRegistered] = useState(false);
  const [logicraftProjects, setLogicraftProjects] = useState<any[]>([]);
  const [hrmsProjects, setHrmsProjects] = useState<any[]>([]);

  const [selectedLogicraftId, setSelectedLogicraftId] = useState("");
  const [selectedHrmsId, setSelectedHrmsId] = useState("");
  const [autoRegister, setAutoRegister] = useState(false);
  const [cronTime, setCronTime] = useState("09:00");

  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    // 기존 key 확인
    fetch("/api/logicraft/key")
      .then((r) => r.json())
      .then((data) => {
        if (data.registered) {
          setKeyRegistered(true);
          setStep("select");
          loadProjects();
        } else {
          setStep("key");
        }
      });
  }, [open]);

  useEffect(() => {
    if (editing && step === "select") {
      setSelectedHrmsId(String(editing.hrms_project_id));
      setSelectedLogicraftId(editing.logicraft_project_id);
      setAutoRegister(!!editing.auto_register);
      const timeParts = (editing.cron_time || "0 9 * * 1-5").split(" ");
      setCronTime(`${timeParts[1]?.padStart(2, "0")}:${timeParts[0]?.padStart(2, "0")}`);
    } else if (!editing) {
      setSelectedLogicraftId("");
      setSelectedHrmsId("");
      setAutoRegister(false);
      setCronTime("09:00");
    }
  }, [editing, step]);

  async function loadProjects() {
    setLoading(true);
    try {
      const [lcRes, hrmsRes] = await Promise.all([
        fetch("/api/logicraft/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "__stored__" }),
        }).then((r) => r.json()).catch(() => ({ projects: [] })),
        fetch("/api/hrms/projects").then((r) => r.json()),
      ]);

      // 저장된 key로 프로젝트 가져오기 실패 시 빈 배열
      setLogicraftProjects(Array.isArray(lcRes.projects) ? lcRes.projects : []);
      setHrmsProjects(Array.isArray(hrmsRes) ? hrmsRes : []);
    } catch {
      setError("프로젝트 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyKey() {
    if (!apiKey.trim()) {
      setError("API key를 입력해주세요.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      // key 저장
      const saveRes = await fetch("/api/logicraft/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json();
        setError(data.error);
        return;
      }

      // key 저장 성공 → 프로젝트 조회
      const verifyRes = await fetch("/api/logicraft/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        setError(verifyData.error);
        return;
      }

      setLogicraftProjects(verifyData.projects ?? []);
      setKeyRegistered(true);

      // HRMS 프로젝트도 로드
      const hrmsRes = await fetch("/api/hrms/projects").then((r) => r.json());
      setHrmsProjects(Array.isArray(hrmsRes) ? hrmsRes : []);

      setStep("select");
    } catch {
      setError("검증 중 오류가 발생했습니다.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    if (!selectedLogicraftId || !selectedHrmsId) {
      setError("LogiCraft 프로젝트와 HRMS 프로젝트를 모두 선택해주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const lcProject = logicraftProjects.find((p: any) => p.id === selectedLogicraftId);
    const hrmsProject = hrmsProjects.find((p: any) => String(p.id) === selectedHrmsId);

    const [hour, minute] = cronTime.split(":").map(Number);
    const cronExpr = `${minute} ${hour} * * 1-5`;

    const payload = {
      hrmsProjectId: parseInt(selectedHrmsId, 10),
      hrmsProjectName: hrmsProject?.name ?? "",
      logicraftProjectId: selectedLogicraftId,
      logicraftProjectName: lcProject?.name ?? "",
      autoRegister,
      cronTime: cronExpr,
    };

    try {
      const url = editing ? `/api/logicraft/mappings/${editing.id}` : "/api/logicraft/mappings";
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
      <DialogContent className="max-w-2xl w-[90vw]">
        <DialogHeader>
          <DialogTitle>{editing ? "LogiCraft 매핑 수정" : "LogiCraft 매핑 추가"}</DialogTitle>
        </DialogHeader>

        {step === "key" && !keyRegistered ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4" />
              LogiCraft API Key를 입력해주세요
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="LogiCraft API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button onClick={handleVerifyKey} disabled={verifying}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span className="ml-1.5">검증 및 등록</span>
              </Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>LogiCraft 프로젝트</Label>
              <Select value={selectedLogicraftId} onValueChange={setSelectedLogicraftId} disabled={!!editing}>
                <SelectTrigger className="w-full"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent className="w-[var(--anchor-width)] min-w-80" alignItemWithTrigger={false}>
                  {logicraftProjects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>HRMS 프로젝트</Label>
              <Select value={selectedHrmsId} onValueChange={setSelectedHrmsId} disabled={!!editing}>
                <SelectTrigger className="w-full"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent className="w-[var(--anchor-width)] min-w-80" alignItemWithTrigger={false}>
                  {hrmsProjects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/hrms/logicraft-mapping-modal.tsx
git commit -m "feat: LogiCraft 매핑 모달 컴포넌트 추가"
```

---

### Task 9: UI — LogicraftMappingCard

**Files:**
- Create: `src/components/hrms/logicraft-mapping-card.tsx`

- [ ] **Step 1: logicraft-mapping-card.tsx 작성**

`src/components/hrms/logicraft-mapping-card.tsx` — 기존 `MappingCard`와 동일한 구조에 LogiCraft 식별 배지 추가:

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  Pencil,
  Trash2,
  Loader2,
  CalendarDays,
  ClipboardList,
  Clock,
  Zap,
  Hand,
  Blocks,
} from "lucide-react";

interface LogicraftMappingCardProps {
  mapping: any;
  onRegister: (mappingId: number, targetDate?: string) => Promise<void>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
}

function getDateString(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function getDateLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getModeTheme(auto: boolean) {
  if (auto) {
    return {
      gradient: "from-violet-500/10 to-purple-500/5",
      border: "border-violet-500/30",
      dot: "bg-violet-500",
      text: "text-violet-600 dark:text-violet-400",
      chipBg: "bg-violet-500/10 dark:bg-violet-500/20",
    };
  }
  return {
    gradient: "from-fuchsia-500/10 to-pink-500/5",
    border: "border-fuchsia-500/30",
    dot: "bg-fuchsia-500",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    chipBg: "bg-fuchsia-500/10 dark:bg-fuchsia-500/20",
  };
}

export function LogicraftMappingCard({ mapping, onRegister, onEdit, onDelete }: LogicraftMappingCardProps) {
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  const theme = getModeTheme(mapping.auto_register);

  useEffect(() => {
    setLoadingTasks(true);
    fetch(`/api/hrms/tasks?projectId=${mapping.hrms_project_id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((tasks) => {
        const sorted = (Array.isArray(tasks) ? tasks : [])
          .sort((a: any, b: any) => (b.dueDate || "").localeCompare(a.dueDate || ""))
          .slice(0, 3);
        setRecentTasks(sorted);
      })
      .catch(() => setRecentTasks([]))
      .finally(() => setLoadingTasks(false));
  }, [mapping.hrms_project_id]);

  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    try {
      await onRegister(mapping.id, targetDate);
    } finally {
      setRegistering(false);
      setShowDatePicker(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(mapping.id);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  return (
    <>
      <div
        className={`
          relative rounded-xl border ${theme.border}
          bg-gradient-to-br ${theme.gradient} backdrop-blur-sm
          p-5 transition-all duration-200
          hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20
        `}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={`w-2 h-2 rounded-full ${theme.dot} mt-1.5 flex-shrink-0 ring-2 ring-white/50 dark:ring-black/30`} />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate leading-tight">{mapping.hrms_project_name}</h3>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${theme.text} ${theme.chipBg}`}>
                  {mapping.auto_register ? <Zap className="h-2.5 w-2.5" /> : <Hand className="h-2.5 w-2.5" />}
                  {mapping.auto_register ? `자동 ${mapping.cron_time}` : "수동"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-violet-700 dark:text-violet-300 bg-violet-500/15 dark:bg-violet-500/25">
                  <Blocks className="h-2.5 w-2.5" />
                  LogiCraft
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-0.5 flex-shrink-0">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-white/40 dark:hover:bg-white/10" onClick={() => onEdit(mapping)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-white/40 dark:hover:bg-white/10" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* LogiCraft 프로젝트명 */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3 pl-[18px]">
          <span className="truncate" title={mapping.logicraft_project_name}>{mapping.logicraft_project_name}</span>
        </div>

        {/* 최근 등록 업무 */}
        <div className="mb-4 pl-[18px]">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium mb-1.5">
            <ClipboardList className="h-3 w-3 opacity-60" />
            최근 등록 업무
          </div>
          {loadingTasks ? (
            <div className="text-[11px] text-muted-foreground animate-pulse pl-[18px]">불러오는 중...</div>
          ) : recentTasks.length === 0 ? (
            <div className="text-[11px] text-muted-foreground pl-[18px]">등록된 업무 없음</div>
          ) : (
            <div className="space-y-0.5 pl-[18px]">
              {recentTasks.map((task: any) => {
                const date = task.dueDate ? task.dueDate.slice(5, 10).replace("-", "/") : "";
                return (
                  <div key={task.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground font-mono w-10 flex-shrink-0">{date}</span>
                    <span className="truncate">{task.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 업무 등록 버튼 */}
        <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
            <Upload className="h-3 w-3 opacity-60" />
            업무 등록
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Button size="sm" variant="default" className="h-9" onClick={() => handleRegister(getDateString(-1))} disabled={registering}>
              {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              <span className="ml-1.5">어제 {getDateLabel(-1)}</span>
            </Button>
            <Button size="sm" variant="outline" className="h-9 bg-white/50 dark:bg-white/5" onClick={() => handleRegister(getDateString(0))} disabled={registering}>
              <Clock className="h-3.5 w-3.5" />
              <span className="ml-1.5">오늘 {getDateLabel(0)}</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 hover:bg-white/40 dark:hover:bg-white/10" onClick={() => setShowDatePicker(!showDatePicker)} disabled={registering}>
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          {showDatePicker && (
            <div className="flex items-center gap-2">
              <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="w-auto bg-white/50 dark:bg-white/5" />
              <Button size="sm" className="h-9" onClick={() => customDate && handleRegister(customDate)} disabled={!customDate || registering}>
                {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                <span className="ml-1.5">지정일 등록</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>매핑 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{mapping.hrms_project_name}&quot; LogiCraft 매핑을 삭제하시겠습니까? 자동 등록도 중단됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/hrms/logicraft-mapping-card.tsx
git commit -m "feat: LogiCraft 매핑 카드 컴포넌트 추가"
```

---

### Task 10: 스케줄러 통합

**Files:**
- Modify: `src/scheduler/hrms-scheduler.ts`

- [ ] **Step 1: LogiCraft 관련 import 및 job 관리 추가**

`src/scheduler/hrms-scheduler.ts`를 수정한다.

기존 import 블록에 추가:

```typescript
import {
  getAutoRegisterLogicraftMappings,
  getLogicraftMappingById,
  getLogicraftApiKey,
  hasLogicraftSuccessLog,
  insertLogicraftTaskLog,
} from "@/infra/db/logicraft";
import { listItems, listProposals, activityItemTypes } from "@/infra/logicraft/logicraft-client";
import { generateLogicraftTaskContent } from "@/infra/gemini/gemini-client";
import type { LogicraftItemSummary, LogicraftProposal } from "@/core/types";
```

기존 `const jobs = new Map<number, ScheduledTask>();` 아래에 추가:

```typescript
const logicraftJobs = new Map<number, ScheduledTask>();
```

기존 `refreshJob` 함수의 stub을 실제 구현으로 교체. 파일 끝에 있는 stub을 제거하고, `stopHrmsScheduler` 함수 앞에 다음을 추가:

```typescript
function isOnDate(isoTimestamp: string, targetDate: string): boolean {
  return isoTimestamp.startsWith(targetDate);
}

async function executeLogicraftRegistration(mappingId: number): Promise<void> {
  const db = getDb();
  const mapping = getLogicraftMappingById(db, mappingId);
  if (!mapping) return;

  const date = getYesterdayDate();

  if (hasLogicraftSuccessLog(db, mappingId, date)) {
    console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: already registered for ${date}, skipping`);
    return;
  }

  const logicraftKeyRow = getLogicraftApiKey(db, mapping.user_id);
  const hrmsKeyRow = db.prepare("SELECT encrypted_key, hrms_user_id FROM hrms_api_keys WHERE user_id = ?").get(mapping.user_id) as any;

  if (!logicraftKeyRow || !hrmsKeyRow) {
    console.error(`[HrmsScheduler] logicraft mapping=${mappingId}: missing API keys`);
    return;
  }

  const logicraftApiKey = decrypt(logicraftKeyRow.encrypted_key);
  const hrmsApiKey = decrypt(hrmsKeyRow.encrypted_key);

  // LogiCraft 활동 수집
  const modifiedItems: LogicraftItemSummary[] = [];
  for (const type of activityItemTypes) {
    try {
      const items = await listItems(logicraftApiKey, mapping.logicraft_project_id, type, { limit: 200 });
      modifiedItems.push(...items.filter((item) => isOnDate(item.updated_at, date)));
    } catch { /* 타입별 조회 실패 무시 */ }
  }

  let proposals: LogicraftProposal[] = [];
  try {
    const allProposals = await listProposals(logicraftApiKey, mapping.logicraft_project_id);
    proposals = allProposals.filter(
      (p) => isOnDate(p.created_at, date) || (p.resolved_at && isOnDate(p.resolved_at, date)),
    );
  } catch { /* 무시 */ }

  if (modifiedItems.length === 0 && proposals.length === 0) {
    console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: no activity on ${date}, skipping`);
    return;
  }

  try {
    const generated = await generateLogicraftTaskContent(
      mapping.hrms_project_name,
      mapping.logicraft_project_name,
      date,
      modifiedItems,
      proposals,
    );
    const { title, description } = generated;
    const estimatedMinutes = Math.max(60, Math.min(480, (modifiedItems.length + proposals.length) * 30));

    const created = await createTask(hrmsApiKey, {
      title,
      description,
      projectId: mapping.hrms_project_id,
      assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
      status: "done",
      priority: "medium",
      dueDate: date,
      timeSpentMinutes: estimatedMinutes,
    });

    insertLogicraftTaskLog(db, {
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
    });

    console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: registered task #${created.id} for ${date}`);
  } catch (err: any) {
    insertLogicraftTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "등록 실패",
      description: "",
      status: "error",
      errorMessage: err.message,
    });
    console.error(`[HrmsScheduler] logicraft mapping=${mappingId}: failed -`, err.message);
  }
}

export function refreshLogicraftJob(mappingId: number): void {
  const existing = logicraftJobs.get(mappingId);
  if (existing) {
    existing.stop();
    logicraftJobs.delete(mappingId);
  }

  const db = getDb();
  const mapping = getLogicraftMappingById(db, mappingId);
  if (!mapping || !mapping.auto_register) return;

  const cronExpr = mapping.cron_time || "0 9 * * 1-5";
  const task = cron.schedule(cronExpr, () => {
    executeLogicraftRegistration(mappingId).catch(console.error);
  });
  logicraftJobs.set(mappingId, task);
  console.log(`[HrmsScheduler] LogiCraft job registered for mapping=${mappingId} (${cronExpr})`);
}
```

`startHrmsScheduler` 함수에 LogiCraft 매핑 로드 추가. 기존 함수의 마지막 `console.log` 바로 앞에:

```typescript
  // LogiCraft 자동 등록 매핑
  const lcMappings = getAutoRegisterLogicraftMappings(db);
  for (const m of lcMappings) {
    const cronExpr = m.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeLogicraftRegistration(m.id).catch(console.error);
    });
    logicraftJobs.set(m.id, task);
  }
```

그리고 `console.log` 메시지를 업데이트:

```typescript
  console.log(`[HrmsScheduler] Started — ${mappings.length} repo + ${lcMappings.length} LogiCraft auto-register jobs`);
```

`stopHrmsScheduler` 함수에 LogiCraft job 정리 추가:

```typescript
export function stopHrmsScheduler(): void {
  for (const [, task] of jobs) {
    task.stop();
  }
  jobs.clear();
  for (const [, task] of logicraftJobs) {
    task.stop();
  }
  logicraftJobs.clear();
  console.log("[HrmsScheduler] Stopped");
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/scheduler/hrms-scheduler.ts
git commit -m "feat: HRMS 스케줄러에 LogiCraft 자동 등록 job 통합"
```

---

### Task 11: HRMS 페이지 통합

**Files:**
- Modify: `src/app/(dashboard)/hrms/page.tsx`

- [ ] **Step 1: LogiCraft 컴포넌트 import 추가**

`src/app/(dashboard)/hrms/page.tsx` 상단 import에 추가:

```typescript
import { LogicraftMappingCard } from "@/components/hrms/logicraft-mapping-card";
import { LogicraftMappingModal } from "@/components/hrms/logicraft-mapping-modal";
import { Blocks } from "lucide-react";
```

- [ ] **Step 2: LogiCraft 상태 변수 추가**

`HrmsPage` 컴포넌트 내부, 기존 state 선언 아래에 추가:

```typescript
const [lcMappings, setLcMappings] = useState<any[]>([]);
const [lcModalOpen, setLcModalOpen] = useState(false);
const [lcEditing, setLcEditing] = useState<any>(null);
const [lcDuplicateDialog, setLcDuplicateDialog] = useState<{ mappingId: number; targetDate: string } | null>(null);
```

- [ ] **Step 3: loadData에 LogiCraft 매핑 로드 추가**

기존 `loadData` 함수 내부, `keyData.registered` 분기의 `Promise.all`에 LogiCraft 매핑 fetch 추가:

```typescript
if (keyData.registered) {
  const [mappingsRes, logsRes, lcMappingsRes] = await Promise.all([
    fetch("/api/hrms/mappings"),
    fetch("/api/hrms/register/history?limit=20"),
    fetch("/api/logicraft/mappings"),
  ]);
  setMappings(await mappingsRes.json());
  setLogs(await logsRes.json());
  setLcMappings(await lcMappingsRes.json().catch(() => []));
}
```

- [ ] **Step 4: LogiCraft 등록/삭제 핸들러 추가**

기존 `handleDelete` 함수 아래에 추가:

```typescript
async function handleLcRegister(mappingId: number, targetDate?: string, force?: boolean) {
  const res = await fetch("/api/logicraft/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mappingId, targetDate, force }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast.error(data.error);
  } else if (data.duplicate) {
    setLcDuplicateDialog({ mappingId, targetDate: data.date });
  } else if (data.skipped) {
    toast.info("해당 날짜에 LogiCraft 활동이 없어 등록을 건너뛰었습니다.");
  } else if (data.action === "updated") {
    toast.success(`기존 업무 업데이트 완료 (HRMS #${data.hrmsTaskId})`);
  } else {
    toast.success(`업무 등록 완료 (HRMS #${data.hrmsTaskId})`);
  }
  loadData();
}

async function handleLcDelete(mappingId: number) {
  const res = await fetch(`/api/logicraft/mappings/${mappingId}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("LogiCraft 매핑이 삭제되었습니다.");
    loadData();
  }
}
```

- [ ] **Step 5: 헤더에 LogiCraft 매핑 추가 버튼 삽입**

기존 헤더의 "프로젝트 매핑 추가" 버튼 옆에 추가. 기존 `<Button>` 을 `<div className="flex gap-2">` 로 감싸고 LogiCraft 버튼 추가:

```tsx
<div className="flex gap-2">
  <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>
    <Plus className="h-4 w-4 mr-1" /> 프로젝트 매핑 추가
  </Button>
  <Button size="sm" variant="outline" onClick={() => { setLcEditing(null); setLcModalOpen(true); }}>
    <Blocks className="h-4 w-4 mr-1" /> LogiCraft 매핑 추가
  </Button>
</div>
```

- [ ] **Step 6: 매핑 카드 그리드를 두 섹션으로 분리**

기존 매핑 카드 목록 영역을 Repo 섹션과 LogiCraft 섹션으로 분리:

```tsx
{/* Repo 매핑 카드 */}
{mappings.length > 0 && (
  <div className="space-y-3">
    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
      <GitBranch className="h-3.5 w-3.5" />
      Repo 매핑
    </h3>
    <div className="grid gap-4">
      {mappings.map((m: any) => (
        <MappingCard
          key={m.id}
          mapping={m}
          onRegister={handleRegister}
          onEdit={(mapping) => { setEditing(mapping); setModalOpen(true); }}
          onDelete={handleDelete}
        />
      ))}
    </div>
  </div>
)}

{/* LogiCraft 매핑 카드 */}
{lcMappings.length > 0 && (
  <div className="space-y-3">
    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
      <Blocks className="h-3.5 w-3.5" />
      LogiCraft 매핑
    </h3>
    <div className="grid gap-4">
      {lcMappings.map((m: any) => (
        <LogicraftMappingCard
          key={m.id}
          mapping={m}
          onRegister={handleLcRegister}
          onEdit={(mapping) => { setLcEditing(mapping); setLcModalOpen(true); }}
          onDelete={handleLcDelete}
        />
      ))}
    </div>
  </div>
)}

{mappings.length === 0 && lcMappings.length === 0 && (
  <p className="text-sm text-muted-foreground text-center py-8">
    프로젝트 매핑이 없습니다. 위 버튼으로 추가해주세요.
  </p>
)}
```

`GitBranch` import를 상단에 추가 (이미 lucide-react에서 사용 가능).

- [ ] **Step 7: LogiCraft 모달 + 중복 다이얼로그 추가**

기존 `<MappingModal>` 바로 아래에:

```tsx
<LogicraftMappingModal
  open={lcModalOpen}
  onClose={() => { setLcModalOpen(false); setLcEditing(null); }}
  onSave={loadData}
  editing={lcEditing}
/>

<AlertDialog open={!!lcDuplicateDialog} onOpenChange={(open) => !open && setLcDuplicateDialog(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>기존 업무 업데이트</AlertDialogTitle>
      <AlertDialogDescription>
        {lcDuplicateDialog?.targetDate}에 이미 등록된 업무가 있습니다. LogiCraft 활동을 기반으로 기존 업무를 업데이트합니다. 진행하시겠습니까?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>취소</AlertDialogCancel>
      <AlertDialogAction onClick={() => {
        if (lcDuplicateDialog) {
          handleLcRegister(lcDuplicateDialog.mappingId, lcDuplicateDialog.targetDate, true);
        }
        setLcDuplicateDialog(null);
      }}>등록</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 8: 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 9: 개발 서버에서 수동 테스트**

Run: `npm run dev`

확인 항목:
1. HRMS 페이지 접속 → 헤더에 "LogiCraft 매핑 추가" 버튼 표시됨
2. 버튼 클릭 → 모달에서 API key 입력 단계 표시
3. 유효한 key 입력 → 프로젝트 선택 단계로 전환
4. LogiCraft + HRMS 프로젝트 선택 후 저장 → 카드 목록에 표시
5. LogiCraft 카드에 보라색 테마 + "LogiCraft" 배지 표시
6. 전일/당일 등록 버튼 동작 확인

- [ ] **Step 10: 커밋**

```bash
git add src/app/(dashboard)/hrms/page.tsx
git commit -m "feat: HRMS 페이지에 LogiCraft 매핑 섹션 통합"
```
