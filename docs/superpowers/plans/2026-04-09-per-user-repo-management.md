# 사용자별 저장소 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.env` 기반 글로벌 GitHub 토큰 구조를 사용자별 Git PAT + Notion 키 등록 + bare clone 기반 커밋 수집 구조로 전환한다.

**Architecture:** 점진적 마이그레이션 — 기존 `infra/github/`를 유지하면서 새 `infra/git/`, `infra/crypto/` 모듈을 병렬 추가하고, DB 스키마를 확장한 뒤, API·스케줄러·UI를 순차적으로 전환한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, better-sqlite3, Node.js crypto (AES-256-GCM), child_process.execFile (git CLI), shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-09-per-user-repo-management-design.md`

---

### Task 1: core 타입 확장

**Files:**
- Modify: `src/core/types.ts`
- Test: `src/__tests__/core/types.test.ts`

- [ ] **Step 1: 타입 테스트 파일 생성**

```typescript
// src/__tests__/core/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { Repository, UserCredential, SyncLog } from "@/core/types";

describe("Repository type", () => {
  it("should have userId, cloneUrl, clonePath fields", () => {
    expectTypeOf<Repository>().toHaveProperty("userId");
    expectTypeOf<Repository>().toHaveProperty("cloneUrl");
    expectTypeOf<Repository>().toHaveProperty("clonePath");
  });
});

describe("UserCredential type", () => {
  it("should have required fields", () => {
    expectTypeOf<UserCredential>().toHaveProperty("id");
    expectTypeOf<UserCredential>().toHaveProperty("userId");
    expectTypeOf<UserCredential>().toHaveProperty("provider");
    expectTypeOf<UserCredential>().toHaveProperty("label");
    expectTypeOf<UserCredential>().toHaveProperty("metadata");
  });

  it("provider should be git or notion", () => {
    expectTypeOf<UserCredential["provider"]>().toEqualTypeOf<"git" | "notion">();
  });
});

