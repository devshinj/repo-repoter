# Credential Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 서비스에 여러 자격증명을 등록/갱신/삭제할 수 있도록 DB 제약, API, UI를 전면 개편한다.

**Architecture:** DB의 UNIQUE(user_id, provider) 제약을 제거하여 다중 등록을 허용하고, API를 id 기반 PUT/DELETE로 전환하며, UI를 카드 리스트 + 등록 다이얼로그로 리디자인한다. 기존 `getCredentialByUserAndProvider`를 사용하는 스케줄러/API는 다중 결과를 반환하는 새 함수로 전환한다.

**Tech Stack:** Next.js 16 App Router, SQLite (better-sqlite3), shadcn/ui, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-credential-management-redesign.md`

---

### Task 1: DB Schema Migration — UNIQUE 제약 제거

**Files:**
- Modify: `src/infra/db/schema.ts:67-87` (migrateSchema 함수)

- [ ] **Step 1: migrateSchema에 테이블 재생성 마이그레이션 추가**

`migrateSchema` 함수 끝에 다음 블록을 추가한다. SQLite는 ALTER TABLE로 UNIQUE 제약을 제거할 수 없으므로 테이블을 재생성한다:

```typescript
// src/infra/db/schema.ts — migrateSchema 함수 끝에 추가

  // user_credentials UNIQUE(user_id, provider) 제약 제거 — 다중 자격증명 허용
  const credIndexInfo = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_credentials'"
  ).get() as { sql: string } | undefined;

  if (credIndexInfo?.sql?.includes("UNIQUE(user_id, provider)")) {
    db.exec(`
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
      INSERT INTO user_credentials_new SELECT * FROM user_credentials;
      DROP TABLE user_credentials;
      ALTER TABLE user_credentials_new RENAME TO user_credentials;
    `);
  }
```

- [ ] **Step 2: createTables에서도 UNIQUE 제약 제거**

`createTables` 함수의 `user_credentials` CREATE 문에서 `UNIQUE(user_id, provider)` 줄을 제거한다:

```typescript
// 변경 전
    UNIQUE(user_id, provider)

// 변경 후 — 해당 줄 삭제, 마지막 컬럼의 trailing comma 제거
```

- [ ] **Step 3: 테스트 실행하여 기존 테스트 상태 확인**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: "should reject duplicate user_id + provider" 테스트가 FAIL (UNIQUE 제약 제거됨)

- [ ] **Step 4: 중복 거부 테스트를 다중 등록 허용 테스트로 변경**

```typescript
// src/__tests__/infra/db/credential.test.ts — 마지막 테스트 교체

  it("should allow multiple credentials for same user and provider", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "회사 GitHub",
      metadata: null,
    });
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token2",
      label: "개인 GitHub",
      metadata: null,
    });

    const creds = getCredentialsByUser(db, "user1");
    expect(creds).toHaveLength(2);
    expect(creds.map((c: any) => c.label)).toContain("회사 GitHub");
    expect(creds.map((c: any) => c.label)).toContain("개인 GitHub");
  });
```

- [ ] **Step 5: 테스트 실행**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/infra/db/schema.ts src/__tests__/infra/db/credential.test.ts
git commit -m "refactor: user_credentials UNIQUE 제약 제거, 다중 자격증명 허용"
```

---

### Task 2: credential.ts — provider 타입 확장 및 id 기반 조회 함수 추가

**Files:**
- Modify: `src/infra/db/credential.ts`
- Modify: `src/__tests__/infra/db/credential.test.ts`

- [ ] **Step 1: 다중 결과 반환 함수 테스트 작성**

`credential.test.ts`에 새 테스트를 추가한다:

```typescript
  it("should get all credentials by user and provider", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "회사",
      metadata: null,
    });
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token2",
      label: "개인",
      metadata: null,
    });

    const creds = getCredentialsByUserAndProvider(db, "user1", "git");
    expect(creds).toHaveLength(2);
  });

  it("should get credential by id", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: "테스트",
      metadata: null,
    });

    const all = getCredentialsByUser(db, "user1");
    const cred = getCredentialById(db, all[0].id);
    expect(cred).toBeDefined();
    expect(cred!.credential).toBe("token1");
  });
```

import에 `getCredentialsByUserAndProvider`, `getCredentialById`를 추가한다.

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: FAIL — 함수들이 아직 없음