describe("SyncLog type", () => {
  it("should have userId field", () => {
    expectTypeOf<SyncLog>().toHaveProperty("userId");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/core/types.test.ts`
Expected: FAIL — `UserCredential` 타입이 존재하지 않고, `Repository`에 `userId` 등 필드 없음

- [ ] **Step 3: types.ts에 UserCredential 추가 및 Repository, SyncLog 확장**

`src/core/types.ts`의 `Repository` 인터페이스(28-38행)를 다음으로 교체:

```typescript
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
  userId: string;
  cloneUrl: string;
  clonePath: string | null;
}
```

`SyncLog` 인터페이스(41-50행)를 다음으로 교체:

```typescript
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
  userId: string;
}
```

파일 끝에 `UserCredential` 추가:

```typescript
/** 사용자 자격증명 (토큰 값은 infra 레이어에서만 복호화) */
export interface UserCredential {
  id: number;
  userId: string;
  provider: "git" | "notion";
  label: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/core/types.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/types.ts src/__tests__/core/types.test.ts
git commit -m "feat: Repository, SyncLog에 userId 추가, UserCredential 타입 신규"
```

---

### Task 2: DB 스키마 확장

**Files:**
- Modify: `src/infra/db/schema.ts`
- Test: `src/__tests__/infra/db/schema.test.ts`

- [ ] **Step 1: 스키마 테스트 작성**

```typescript
// src/__tests__/infra/db/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";

describe("createTables", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should create user_credentials table", () => {
    const info = db.prepare("PRAGMA table_info(user_credentials)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("provider");
    expect(columnNames).toContain("credential");
    expect(columnNames).toContain("label");
    expect(columnNames).toContain("metadata");
  });

  it("should enforce unique(user_id, provider) on user_credentials", () => {
    db.prepare(
      "INSERT INTO user_credentials (user_id, provider, credential) VALUES (?, ?, ?)"
    ).run("user1", "git", "encrypted-token");

    expect(() => {
      db.prepare(
        "INSERT INTO user_credentials (user_id, provider, credential) VALUES (?, ?, ?)"
      ).run("user1", "git", "another-token");
    }).toThrow();
  });

  it("should have user_id, clone_url, clone_path columns in repositories", () => {
    const info = db.prepare("PRAGMA table_info(repositories)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("clone_url");
    expect(columnNames).toContain("clone_path");
  });

  it("should enforce unique(user_id, clone_url) on repositories", () => {
    db.prepare(
      "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
    ).run("owner1", "repo1", "main", "user1", "https://github.com/owner1/repo1.git");

    expect(() => {
      db.prepare(
        "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
      ).run("owner1", "repo1", "main", "user1", "https://github.com/owner1/repo1.git");
    }).toThrow();
  });

  it("should have user_id column in sync_logs", () => {
    const info = db.prepare("PRAGMA table_info(sync_logs)").all() as any[];
    const columnNames = info.map((col: any) => col.name);
    expect(columnNames).toContain("user_id");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/schema.test.ts`
Expected: FAIL — `user_credentials` 테이블 없음, `repositories`에 `user_id` 컬럼 없음

- [ ] **Step 3: schema.ts 수정**

`src/infra/db/schema.ts`의 `createTables` 함수 전체를 다음으로 교체:

```typescript
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
      user_id TEXT NOT NULL DEFAULT '',
      clone_url TEXT NOT NULL DEFAULT '',
      clone_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, clone_url)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      credential TEXT NOT NULL,
      label TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL DEFAULT '',
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

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/db/schema.ts src/__tests__/infra/db/schema.test.ts
git commit -m "feat: user_credentials 테이블 추가, repositories/sync_logs에 user_id 컬럼 추가"
```

---

### Task 3: 암호화 모듈 구현

**Files:**
- Create: `src/infra/crypto/token-encryption.ts`
- Test: `src/__tests__/infra/crypto/token-encryption.test.ts`

- [ ] **Step 1: 암호화 테스트 작성**

```typescript
// src/__tests__/infra/crypto/token-encryption.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("token-encryption", () => {
  const originalEnv = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-key-for-encryption";
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalEnv;
  });

  it("should encrypt and decrypt a token", async () => {
    const { encrypt, decrypt } = await import("@/infra/crypto/token-encryption");
    const token = "ghp_abc123XYZ";
    const encrypted = encrypt(token);
    expect(encrypted).not.toBe(token);
    expect(decrypt(encrypted)).toBe(token);
  });

  it("should produce different ciphertext for same input (random IV)", async () => {
    const { encrypt } = await import("@/infra/crypto/token-encryption");
    const token = "ghp_abc123XYZ";
    const a = encrypt(token);
    const b = encrypt(token);
    expect(a).not.toBe(b);
  });

  it("should throw on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/infra/crypto/token-encryption");
    const encrypted = encrypt("ghp_test");
    const tampered = encrypted.slice(0, -2) + "ff";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("should mask a token showing last 4 chars", async () => {
    const { maskToken } = await import("@/infra/crypto/token-encryption");
    expect(maskToken("ghp_abc123XYZ789")).toBe("************Y789");
  });

  it("should mask short tokens safely", async () => {
    const { maskToken } = await import("@/infra/crypto/token-encryption");
    expect(maskToken("ab")).toBe("**");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/crypto/token-encryption.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 암호화 모듈 구현**

```typescript
// src/infra/crypto/token-encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encrypted: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export function maskToken(token: string): string {
  if (token.length <= 4) return "*".repeat(token.length);
  return "*".repeat(token.length - 4) + token.slice(-4);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/crypto/token-encryption.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/crypto/token-encryption.ts src/__tests__/infra/crypto/token-encryption.test.ts
git commit -m "feat: AES-256-GCM 토큰 암호화 모듈 구현"
```

---

### Task 4: 자격증명 DB 함수 구현

**Files:**
- Create: `src/infra/db/credential.ts`
- Test: `src/__tests__/infra/db/credential.test.ts`

- [ ] **Step 1: 자격증명 CRUD 테스트 작성**

```typescript
// src/__tests__/infra/db/credential.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertCredential,
  getCredentialsByUser,
  getCredentialByUserAndProvider,
  updateCredential,
  deleteCredential,
} from "@/infra/db/credential";

describe("credential repository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should insert and retrieve a credential", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "encrypted-token",
      label: "GitHub PAT",
      metadata: null,
    });

    const creds = getCredentialsByUser(db, "user1");
    expect(creds).toHaveLength(1);
    expect(creds[0].provider).toBe("git");
    expect(creds[0].credential).toBe("encrypted-token");
    expect(creds[0].label).toBe("GitHub PAT");
  });

  it("should get credential by user and provider", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "encrypted-git",
      label: null,
      metadata: null,
    });
    insertCredential(db, {
      userId: "user1",
      provider: "notion",
      credential: "encrypted-notion",
      label: null,
      metadata: JSON.stringify({ notionCommitDbId: "db1", notionTaskDbId: "db2" }),
    });

    const git = getCredentialByUserAndProvider(db, "user1", "git");
    expect(git?.credential).toBe("encrypted-git");

    const notion = getCredentialByUserAndProvider(db, "user1", "notion");
    expect(notion?.credential).toBe("encrypted-notion");
    expect(notion?.metadata).toBe(JSON.stringify({ notionCommitDbId: "db1", notionTaskDbId: "db2" }));
  });

  it("should update a credential", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "old-token",
      label: null,
      metadata: null,
    });

    const cred = getCredentialByUserAndProvider(db, "user1", "git")!;
    updateCredential(db, cred.id, {
      credential: "new-token",
      label: "Updated PAT",
      metadata: null,
    });

    const updated = getCredentialByUserAndProvider(db, "user1", "git")!;
    expect(updated.credential).toBe("new-token");
    expect(updated.label).toBe("Updated PAT");
  });

  it("should delete a credential", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token",
      label: null,
      metadata: null,
    });

    const cred = getCredentialByUserAndProvider(db, "user1", "git")!;
    deleteCredential(db, cred.id);

    const result = getCredentialsByUser(db, "user1");
    expect(result).toHaveLength(0);
  });

  it("should reject duplicate user_id + provider", () => {
    insertCredential(db, {
      userId: "user1",
      provider: "git",
      credential: "token1",
      label: null,
      metadata: null,
    });

    expect(() => {
      insertCredential(db, {
        userId: "user1",
        provider: "git",
        credential: "token2",
        label: null,
        metadata: null,
      });
    }).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: FAIL — `credential.ts` 모듈 없음

- [ ] **Step 3: credential.ts 구현**

```typescript
// src/infra/db/credential.ts
import Database from "better-sqlite3";

interface InsertCredentialInput {
  userId: string;
  provider: "git" | "notion";
  credential: string;
  label: string | null;
  metadata: string | null;
}

interface UpdateCredentialInput {
  credential: string;
  label: string | null;
  metadata: string | null;
}

export function insertCredential(db: Database.Database, input: InsertCredentialInput): void {
  db.prepare(
    "INSERT INTO user_credentials (user_id, provider, credential, label, metadata) VALUES (?, ?, ?, ?, ?)"
  ).run(input.userId, input.provider, input.credential, input.label, input.metadata);
}

export function getCredentialsByUser(db: Database.Database, userId: string) {
  return db.prepare("SELECT * FROM user_credentials WHERE user_id = ?").all(userId) as any[];
}

export function getCredentialByUserAndProvider(db: Database.Database, userId: string, provider: string) {
  return db.prepare(
    "SELECT * FROM user_credentials WHERE user_id = ? AND provider = ?"
  ).get(userId, provider) as any | undefined;
}

export function updateCredential(db: Database.Database, id: number, input: UpdateCredentialInput): void {
  db.prepare(
    "UPDATE user_credentials SET credential = ?, label = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(input.credential, input.label, input.metadata, id);
}

export function deleteCredential(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM user_credentials WHERE id = ?").run(id);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/credential.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/db/credential.ts src/__tests__/infra/db/credential.test.ts
git commit -m "feat: 자격증명 CRUD DB 함수 구현"
```

---

### Task 5: repository.ts에 사용자 스코핑 함수 추가

**Files:**
- Modify: `src/infra/db/repository.ts`
- Test: `src/__tests__/infra/db/repository.test.ts`

- [ ] **Step 1: 사용자 스코핑 테스트 작성**

```typescript
// src/__tests__/infra/db/repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  getRepositoryByIdAndUser,
  deleteRepositoryForUser,
  insertSyncLogForUser,
  getActiveUsersWithRepos,
} from "@/infra/db/repository";

describe("user-scoped repository functions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should insert and retrieve repos for a specific user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });
    insertRepositoryForUser(db, {
      userId: "user2",
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });

    const user1Repos = getRepositoriesByUser(db, "user1");
    expect(user1Repos).toHaveLength(1);
    expect(user1Repos[0].owner).toBe("octocat");

    const user2Repos = getRepositoriesByUser(db, "user2");
    expect(user2Repos).toHaveLength(1);
  });

  it("should get repo by id only if owned by user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = getRepositoriesByUser(db, "user1");
    const repoId = repos[0].id;

    expect(getRepositoryByIdAndUser(db, repoId, "user1")).toBeDefined();
    expect(getRepositoryByIdAndUser(db, repoId, "user2")).toBeUndefined();
  });

  it("should delete repo only if owned by user", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });

    const repos = getRepositoriesByUser(db, "user1");
    const repoId = repos[0].id;

    const deleted = deleteRepositoryForUser(db, repoId, "user2");
    expect(deleted).toBe(false);

    const deleted2 = deleteRepositoryForUser(db, repoId, "user1");
    expect(deleted2).toBe(true);
    expect(getRepositoriesByUser(db, "user1")).toHaveLength(0);
  });

  it("should insert sync log with user_id", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "octocat",
      repo: "repo1",
      branch: "main",
      cloneUrl: "https://github.com/octocat/repo1.git",
    });
    const repos = getRepositoriesByUser(db, "user1");

    insertSyncLogForUser(db, {
      repositoryId: repos[0].id,
      userId: "user1",
      status: "success",
      commitsProcessed: 5,
      tasksCreated: 2,
      errorMessage: null,
    });

    const logs = db.prepare("SELECT * FROM sync_logs WHERE user_id = ?").all("user1") as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].commits_processed).toBe(5);
  });

  it("should get active users with repos", () => {
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "o",
      repo: "r1",
      branch: "main",
      cloneUrl: "https://github.com/o/r1.git",
    });
    insertRepositoryForUser(db, {
      userId: "user1",
      owner: "o",
      repo: "r2",
      branch: "main",
      cloneUrl: "https://github.com/o/r2.git",
    });
    insertRepositoryForUser(db, {
      userId: "user2",
      owner: "o",
      repo: "r3",
      branch: "main",
      cloneUrl: "https://github.com/o/r3.git",
    });

    const users = getActiveUsersWithRepos(db);
    expect(users).toHaveLength(2);
    expect(users).toContain("user1");
    expect(users).toContain("user2");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/repository.test.ts`
Expected: FAIL — 새 함수들이 존재하지 않음

- [ ] **Step 3: repository.ts에 사용자 스코핑 함수 추가**

`src/infra/db/repository.ts` 파일 끝에 다음을 추가 (기존 함수는 유지 — 과도기 호환):

```typescript
interface InsertRepoForUserInput {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  cloneUrl: string;
}

interface InsertSyncLogForUserInput {
  repositoryId: number;
  userId: string;
  status: "success" | "error";
  commitsProcessed: number;
  tasksCreated: number;
  errorMessage: string | null;
}

export function insertRepositoryForUser(db: Database.Database, input: InsertRepoForUserInput): void {
  db.prepare(
    "INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)"
  ).run(input.owner, input.repo, input.branch, input.userId, input.cloneUrl);
}

export function getRepositoriesByUser(db: Database.Database, userId: string) {
  return db.prepare(
    "SELECT * FROM repositories WHERE user_id = ? AND is_active = 1"
  ).all(userId) as any[];
}

export function getRepositoryByIdAndUser(db: Database.Database, id: number, userId: string) {
  return db.prepare(
    "SELECT * FROM repositories WHERE id = ? AND user_id = ?"
  ).get(id, userId) as any | undefined;
}

export function deleteRepositoryForUser(db: Database.Database, id: number, userId: string): boolean {
  const result = db.prepare(
    "DELETE FROM repositories WHERE id = ? AND user_id = ?"
  ).run(id, userId);
  return result.changes > 0;
}

export function insertSyncLogForUser(db: Database.Database, input: InsertSyncLogForUserInput): void {
  db.prepare(
    "INSERT INTO sync_logs (repository_id, user_id, status, commits_processed, tasks_created, error_message, completed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(input.repositoryId, input.userId, input.status, input.commitsProcessed, input.tasksCreated, input.errorMessage);
}

export function getActiveUsersWithRepos(db: Database.Database): string[] {
  const rows = db.prepare(
    "SELECT DISTINCT user_id FROM repositories WHERE is_active = 1 AND user_id != ''"
  ).all() as any[];
  return rows.map((r: any) => r.user_id);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/repository.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/infra/db/repository.ts src/__tests__/infra/db/repository.test.ts
git commit -m "feat: 사용자 스코핑 저장소 DB 함수 추가"
```

---

### Task 6: Git CLI 래퍼 구현

**Files:**
- Create: `src/infra/git/git-client.ts`
- Create: `src/infra/git/parse-git-url.ts`
- Test: `src/__tests__/infra/git/parse-git-url.test.ts`

- [ ] **Step 1: Git URL 파서 테스트 작성**

```typescript
// src/__tests__/infra/git/parse-git-url.test.ts
import { describe, it, expect } from "vitest";
import { parseGitUrl, buildAuthenticatedUrl } from "@/infra/git/parse-git-url";

describe("parseGitUrl", () => {
  it("should parse GitHub HTTPS URL", () => {
    const result = parseGitUrl("https://github.com/octocat/hello-world.git");
    expect(result).toEqual({ host: "github.com", owner: "octocat", repo: "hello-world" });
  });

  it("should parse GitHub URL without .git suffix", () => {
    const result = parseGitUrl("https://github.com/octocat/hello-world");
    expect(result).toEqual({ host: "github.com", owner: "octocat", repo: "hello-world" });
  });

  it("should parse GitLab URL", () => {
    const result = parseGitUrl("https://gitlab.com/group/project.git");
    expect(result).toEqual({ host: "gitlab.com", owner: "group", repo: "project" });
  });

  it("should parse Gitea self-hosted URL", () => {
    const result = parseGitUrl("https://gitea.company.com/team/repo.git");
    expect(result).toEqual({ host: "gitea.company.com", owner: "team", repo: "repo" });
  });

  it("should parse URL with nested groups (GitLab subgroups)", () => {
    const result = parseGitUrl("https://gitlab.com/group/subgroup/project.git");
    expect(result).toEqual({ host: "gitlab.com", owner: "group/subgroup", repo: "project" });
  });

  it("should throw on invalid URL", () => {
    expect(() => parseGitUrl("not-a-url")).toThrow();
  });

  it("should throw on non-HTTPS URL", () => {
    expect(() => parseGitUrl("git@github.com:owner/repo.git")).toThrow();
  });
});

describe("buildAuthenticatedUrl", () => {
  it("should insert token into GitHub URL", () => {
    const result = buildAuthenticatedUrl("https://github.com/octocat/hello-world.git", "ghp_token123");
    expect(result).toBe("https://ghp_token123@github.com/octocat/hello-world.git");
  });

  it("should insert token into GitLab URL", () => {
    const result = buildAuthenticatedUrl("https://gitlab.com/group/project.git", "glpat-abc");
    expect(result).toBe("https://glpat-abc@gitlab.com/group/project.git");
  });

  it("should handle URL without .git suffix", () => {
    const result = buildAuthenticatedUrl("https://github.com/owner/repo", "token");
    expect(result).toBe("https://token@github.com/owner/repo");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/infra/git/parse-git-url.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: parse-git-url.ts 구현**

```typescript
// src/infra/git/parse-git-url.ts

interface ParsedGitUrl {
  host: string;
  owner: string;
  repo: string;
}

export function parseGitUrl(url: string): ParsedGitUrl {
  if (!url.startsWith("https://")) {
    throw new Error("Only HTTPS Git URLs are supported");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Git URL: ${url}`);
  }

  const pathParts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (pathParts.length < 2) {
    throw new Error(`Invalid Git URL path: ${url}`);
  }

  const repo = pathParts[pathParts.length - 1];
  const owner = pathParts.slice(0, -1).join("/");

  return { host: parsed.host, owner, repo };
}

export function buildAuthenticatedUrl(cloneUrl: string, token: string): string {
  const url = new URL(cloneUrl);
  url.username = token;
  url.password = "";
  return url.toString().replace(/:@/, "@");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/infra/git/parse-git-url.test.ts`
Expected: PASS

- [ ] **Step 5: git-client.ts 구현**

```typescript
// src/infra/git/git-client.ts
import { execFile } from "child_process";
import { promisify } from "util";
import type { CommitRecord } from "@/core/types";
import { buildAuthenticatedUrl, parseGitUrl } from "@/infra/git/parse-git-url";

const execFileAsync = promisify(execFile);

const logFormat = "--format=%H%n%an%n%aI%n%s%n---END---";

export async function cloneRepository(cloneUrl: string, destPath: string, token: string): Promise<void> {
  const authUrl = buildAuthenticatedUrl(cloneUrl, token);
  await execFileAsync("git", ["clone", "--bare", authUrl, destPath], { timeout: 120_000 });
}

export async function pullRepository(repoPath: string): Promise<void> {
  await execFileAsync("git", ["--git-dir", repoPath, "fetch", "origin"], { timeout: 60_000 });
}

export async function getCommitsSince(
  repoPath: string,
  branch: string,
  cloneUrl: string,
  sinceSha?: string | null
): Promise<CommitRecord[]> {
  const range = sinceSha ? `${sinceSha}..origin/${branch}` : `origin/${branch}`;
  const args = ["--git-dir", repoPath, "log", range, logFormat, "--numstat"];

  const { stdout } = await execFileAsync("git", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (!stdout.trim()) return [];

  const { owner, repo: repoName } = parseGitUrl(cloneUrl);
  return parseGitLog(stdout, owner, repoName, branch);
}

export async function getCommitDiff(repoPath: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["--git-dir", repoPath, "diff", `${sha}^..${sha}`],
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

function parseGitLog(output: string, owner: string, repoName: string, branch: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  const entries = output.split("---END---\n").filter((e) => e.trim());

  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    if (lines.length < 4) continue;

    const sha = lines[0];
    const author = lines[1];
    const date = lines[2];
    const message = lines[3];

    const statLines = lines.slice(4).filter((l) => l.trim());
    let additions = 0;
    let deletions = 0;
    const filesChanged: string[] = [];

    for (const statLine of statLines) {
      const match = statLine.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        additions += match[1] === "-" ? 0 : parseInt(match[1], 10);
        deletions += match[2] === "-" ? 0 : parseInt(match[2], 10);
        filesChanged.push(match[3]);
      }
    }

    commits.push({
      sha,
      message,
      author,
      date,
      repoOwner: owner,
      repoName,
      branch,
      filesChanged,
      additions,
      deletions,
    });
  }

  return commits;
}
```

- [ ] **Step 6: 커밋**

```bash
git add src/infra/git/git-client.ts src/infra/git/parse-git-url.ts src/__tests__/infra/git/parse-git-url.test.ts
git commit -m "feat: Git CLI 래퍼 및 URL 파서 구현"
```

---

### Task 7: Notion 클라이언트를 사용자별 키로 전환

**Files:**
- Modify: `src/infra/notion/notion-client.ts`
- Test: `src/__tests__/infra/notion/notion-properties.test.ts`

- [ ] **Step 1: 기존 프로퍼티 빌더 테스트 작성 (변경 없음 확인)**

```typescript
// src/__tests__/infra/notion/notion-properties.test.ts
import { describe, it, expect } from "vitest";
import { buildCommitLogProperties, buildDailyTaskProperties } from "@/infra/notion/notion-client";
import type { CommitRecord, DailyTask } from "@/core/types";

describe("buildCommitLogProperties", () => {
  it("should build correct properties from CommitRecord", () => {
    const commit: CommitRecord = {
      sha: "abc123",
      message: "feat: add login",
      author: "dev",
      date: "2026-04-09T10:00:00Z",
      repoOwner: "owner",
      repoName: "repo",
      branch: "main",
      filesChanged: ["src/auth.ts"],
      additions: 50,
      deletions: 10,
    };

    const props = buildCommitLogProperties(commit);
    expect(props.Title.title[0].text.content).toBe("feat: add login");
    expect(props.Project.select.name).toBe("repo");
    expect(props["Commit SHA"].rich_text[0].text.content).toBe("abc123");
  });
});

describe("buildDailyTaskProperties", () => {
  it("should build correct properties from DailyTask", () => {
    const task: DailyTask = {
      title: "로그인 기능 구현",
      description: "OAuth2 기반 로그인",
      date: "2026-04-09",
      project: "repo",
      complexity: "Medium",
      commitShas: ["abc123"],
    };

    const props = buildDailyTaskProperties(task);
    expect(props["제목"].title[0].text.content).toBe("로그인 기능 구현");
    expect(props["프로젝트"].select.name).toBe("repo");
  });
});
```

- [ ] **Step 2: 테스트 통과 확인 (기존 코드와 호환)**

Run: `npx vitest run src/__tests__/infra/notion/notion-properties.test.ts`
Expected: PASS (프로퍼티 빌더는 변경 없이 동작해야 함)

- [ ] **Step 3: notion-client.ts를 사용자별 키 지원으로 수정**

`src/infra/notion/notion-client.ts` 전체를 다음으로 교체:

```typescript
// src/infra/notion/notion-client.ts
import { Client } from "@notionhq/client";
import type { CommitRecord, DailyTask } from "@/core/types";

interface NotionUserConfig {
  apiKey: string;
  commitDbId: string;
  taskDbId: string;
}

function createClient(apiKey: string): Client {
  return new Client({ auth: apiKey });
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

export async function createCommitLogPage(config: NotionUserConfig, commit: CommitRecord): Promise<string> {
  const client = createClient(config.apiKey);
  const response = await client.pages.create({
    parent: { database_id: config.commitDbId },
    properties: buildCommitLogProperties(commit) as any,
  });
  return response.id;
}

export async function createDailyTaskPage(config: NotionUserConfig, task: DailyTask): Promise<string> {
  const client = createClient(config.apiKey);
  const response = await client.pages.create({
    parent: { database_id: config.taskDbId },
    properties: buildDailyTaskProperties(task) as any,
  });
  return response.id;
}

async function queryDatabase(client: Client, databaseId: string, filter?: any): Promise<any> {
  return client.request({
    path: `databases/${databaseId}/query`,
    method: "post",
    body: { filter },
  });
}

export async function isCommitAlreadySynced(config: NotionUserConfig, sha: string): Promise<boolean> {
  const client = createClient(config.apiKey);
  const response = await queryDatabase(client, config.commitDbId, {
    property: "Commit SHA",
    rich_text: { equals: sha },
  });
  return response.results.length > 0;
}

export async function isDailyTaskExists(config: NotionUserConfig, project: string, date: string): Promise<string | null> {
  const client = createClient(config.apiKey);
  const response = await queryDatabase(client, config.taskDbId, {
    and: [
      { property: "프로젝트", select: { equals: project } },
      { property: "작업일", date: { equals: date } },
    ],
  });
  return response.results.length > 0 ? response.results[0].id : null;
}

export async function updateDailyTaskPage(config: NotionUserConfig, pageId: string, task: DailyTask): Promise<void> {
  const client = createClient(config.apiKey);
  await client.pages.update({
    page_id: pageId,
    properties: buildDailyTaskProperties(task) as any,
  });
}
```

- [ ] **Step 4: 프로퍼티 빌더 테스트 재확인**

Run: `npx vitest run src/__tests__/infra/notion/notion-properties.test.ts`
Expected: PASS (빌더 함수 시그니처는 변경 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/infra/notion/notion-client.ts src/__tests__/infra/notion/notion-properties.test.ts
git commit -m "refactor: Notion 클라이언트를 사용자별 API 키 지원으로 전환"
```

---

### Task 8: 자격증명 API 라우트 구현

**Files:**
- Create: `src/app/api/credentials/route.ts`

- [ ] **Step 1: credentials API 라우트 구현**

```typescript
// src/app/api/credentials/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import {
  insertCredential,
  getCredentialsByUser,
  getCredentialByUserAndProvider,
  updateCredential,
  deleteCredential,
} from "@/infra/db/credential";
import { encrypt, maskToken } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

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
  const { provider, token, label, metadata } = body;

  if (!provider || !token) {
    return NextResponse.json({ error: "provider and token are required" }, { status: 400 });
  }
  if (provider !== "git" && provider !== "notion") {
    return NextResponse.json({ error: "provider must be 'git' or 'notion'" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (existing) {
      return NextResponse.json({ error: `${provider} credential already exists. Use PUT to update.` }, { status: 409 });
    }

    const encrypted = encrypt(token);
    insertCredential(db, {
      userId: session.user.id,
      provider,
      credential: encrypted,
      label: label || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return NextResponse.json({ message: "Credential saved" }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, token, label, metadata } = body;

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (!existing) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    updateCredential(db, existing.id, {
      credential: token ? encrypt(token) : existing.credential,
      label: label !== undefined ? label : existing.label,
      metadata: metadata !== undefined ? JSON.stringify(metadata) : existing.metadata,
    });

    return NextResponse.json({ message: "Credential updated" });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (!existing) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    deleteCredential(db, existing.id);
    return NextResponse.json({ message: "Credential deleted" });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/credentials/route.ts
git commit -m "feat: 자격증명 CRUD API 라우트 구현"
```

---

### Task 9: 저장소 API 라우트를 사용자 스코핑으로 전환

**Files:**
- Modify: `src/app/api/repos/route.ts`
- Create: `src/app/api/repos/[id]/sync/route.ts`

- [ ] **Step 1: repos/route.ts를 사용자 스코핑으로 전면 수정**

`src/app/api/repos/route.ts` 전체를 다음으로 교체:

```typescript
// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { createTables } from "@/infra/db/schema";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { cloneRepository } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  try {
    const repos = getRepositoriesByUser(db, session.user.id);
    return NextResponse.json(repos);
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { cloneUrl, branch = "main" } = body;

  if (!cloneUrl) {
    return NextResponse.json({ error: "cloneUrl is required" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseGitUrl(cloneUrl);
  } catch {
    return NextResponse.json({ error: "Invalid Git URL. Only HTTPS URLs are supported." }, { status: 400 });
  }

  const db = getDb();
  try {
    // Git PAT 확인
    const gitCred = getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) {
      return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
    }

    const token = decrypt(gitCred.credential);
    const clonePath = join(process.cwd(), "data", "repos", session.user.id, parsed.owner, `${parsed.repo}.git`);

    insertRepositoryForUser(db, {
      userId: session.user.id,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      cloneUrl,
    });

    // 비동기로 bare clone 시작 (응답은 즉시 반환)
    const repoRow = db.prepare(
      "SELECT id FROM repositories WHERE user_id = ? AND clone_url = ?"
    ).get(session.user.id, cloneUrl) as any;

    db.prepare("UPDATE repositories SET clone_path = ? WHERE id = ?").run(clonePath, repoRow.id);

    // clone은 백그라운드로 실행
    (async () => {
      try {
        await mkdir(join(process.cwd(), "data", "repos", session.user.id, parsed!.owner), { recursive: true });
        await cloneRepository(cloneUrl, clonePath, token);
        console.log(`[Repos] Cloned ${cloneUrl} to ${clonePath}`);
      } catch (err) {
        console.error(`[Repos] Failed to clone ${cloneUrl}:`, err);
      }
    })();

    return NextResponse.json({ message: "Repository registered. Cloning in progress." }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    const deleted = deleteRepositoryForUser(db, Number(id), session.user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }

    // clone 디렉토리 정리
    if (repo.clone_path) {
      rm(repo.clone_path, { recursive: true, force: true }).catch(console.error);
    }

    return NextResponse.json({ message: "Deleted" });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: 수동 동기화 API 라우트 생성**

```typescript
// src/app/api/repos/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import { getRepositoryByIdAndUser, updateLastSyncedSha, insertSyncLogForUser } from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { pullRepository, getCommitsSince, getCommitDiff } from "@/infra/git/git-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { createCommitLogPage, createDailyTaskPage, isCommitAlreadySynced, isDailyTaskExists, updateDailyTaskPage } from "@/infra/notion/notion-client";
import { auth } from "@/lib/auth";
import type { CommitRecord } from "@/core/types";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }
    if (!repo.clone_path) {
      return NextResponse.json({ error: "Repository not yet cloned" }, { status: 400 });
    }

    // Git PAT 복호화
    const gitCred = getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) {
      return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });
    }

    // Notion 설정 로드
    const notionCred = getCredentialByUserAndProvider(db, session.user.id, "notion");
    if (!notionCred || !notionCred.metadata) {
      return NextResponse.json({ error: "Notion credentials not configured" }, { status: 400 });
    }
    const notionMeta = JSON.parse(notionCred.metadata);
    const notionConfig = {
      apiKey: decrypt(notionCred.credential),
      commitDbId: notionMeta.notionCommitDbId,
      taskDbId: notionMeta.notionTaskDbId,
    };

    // 1. git fetch
    await pullRepository(repo.clone_path);

    // 2. 새 커밋 수집
    const commits = await getCommitsSince(repo.clone_path, repo.branch, repo.clone_url, repo.last_synced_sha);
    if (commits.length === 0) {
      return NextResponse.json({ message: "No new commits", commitsProcessed: 0, tasksCreated: 0 });
    }

    // 3. 커밋 로그 Notion 동기화
    for (const commit of commits) {
      const alreadySynced = await isCommitAlreadySynced(notionConfig, commit.sha);
      if (!alreadySynced) {
        await createCommitLogPage(notionConfig, commit);
      }
    }

    // 4. 모호한 커밋 보강
    const enrichedCommits: CommitRecord[] = [];
    for (const commit of commits) {
      if (isAmbiguousCommitMessage(commit.message)) {
        const diff = await getCommitDiff(repo.clone_path, commit.sha);
        const summary = await analyzeCommitWithDiff(commit, diff);
        enrichedCommits.push({ ...commit, message: summary });
      } else {
        enrichedCommits.push(commit);
      }
    }

    // 5. 그룹핑 + Gemini 분석 + Notion 동기화
    const groups = groupCommitsByDateAndProject(enrichedCommits);
    let tasksCreated = 0;
    for (const group of groups) {
      const tasks = await analyzeCommits(group.commits, group.project, group.date);
      for (const task of tasks) {
        const existingPageId = await isDailyTaskExists(notionConfig, task.project, task.date);
        if (existingPageId) {
          await updateDailyTaskPage(notionConfig, existingPageId, task);
        } else {
          await createDailyTaskPage(notionConfig, task);
          tasksCreated++;
        }
      }
    }

    // 6. SHA 업데이트 + 로그
    updateLastSyncedSha(db, repo.id, commits[0].sha);
    insertSyncLogForUser(db, {
      repositoryId: repo.id,
      userId: session.user.id,
      status: "success",
      commitsProcessed: commits.length,
      tasksCreated,
      errorMessage: null,
    });

    return NextResponse.json({ message: "Sync complete", commitsProcessed: commits.length, tasksCreated });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    insertSyncLogForUser(db, {
      repositoryId: Number(id),
      userId: session.user.id,
      status: "error",
      commitsProcessed: 0,
      tasksCreated: 0,
      errorMessage: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/repos/route.ts src/app/api/repos/[id]/sync/route.ts
git commit -m "feat: 저장소 API를 사용자 스코핑으로 전환, 수동 동기화 API 추가"
```

---

### Task 10: 스케줄러를 사용자별 순회로 전환

**Files:**
- Modify: `src/scheduler/polling-manager.ts`

- [ ] **Step 1: polling-manager.ts 전면 수정**

`src/scheduler/polling-manager.ts` 전체를 다음으로 교체:

```typescript
// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import {
  getActiveUsersWithRepos,
  getRepositoriesByUser,
  updateLastSyncedSha,
  insertSyncLogForUser,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { pullRepository, getCommitsSince, getCommitDiff } from "@/infra/git/git-client";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import {
  createCommitLogPage,
  createDailyTaskPage,
  isCommitAlreadySynced,
  isDailyTaskExists,
  updateDailyTaskPage,
} from "@/infra/notion/notion-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import type { CommitRecord } from "@/core/types";

let db: Database.Database | null = null;
let cronTask: ScheduledTask | null = null;
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
    nextRunAt: cronTask ? null : null,
    intervalMin: 15,
  };
}

async function enrichAmbiguousCommits(commits: CommitRecord[], repoPath: string): Promise<CommitRecord[]> {
  const enriched: CommitRecord[] = [];
  for (const commit of commits) {
    if (isAmbiguousCommitMessage(commit.message)) {
      const diff = await getCommitDiff(repoPath, commit.sha);
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
    const userIds = getActiveUsersWithRepos(database);

    for (const userId of userIds) {
      try {
        // 사용자 자격증명 로드
        const gitCred = getCredentialByUserAndProvider(database, userId, "git");
        if (!gitCred) {
          console.log(`[Scheduler] User ${userId}: no git credential, skipping`);
          continue;
        }

        const notionCred = getCredentialByUserAndProvider(database, userId, "notion");
        if (!notionCred || !notionCred.metadata) {
          console.log(`[Scheduler] User ${userId}: no notion credential, skipping`);
          continue;
        }

        const notionMeta = JSON.parse(notionCred.metadata);
        const notionConfig = {
          apiKey: decrypt(notionCred.credential),
          commitDbId: notionMeta.notionCommitDbId,
          taskDbId: notionMeta.notionTaskDbId,
        };

        const repos = getRepositoriesByUser(database, userId);

        for (const repo of repos) {
          if (!repo.clone_path) continue;

          try {
            await pullRepository(repo.clone_path);
            const commits = await getCommitsSince(repo.clone_path, repo.branch, repo.clone_url, repo.last_synced_sha);

            if (commits.length === 0) {
              console.log(`[Scheduler] ${repo.owner}/${repo.repo}: no new commits`);
              continue;
            }

            console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${commits.length} new commits`);

            // 커밋 로그 동기화
            for (const commit of commits) {
              const alreadySynced = await isCommitAlreadySynced(notionConfig, commit.sha);
              if (!alreadySynced) {
                await createCommitLogPage(notionConfig, commit);
              }
            }

            // 모호한 커밋 보강
            const enrichedCommits = await enrichAmbiguousCommits(commits, repo.clone_path);

            // 그룹핑 + 분석 + 태스크 생성
            const groups = groupCommitsByDateAndProject(enrichedCommits);
            let tasksCreated = 0;
            for (const group of groups) {
              const tasks = await analyzeCommits(group.commits, group.project, group.date);
              for (const task of tasks) {
                const existingPageId = await isDailyTaskExists(notionConfig, task.project, task.date);
                if (existingPageId) {
                  await updateDailyTaskPage(notionConfig, existingPageId, task);
                } else {
                  await createDailyTaskPage(notionConfig, task);
                  tasksCreated++;
                }
              }
            }

            updateLastSyncedSha(database, repo.id, commits[0].sha);
            insertSyncLogForUser(database, {
              repositoryId: repo.id,
              userId,
              status: "success",
              commitsProcessed: commits.length,
              tasksCreated,
              errorMessage: null,
            });

            console.log(`[Scheduler] ${repo.owner}/${repo.repo}: synced ${commits.length} commits, created ${tasksCreated} tasks`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            insertSyncLogForUser(database, {
              repositoryId: repo.id,
              userId,
              status: "error",
              commitsProcessed: 0,
              tasksCreated: 0,
              errorMessage: errorMsg,
            });
            console.error(`[Scheduler] ${repo.owner}/${repo.repo}: sync failed -`, errorMsg);
          }
        }
      } catch (error) {
        console.error(`[Scheduler] User ${userId}: failed -`, error);
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

  runSyncCycle().catch(console.error);

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

- [ ] **Step 2: 커밋**

```bash
git add src/scheduler/polling-manager.ts
git commit -m "refactor: 스케줄러를 사용자별 순회로 전환"
```

---

### Task 11: 설정 페이지 UI — 자격증명 관리

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: settings/page.tsx 전면 수정**

`src/app/(dashboard)/settings/page.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Credential {
  id: number;
  provider: string;
  label: string | null;
  metadata: Record<string, string> | null;
  maskedToken: string;
}

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [gitToken, setGitToken] = useState("");
  const [gitLabel, setGitLabel] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [notionCommitDbId, setNotionCommitDbId] = useState("");
  const [notionTaskDbId, setNotionTaskDbId] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchCredentials = () => {
    fetch("/api/credentials").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setCredentials(data);
    });
  };

  useEffect(() => { fetchCredentials(); }, []);

  const gitCred = credentials.find((c) => c.provider === "git");
  const notionCred = credentials.find((c) => c.provider === "notion");

  const handleSaveGit = async () => {
    if (!gitToken) { toast.error("토큰을 입력하세요"); return; }
    setLoading(true);
    try {
      const method = gitCred ? "PUT" : "POST";
      const res = await fetch("/api/credentials", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "git", token: gitToken, label: gitLabel || null }),
      });
      if (res.ok) {
        toast.success("Git PAT이 저장되었습니다");
        setGitToken("");
        setGitLabel("");
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "저장 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotion = async () => {
    if (!notionToken || !notionCommitDbId || !notionTaskDbId) {
      toast.error("모든 필드를 입력하세요");
      return;
    }
    setLoading(true);
    try {
      const method = notionCred ? "PUT" : "POST";
      const res = await fetch("/api/credentials", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "notion",
          token: notionToken,
          metadata: { notionCommitDbId, notionTaskDbId },
        }),
      });
      if (res.ok) {
        toast.success("Notion 설정이 저장되었습니다");
        setNotionToken("");
        setNotionCommitDbId("");
        setNotionTaskDbId("");
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "저장 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (provider: string) => {
    const res = await fetch(`/api/credentials?provider=${provider}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("자격증명이 삭제되었습니다");
      fetchCredentials();
    }
  };

  return (
    <div>
      <Header title="설정" description="외부 서비스 자격증명을 관리합니다" />

      <div className="space-y-6 max-w-2xl">
        {/* Git PAT */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Git Personal Access Token</CardTitle>
                <CardDescription>GitHub, GitLab, Gitea 등의 PAT을 등록합니다</CardDescription>
              </div>
              {gitCred && <Badge variant="default">등록됨</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {gitCred && (
              <div className="mb-4 p-3 bg-muted rounded-md flex items-center justify-between">
                <div>
                  <span className="text-sm text-muted-foreground">현재 토큰: </span>
                  <code className="text-sm">{gitCred.maskedToken}</code>
                  {gitCred.label && <span className="text-sm text-muted-foreground ml-2">({gitCred.label})</span>}
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("git")}>삭제</Button>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">토큰</label>
                <Input
                  type="password"
                  placeholder="ghp_xxxx 또는 glpat-xxxx"
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">라벨 (선택)</label>
                <Input
                  placeholder="예: 회사 GitHub PAT"
                  value={gitLabel}
                  onChange={(e) => setGitLabel(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveGit} disabled={loading}>
                {gitCred ? "토큰 갱신" : "토큰 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notion API */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Notion 연동</CardTitle>
                <CardDescription>Notion API 키와 데이터베이스 ID를 설정합니다</CardDescription>
              </div>
              {notionCred && <Badge variant="default">등록됨</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {notionCred && (
              <div className="mb-4 p-3 bg-muted rounded-md flex items-center justify-between">
                <div>
                  <span className="text-sm text-muted-foreground">현재 토큰: </span>
                  <code className="text-sm">{notionCred.maskedToken}</code>
                  {notionCred.metadata && (
                    <div className="text-xs text-muted-foreground mt-1">
                      커밋 DB: {notionCred.metadata.notionCommitDbId?.slice(0, 8)}...
                      {" / "}태스크 DB: {notionCred.metadata.notionTaskDbId?.slice(0, 8)}...
                    </div>
                  )}
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("notion")}>삭제</Button>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Notion API 키</label>
                <Input
                  type="password"
                  placeholder="ntn_xxxx"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">커밋 로그 DB ID</label>
                <Input
                  placeholder="Notion 데이터베이스 ID"
                  value={notionCommitDbId}
                  onChange={(e) => setNotionCommitDbId(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">일일 태스크 DB ID</label>
                <Input
                  placeholder="Notion 데이터베이스 ID"
                  value={notionTaskDbId}
                  onChange={(e) => setNotionTaskDbId(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveNotion} disabled={loading}>
                {notionCred ? "설정 갱신" : "설정 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

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

- [ ] **Step 2: 커밋**

```bash
git add src/app/(dashboard)/settings/page.tsx
git commit -m "feat: 설정 페이지에 Git PAT/Notion 자격증명 관리 UI 구현"
```

---

### Task 12: 저장소 관리 페이지 UI 전환

**Files:**
- Modify: `src/app/(dashboard)/repos/page.tsx`

- [ ] **Step 1: repos/page.tsx 전면 수정**

`src/app/(dashboard)/repos/page.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/data-display/empty-state";
import { toast } from "sonner";

export default function ReposPage() {
  const [repos, setRepos] = useState<any[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  const fetchRepos = () => {
    fetch("/api/repos").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setRepos(data);
    });
  };

  useEffect(() => { fetchRepos(); }, []);

  const handleAdd = async () => {
    if (!cloneUrl) {
      toast.error("Git 저장소 URL을 입력하세요");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloneUrl, branch }),
      });

      if (res.ok) {
        toast.success("저장소가 등록되었습니다. 클론 진행 중...");
        setShowDialog(false);
        setCloneUrl("");
        setBranch("main");
        fetchRepos();
      } else {
        const data = await res.json();
        toast.error(data.error || "등록 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/repos?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("저장소가 삭제되었습니다");
      fetchRepos();
    }
  };

  const handleSync = async (id: number) => {
    setSyncing(id);
    try {
      const res = await fetch(`/api/repos/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`동기화 완료: ${data.commitsProcessed}개 커밋, ${data.tasksCreated}개 태스크`);
        fetchRepos();
      } else {
        toast.error(data.error || "동기화 실패");
      }
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div>
      <Header
        title="저장소 관리"
        description="모니터링할 Git 저장소를 등록하고 관리합니다"
        actions={<Button onClick={() => setShowDialog(true)}>저장소 추가</Button>}
      />

      {repos.length === 0 ? (
        <EmptyState
          title="등록된 저장소가 없습니다"
          description="Git 저장소를 추가하여 커밋 모니터링을 시작하세요. 먼저 설정에서 Git PAT을 등록해주세요."
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
                <TableCell>
                  <div>
                    <span className="font-medium">{repo.owner}/{repo.repo}</span>
                    <div className="text-xs text-muted-foreground truncate max-w-xs">{repo.clone_url}</div>
                  </div>
                </TableCell>
                <TableCell>{repo.branch}</TableCell>
                <TableCell className="font-mono text-xs">{repo.last_synced_sha?.slice(0, 7) || "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Badge variant={repo.is_active ? "default" : "secondary"}>
                      {repo.is_active ? "활성" : "비활성"}
                    </Badge>
                    {repo.clone_path ? (
                      <Badge variant="outline">클론됨</Badge>
                    ) : (
                      <Badge variant="secondary">클론 중</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(repo.id)}
                      disabled={syncing === repo.id || !repo.clone_path}
                    >
                      {syncing === repo.id ? "동기화 중..." : "지금 동기화"}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(repo.id)}>삭제</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장소 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Git 저장소 URL</label>
              <Input
                placeholder="https://github.com/owner/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">GitHub, GitLab, Gitea 등 HTTPS URL을 지원합니다</p>
            </div>
            <div>
              <label className="text-sm font-medium">브랜치</label>
              <Input
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>취소</Button>
            <Button onClick={handleAdd} disabled={loading}>
              {loading ? "등록 중..." : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/(dashboard)/repos/page.tsx
git commit -m "feat: 저장소 페이지를 범용 Git URL + 동기화 버튼으로 전환"
```

---

### Task 13: .gitignore 및 환경 변수 정리

**Files:**
- Modify: `.gitignore`
- Modify: `.env.local` (또는 `.env.example`)

- [ ] **Step 1: .gitignore에 clone 디렉토리 추가**

`.gitignore`에 다음 줄 추가 (없으면):

```
data/repos/
```

- [ ] **Step 2: .env.local에서 사용자별로 전환된 변수에 주석 추가**

```env
# --- 사용자별 관리 (설정 페이지에서 등록) ---
# GITHUB_TOKEN=  (제거됨 — 사용자별 Git PAT으로 전환)
# NOTION_API_KEY=  (제거됨 — 사용자별 Notion API 키로 전환)
# NOTION_COMMIT_DB_ID=  (제거됨 — 사용자별 설정으로 전환)
# NOTION_TASK_DB_ID=  (제거됨 — 사용자별 설정으로 전환)

# --- 글로벌 유지 ---
GEMINI_API_KEY=
AUTH_HRMS_ID=
AUTH_HRMS_SECRET=
AUTH_HRMS_ISSUER=https://hrms.cudo.co.kr:9700
AUTH_SECRET=
AUTH_URL=http://localhost:3000
```

- [ ] **Step 3: 커밋**

```bash
git add .gitignore .env.local
git commit -m "chore: clone 디렉토리 gitignore, 사용자별 전환 환경 변수 정리"
```

---

### Task 14: 빌드 확인 및 기존 테스트 수정

**Files:**
- Possibly modify: existing test files if they break due to Notion client signature changes

- [ ] **Step 1: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 기존 테스트 중 Notion 클라이언트 시그니처 변경으로 인한 실패 확인

- [ ] **Step 2: 실패한 테스트 수정**

Notion 클라이언트 함수의 첫 번째 인자가 `NotionUserConfig`로 변경되었으므로, 기존 테스트에서 호출부를 수정한다. 구체적인 수정 내용은 실패 메시지에 따라 결정.

- [ ] **Step 3: 빌드 확인**

Run: `npx next build`
Expected: 빌드 성공. 타입 에러 없음.

- [ ] **Step 4: 실패한 항목 수정 후 커밋**

```bash
git add -A
git commit -m "fix: Notion 클라이언트 시그니처 변경에 따른 테스트/빌드 오류 수정"
```

---

### Task 15: DB 마이그레이션 처리 (기존 데이터 호환)

**Files:**
- Modify: `src/infra/db/schema.ts`

- [ ] **Step 1: 마이그레이션 로직 추가**

SQLite의 `CREATE TABLE IF NOT EXISTS`는 기존 테이블이 있으면 무시하므로, 기존 DB에 새 컬럼이 추가되지 않는다. `schema.ts`에 마이그레이션 함수를 추가:

`createTables` 함수 아래에 추가:

```typescript
export function migrateSchema(db: Database.Database): void {
  // repositories 테이블에 새 컬럼 추가 (이미 있으면 무시)
  const repoColumns = db.prepare("PRAGMA table_info(repositories)").all() as any[];
  const repoColumnNames = repoColumns.map((c: any) => c.name);

  if (!repoColumnNames.includes("user_id")) {
    db.exec("ALTER TABLE repositories ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }
  if (!repoColumnNames.includes("clone_url")) {
    db.exec("ALTER TABLE repositories ADD COLUMN clone_url TEXT NOT NULL DEFAULT ''");
  }
  if (!repoColumnNames.includes("clone_path")) {
    db.exec("ALTER TABLE repositories ADD COLUMN clone_path TEXT");
  }

  // sync_logs 테이블에 user_id 추가
  const syncColumns = db.prepare("PRAGMA table_info(sync_logs)").all() as any[];
  const syncColumnNames = syncColumns.map((c: any) => c.name);

  if (!syncColumnNames.includes("user_id")) {
    db.exec("ALTER TABLE sync_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }
}
```

- [ ] **Step 2: getDb() 호출부에서 migrateSchema도 호출하도록 수정**

`src/app/api/repos/route.ts`, `src/app/api/credentials/route.ts`, `src/scheduler/polling-manager.ts`, `src/lib/auth.ts`의 `getDb()` 함수에서 `createTables` 호출 뒤 `migrateSchema(db)`도 호출:

```typescript
import { createTables, migrateSchema } from "@/infra/db/schema";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/infra/db/schema.ts src/app/api/repos/route.ts src/app/api/credentials/route.ts src/scheduler/polling-manager.ts src/lib/auth.ts
git commit -m "feat: 기존 DB 호환을 위한 스키마 마이그레이션 함수 추가"
```