- [ ] **Step 3: credential.ts에 함수 추가 및 타입 수정**

```typescript
// src/infra/db/credential.ts

interface InsertCredentialInput {
  userId: string;
  provider: string;
  credential: string;
  label: string | null;
  metadata: string | null;
}

// 기존 함수 유지 + 새 함수 추가

export function getCredentialsByUserAndProvider(db: Database.Database, userId: string, provider: string) {
  return db.prepare(
    "SELECT * FROM user_credentials WHERE user_id = ? AND provider = ?"
  ).all(userId, provider) as any[];
}

export function getCredentialById(db: Database.Database, id: number) {
  return db.prepare(
    "SELECT * FROM user_credentials WHERE id = ?"
  ).get(id) as any | undefined;
}
```

`InsertCredentialInput`의 `provider` 타입을 `"git" | "notion"`에서 `string`으로 변경한다.

- [ ] **Step 4: 테스트 실행**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/db/credential.ts src/__tests__/infra/db/credential.test.ts
git commit -m "feat: getCredentialsByUserAndProvider, getCredentialById 함수 추가"
```

---

### Task 3: API 전환 — POST 중복 체크 제거 + id 기반 PUT/DELETE

**Files:**
- Modify: `src/app/api/credentials/route.ts` (POST 수정, PUT/DELETE 제거)
- Create: `src/app/api/credentials/[id]/route.ts` (PUT, DELETE)

- [ ] **Step 1: route.ts — POST에서 중복 체크 제거, provider 검증 수정**

```typescript
// src/app/api/credentials/route.ts

import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import {
  insertCredential,
  getCredentialsByUser,
} from "@/infra/db/credential";
import { encrypt, maskToken } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}

const validProviders = ["git"] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  try {
    const creds = getCredentialsByUser(db, session.user.id);
    const masked = creds.map((c: any) => ({
      id: c.id,
      provider: c.provider,
      label: c.label,
      metadata: c.metadata ? JSON.parse(c.metadata) : null,
      maskedToken: maskToken(c.credential.split(":").pop() || "****"),
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
    return NextResponse.json(masked);
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, token, label } = body;

  if (!provider || !token || !label) {
    return NextResponse.json({ error: "provider, token, label are required" }, { status: 400 });
  }
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: `provider must be one of: ${validProviders.join(", ")}` }, { status: 400 });
  }

  const db = getDb();
  try {
    const encrypted = encrypt(token);
    insertCredential(db, {
      userId: session.user.id,
      provider,
      credential: encrypted,
      label,
      metadata: null,
    });

    return NextResponse.json({ message: "Credential saved" }, { status: 201 });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: [id]/route.ts 생성 — PUT, DELETE**

```typescript
// src/app/api/credentials/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import { getCredentialById, updateCredential } from "@/infra/db/credential";
import { encrypt } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const credId = parseInt(id, 10);
  if (isNaN(credId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const { token, label } = body;

  if (!token && label === undefined) {
    return NextResponse.json({ error: "token or label is required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getCredentialById(db, credId);
    if (!existing) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    if (existing.user_id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    updateCredential(db, credId, {
      credential: token ? encrypt(token) : existing.credential,
      label: label !== undefined ? label : existing.label,
      metadata: existing.metadata,
    });

    return NextResponse.json({ message: "Credential updated" });
  } finally {
    db.close();
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const credId = parseInt(id, 10);
  if (isNaN(credId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getDb();
  try {
    const existing = getCredentialById(db, credId);
    if (!existing) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    if (existing.user_id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { deleteCredential } = await import("@/infra/db/credential");
    deleteCredential(db, credId);
    return NextResponse.json({ message: "Credential deleted" });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx next build`
Expected: 빌드 성공 (타입 에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/credentials/route.ts src/app/api/credentials/[id]/route.ts
git commit -m "refactor: credentials API를 id 기반 PUT/DELETE로 전환, POST 중복 체크 제거"
```

---

### Task 4: 기존 호출부 — getCredentialByUserAndProvider 다중 결과 대응

**Files:**
- Modify: `src/scheduler/polling-manager.ts:79,85`
- Modify: `src/app/api/repos/route.ts:62`
- Modify: `src/app/api/repos/[id]/sync/route.ts:41,47`
- Modify: `src/app/api/tasks/route.ts:27`
- Modify: `src/app/api/notion/setup-databases/route.ts:66`

이 파일들은 `getCredentialByUserAndProvider`로 단일 자격증명을 가져오고 있다. 다중 등록 이후에도 기존 동작을 유지하려면, 이 함수는 그대로 두되 **첫 번째 매칭을 반환**하는 동작을 유지한다. 함수 자체는 `.get()`을 사용하므로 UNIQUE 제거 후에도 첫 번째 결과를 반환한다. **호출부 변경 불필요.**

- [ ] **Step 1: 기존 호출부가 정상 동작하는지 확인**

`getCredentialByUserAndProvider`는 `.get()`을 사용하므로 다중 행이 있어도 첫 번째를 반환한다. 호출부 코드 변경 없이 동작이 유지됨을 확인한다.

- [ ] **Step 2: core/types.ts — UserCredential provider 타입 수정**

```typescript
// src/core/types.ts — UserCredential 변경

/** 사용자 자격증명 (토큰 값은 infra 레이어에서만 복호화) */
export interface UserCredential {
  id: number;
  userId: string;
  provider: string;
  label: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}
```

`provider`를 `"git" | "notion"`에서 `string`으로 변경한다.

- [ ] **Step 3: 커밋**

```bash
git add src/core/types.ts
git commit -m "refactor: UserCredential.provider 타입을 string으로 확장"
```

---

### Task 5: 설정 페이지 UI 리디자인

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx` (전면 재작성)

- [ ] **Step 1: shadcn/ui Dialog 컴포넌트 설치 (없는 경우)**

Run: `npx shadcn@latest add dialog`
Expected: `src/components/ui/dialog.tsx` 생성

- [ ] **Step 2: 설정 페이지 전면 재작성**

```typescript
// src/app/(dashboard)/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GitBranch, Plus, Pencil, RefreshCw, Trash2 } from "lucide-react";

interface Credential {
  id: number;
  provider: string;
  label: string | null;
  maskedToken: string;
  createdAt: string;
  updatedAt: string;
}

const providerPresets: Record<string, {
  name: string;
  icon: typeof GitBranch;
  placeholder: string;
  description: string;
}> = {
  git: {
    name: "Git",
    icon: GitBranch,
    placeholder: "ghp_xxxx 또는 glpat-xxxx",
    description: "GitHub, GitLab, Gitea 등의 Personal Access Token",
  },
};

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newProvider] = useState("git");
  const [newLabel, setNewLabel] = useState("");
  const [newToken, setNewToken] = useState("");
  const [saving, setSaving] = useState(false);

  // 인라인 편집 상태
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  const [renewingTokenId, setRenewingTokenId] = useState<number | null>(null);
  const [renewTokenValue, setRenewTokenValue] = useState("");

  const fetchCredentials = () => {
    fetch("/api/credentials").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setCredentials(data);
    });
  };

  useEffect(() => { fetchCredentials(); }, []);

  const handleAdd = async () => {
    if (!newToken || !newLabel) {
      toast.error("라벨과 토큰을 모두 입력하세요");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: newProvider, token: newToken, label: newLabel }),
      });
      if (res.ok) {
        toast.success("자격증명이 등록되었습니다");
        setNewToken("");
        setNewLabel("");
        setAddDialogOpen(false);
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "등록 실패");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLabel = async (id: number) => {
    const res = await fetch(`/api/credentials/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editingLabelValue }),
    });
    if (res.ok) {
      toast.success("라벨이 수정되었습니다");
      setEditingLabelId(null);
      fetchCredentials();
    } else {
      toast.error("라벨 수정 실패");
    }
  };

  const handleRenewToken = async (id: number) => {
    if (!renewTokenValue) {
      toast.error("새 토큰을 입력하세요");
      return;
    }
    const res = await fetch(`/api/credentials/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: renewTokenValue }),
    });
    if (res.ok) {
      toast.success("토큰이 갱신되었습니다");
      setRenewingTokenId(null);
      setRenewTokenValue("");
      fetchCredentials();
    } else {
      toast.error("토큰 갱신 실패");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 자격증명을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("자격증명이 삭제되었습니다");
      fetchCredentials();
    } else {
      toast.error("삭제 실패");
    }
  };

  const gitCredentials = credentials.filter((c) => c.provider === "git");

  return (
    <div>
      <Header title="설정" description="외부 서비스 자격증명을 관리합니다" />

      <div className="space-y-6 max-w-2xl">
        {/* 새 자격증명 등록 버튼 */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              새 자격증명 등록
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 자격증명 등록</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">서비스</label>
                <div className="flex items-center gap-2 mt-1 p-2 bg-muted rounded-md">
                  <GitBranch className="h-4 w-4" />
                  <span className="text-sm">Git (GitHub, GitLab, Gitea)</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">라벨</label>
                <Input
                  placeholder="예: 회사 GitHub PAT"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">토큰</label>
                <Input
                  type="password"
                  placeholder={providerPresets[newProvider].placeholder}
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                />
              </div>
              <Button onClick={handleAdd} disabled={saving} className="w-full">
                {saving ? "저장 중..." : "등록"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Git 자격증명 카드 리스트 */}
        {gitCredentials.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Git Personal Access Tokens
            </h3>
            {gitCredentials.map((cred) => (
              <Card key={cred.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      {/* 라벨 (인라인 편집) */}
                      {editingLabelId === cred.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingLabelValue}
                            onChange={(e) => setEditingLabelValue(e.target.value)}
                            className="h-8 max-w-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdateLabel(cred.id);
                              if (e.key === "Escape") setEditingLabelId(null);
                            }}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" onClick={() => handleUpdateLabel(cred.id)}>저장</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingLabelId(null)}>취소</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{cred.label || "(라벨 없음)"}</span>
                          <Badge variant="secondary" className="text-xs">Git</Badge>
                        </div>
                      )}

                      {/* 토큰 마스킹 */}
                      <div className="text-sm text-muted-foreground">
                        토큰: <code className="bg-muted px-1 rounded">{cred.maskedToken}</code>
                      </div>

                      {/* 날짜 정보 */}
                      <div className="text-xs text-muted-foreground">
                        등록: {new Date(cred.createdAt).toLocaleDateString("ko-KR")}
                        {cred.updatedAt !== cred.createdAt && (
                          <> · 갱신: {new Date(cred.updatedAt).toLocaleDateString("ko-KR")}</>
                        )}
                      </div>

                      {/* 토큰 갱신 인라인 */}
                      {renewingTokenId === cred.id && (
                        <div className="flex items-center gap-2 mt-2">
                          <Input
                            type="password"
                            placeholder={providerPresets.git.placeholder}
                            value={renewTokenValue}
                            onChange={(e) => setRenewTokenValue(e.target.value)}
                            className="h-8 max-w-xs"
                          />
                          <Button size="sm" onClick={() => handleRenewToken(cred.id)}>저장</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setRenewingTokenId(null); setRenewTokenValue(""); }}>취소</Button>
                        </div>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="라벨 수정"
                        onClick={() => {
                          setEditingLabelId(cred.id);
                          setEditingLabelValue(cred.label || "");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="토큰 갱신"
                        onClick={() => setRenewingTokenId(renewingTokenId === cred.id ? null : cred.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="삭제"
                        onClick={() => handleDelete(cred.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* 자격증명 없을 때 */}
        {credentials.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              등록된 자격증명이 없습니다. 위 버튼으로 새 자격증명을 추가하세요.
            </CardContent>
          </Card>
        )}

        {/* Gemini (글로벌) */}
        <Card>
          <CardHeader>
            <CardTitle>Gemini API</CardTitle>
            <CardDescription>서버 공통 설정으로 관리됩니다</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Gemini API 키는 서버 환경 변수(<code className="bg-muted px-1 rounded">GEMINI_API_KEY</code>)로 관리됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npx next build`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/app/(dashboard)/settings/page.tsx src/components/ui/dialog.tsx
git commit -m "feat: 설정 페이지 자격증명 관리 UI 리디자인 — 카드 리스트 + 등록 다이얼로그"
```

---

### Task 6: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 PASS

- [ ] **Step 2: 빌드 확인**

Run: `npx next build`
Expected: 빌드 성공

- [ ] **Step 3: 수동 검증 체크리스트**

브라우저에서 `/settings` 접속 후:
1. "새 자격증명 등록" 버튼 → 다이얼로그 → Git PAT 등록
2. 같은 provider로 두 번째 자격증명 등록 (라벨 다르게)
3. 카드에서 라벨 수정 (연필 아이콘)
4. 카드에서 토큰 갱신 (새로고침 아이콘)
5. 카드 삭제 (휴지통 아이콘)
