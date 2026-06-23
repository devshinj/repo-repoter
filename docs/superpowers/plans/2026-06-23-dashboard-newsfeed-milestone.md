# Dashboard Newsfeed & Milestone 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RSS 기반 뉴스피드 + 자연어 마일스톤으로 대시보드를 개편하여, 프로젝트/저장소별 최신 활동 브리핑을 제공한다.

**Architecture:** RSS Atom/RSS 피드를 3시간 주기(+대시보드 접속 시)로 수집하고, Qwen LLM으로 작업자별 활동 브리핑을 생성하여 DB에 캐시한다. 마일스톤은 자연어 입력 → LLM 구조화 → 사용자 확인 흐름을 따른다. 프로젝트 그룹핑은 사용자 직접 설정 + LLM 자동 제안을 지원한다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, SQLite(better-sqlite3), OpenAI SDK(vLLM), node-cron, Tailwind CSS + shadcn/ui

## Global Constraints

- 레이어 의존 규칙: `core/` → `infra/` 금지. `core/`는 순수 함수만
- 파일명 kebab-case, 타입 PascalCase, 함수 camelCase
- import 경로 `@/` 별칭 필수, 상대 경로 금지 (같은 디렉토리 제외)
- 공유 타입은 `src/core/` 하위에 정의. 중복 정의 금지
- 테스트: Vitest. `src/__tests__/` 하위에 레이어 구조 미러링
- 커밋 메시지: 영문 prefix (`feat:`, `fix:` 등) + 한글 본문
- shadcn/ui 기본 컴포넌트는 `npx shadcn@latest add` 로 생성. 직접 작성 금지

---

### Task 1: 데이터 모델 — Schema + Types + DB Repository

**Files:**
- Modify: `src/infra/db/schema.ts:188` (createTables 함수 끝에 테이블 추가)
- Create: `src/core/feed/feed-types.ts`
- Create: `src/core/project/project-types.ts`
- Create: `src/infra/db/feed-repository.ts`
- Create: `src/infra/db/project-repository.ts`
- Create: `src/infra/db/milestone-repository.ts`
- Test: `src/__tests__/infra/db/feed-tables.test.ts`

**Interfaces:**
- Consumes: 기존 `createTables()` 패턴 (`src/infra/db/schema.ts`)
- Produces:
  - 타입: `RssCommit`, `FeedEntry`, `Project`, `ProjectRepository`, `Milestone`
  - DB 함수: `insertRssCommits(db, commits[])`, `getUnprocessedRssCommits(db, repositoryId)`, `insertFeedEntry(db, entry)`, `getFeedEntries(db, userId)`, `insertProject(db, input)`, `getProjectsByUser(db, userId)`, `getProjectWithRepos(db, projectId)`, `deleteProject(db, projectId)`, `updateProject(db, id, input)`, `insertMilestone(db, input)`, `getMilestonesByUser(db, userId)`, `getActiveMilestonesByScope(db, scopeType, scopeId)`, `updateMilestone(db, id, input)`, `deleteMilestone(db, id)`

- [ ] **Step 1: 타입 정의 — feed-types.ts**

```typescript
// src/core/feed/feed-types.ts

/** RSS 피드에서 파싱한 커밋 */
export interface RssCommit {
  repositoryId: number;
  sha: string;
  authorName: string;
  message: string;
  committedAt: string; // ISO 8601
}

/** 뉴스피드 엔트리 (LLM 생성 브리핑) */
export interface FeedEntry {
  id: number;
  userId: string;
  scopeType: "project" | "repository";
  scopeId: number;
  briefing: string;
  milestoneSummary: string | null;
  commitShas: string[]; // JSON parsed
  groupSuggestion: GroupSuggestion | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

/** LLM 프로젝트 그룹핑 제안 */
export interface GroupSuggestion {
  suggestion: string;
  repositories: Array<{ id: number; name: string }>;
}
```

- [ ] **Step 2: 타입 정의 — project-types.ts**

```typescript
// src/core/project/project-types.ts

/** 프로젝트 (저장소 그룹) */
export interface Project {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 프로젝트 + 연결된 저장소 ID 목록 */
export interface ProjectWithRepos extends Project {
  repositoryIds: number[];
}

/** 마일스톤 */
export interface Milestone {
  id: number;
  userId: string;
  projectId: number | null;
  repositoryId: number | null;
  title: string;
  rawInput: string;
  deadline: string | null; // YYYY-MM-DD
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: 테스트 작성 — 신규 테이블 생성 확인**

```typescript
// src/__tests__/infra/db/feed-tables.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";

describe("feed/project/milestone tables", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should create projects table", () => {
    const info = db.prepare("PRAGMA table_info(projects)").all() as any[];
    const names = info.map((c: any) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("name");
    expect(names).toContain("description");
  });

  it("should create project_repositories table with composite PK", () => {
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "P1");
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run("o", "r", "main", "u1", "https://x.com/o/r");
    const projId = (db.prepare("SELECT id FROM projects").get() as any).id;
    const repoId = (db.prepare("SELECT id FROM repositories").get() as any).id;
    db.prepare("INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)").run(projId, repoId);
    // 중복 삽입 실패
    expect(() => {
      db.prepare("INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)").run(projId, repoId);
    }).toThrow();
  });

  it("should create milestones table with CHECK constraint", () => {
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "P1");
    const projId = (db.prepare("SELECT id FROM projects").get() as any).id;
    // project_id 있으면 OK
    db.prepare(
      "INSERT INTO milestones (user_id, project_id, title, raw_input, status) VALUES (?, ?, ?, ?, ?)"
    ).run("u1", projId, "Test", "raw", "active");
    // 둘 다 null이면 실패
    expect(() => {
      db.prepare(
        "INSERT INTO milestones (user_id, title, raw_input, status) VALUES (?, ?, ?, ?)"
      ).run("u1", "Test", "raw", "active");
    }).toThrow();
  });

  it("should create rss_commits table with unique(repository_id, sha)", () => {
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run("o", "r", "main", "u1", "https://x.com/o/r");
    const repoId = (db.prepare("SELECT id FROM repositories").get() as any).id;
    db.prepare(
      "INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at) VALUES (?, ?, ?, ?, ?)"
    ).run(repoId, "abc123", "author", "msg", "2026-06-23T10:00:00Z");
    expect(() => {
      db.prepare(
        "INSERT INTO rss_commits (repository_id, sha, author_name, message, committed_at) VALUES (?, ?, ?, ?, ?)"
      ).run(repoId, "abc123", "author", "msg", "2026-06-23T10:00:00Z");
    }).toThrow();
  });

  it("should create feed_entries table", () => {
    const info = db.prepare("PRAGMA table_info(feed_entries)").all() as any[];
    const names = info.map((c: any) => c.name);
    expect(names).toContain("scope_type");
    expect(names).toContain("briefing");
    expect(names).toContain("milestone_summary");
    expect(names).toContain("group_suggestion");
  });
});
```

- [ ] **Step 4: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/__tests__/infra/db/feed-tables.test.ts`
Expected: FAIL — 테이블이 아직 없음

- [ ] **Step 5: schema.ts에 테이블 추가**

`src/infra/db/schema.ts`의 `createTables` 함수에서 기존 `CREATE INDEX` 구문들 뒤(188행 `);` 직전)에 다음을 추가:

```sql
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_repositories (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, repository_id)
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (project_id IS NOT NULL OR repository_id IS NOT NULL)
    );

    CREATE TABLE IF NOT EXISTS rss_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      sha TEXT NOT NULL,
      author_name TEXT NOT NULL,
      message TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      feed_entry_id INTEGER REFERENCES feed_entries(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repository_id, sha)
    );

    CREATE TABLE IF NOT EXISTS feed_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'repository')),
      scope_id INTEGER NOT NULL,
      briefing TEXT NOT NULL,
      milestone_summary TEXT,
      commit_shas TEXT NOT NULL DEFAULT '[]',
      group_suggestion TEXT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rss_commits_repo_sha
      ON rss_commits(repository_id, sha);

    CREATE INDEX IF NOT EXISTS idx_rss_commits_feed_entry
      ON rss_commits(feed_entry_id);

    CREATE INDEX IF NOT EXISTS idx_feed_entries_user_created
      ON feed_entries(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_milestones_user_status
      ON milestones(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_projects_user
      ON projects(user_id);
```

주의: `rss_commits`가 `feed_entries`를 참조하므로, `feed_entries` CREATE가 `rss_commits`보다 먼저 와야 한다. 위 순서에서 `feed_entries` → `rss_commits` 순으로 배치할 것.

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/feed-tables.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: DB Repository — feed-repository.ts 구현**

```typescript
// src/infra/db/feed-repository.ts
import type Database from "better-sqlite3";
import type { RssCommit, FeedEntry } from "@/core/feed/feed-types";

export function insertRssCommits(db: Database.Database, commits: RssCommit[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO rss_commits (repository_id, sha, author_name, message, committed_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const c of commits) {
      const result = stmt.run(c.repositoryId, c.sha, c.authorName, c.message, c.committedAt);
      if (result.changes > 0) inserted++;
    }
  });
  tx();
  return inserted;
}

export function getUnprocessedRssCommits(db: Database.Database, repositoryId: number): RssCommit[] {
  const rows = db.prepare(
    `SELECT repository_id, sha, author_name, message, committed_at
     FROM rss_commits WHERE repository_id = ? AND feed_entry_id IS NULL
     ORDER BY committed_at ASC`
  ).all(repositoryId) as any[];
  return rows.map((r) => ({
    repositoryId: r.repository_id,
    sha: r.sha,
    authorName: r.author_name,
    message: r.message,
    committedAt: r.committed_at,
  }));
}

export function markRssCommitsProcessed(db: Database.Database, shas: string[], repositoryId: number, feedEntryId: number): void {
  const placeholders = shas.map(() => "?").join(",");
  db.prepare(
    `UPDATE rss_commits SET feed_entry_id = ? WHERE repository_id = ? AND sha IN (${placeholders})`
  ).run(feedEntryId, repositoryId, ...shas);
}

interface InsertFeedEntryInput {
  userId: string;
  scopeType: "project" | "repository";
  scopeId: number;
  briefing: string;
  milestoneSummary: string | null;
  commitShas: string[];
  groupSuggestion: string | null; // JSON string
  periodStart: string;
  periodEnd: string;
}

export function insertFeedEntry(db: Database.Database, input: InsertFeedEntryInput): number {
  const result = db.prepare(
    `INSERT INTO feed_entries (user_id, scope_type, scope_id, briefing, milestone_summary, commit_shas, group_suggestion, period_start, period_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId, input.scopeType, input.scopeId, input.briefing,
    input.milestoneSummary, JSON.stringify(input.commitShas),
    input.groupSuggestion, input.periodStart, input.periodEnd
  );
  return result.lastInsertRowid as number;
}

export function getFeedEntries(db: Database.Database, userId: string, limit = 20): FeedEntry[] {
  const rows = db.prepare(
    `SELECT * FROM feed_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(userId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    briefing: r.briefing,
    milestoneSummary: r.milestone_summary,
    commitShas: JSON.parse(r.commit_shas || "[]"),
    groupSuggestion: r.group_suggestion ? JSON.parse(r.group_suggestion) : null,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    createdAt: r.created_at,
  }));
}
```

- [ ] **Step 8: DB Repository — project-repository.ts 구현**

```typescript
// src/infra/db/project-repository.ts
import type Database from "better-sqlite3";
import type { Project, ProjectWithRepos } from "@/core/project/project-types";

interface InsertProjectInput {
  userId: string;
  name: string;
  description: string | null;
  repositoryIds: number[];
}

export function insertProject(db: Database.Database, input: InsertProjectInput): number {
  const tx = db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO projects (user_id, name, description) VALUES (?, ?, ?)"
    ).run(input.userId, input.name, input.description);
    const projectId = result.lastInsertRowid as number;
    const linkStmt = db.prepare(
      "INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)"
    );
    for (const repoId of input.repositoryIds) {
      linkStmt.run(projectId, repoId);
    }
    return projectId;
  });
  return tx();
}

export function getProjectsByUser(db: Database.Database, userId: string): Project[] {
  return db.prepare(
    "SELECT id, user_id, name, description, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[];
}

export function getProjectWithRepos(db: Database.Database, projectId: number): ProjectWithRepos | null {
  const project = db.prepare(
    "SELECT id, user_id, name, description, created_at, updated_at FROM projects WHERE id = ?"
  ).get(projectId) as any | undefined;
  if (!project) return null;
  const repos = db.prepare(
    "SELECT repository_id FROM project_repositories WHERE project_id = ?"
  ).all(projectId) as any[];
  return { ...project, repositoryIds: repos.map((r: any) => r.repository_id) };
}

interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  repositoryIds?: number[];
}

export function updateProject(db: Database.Database, id: number, input: UpdateProjectInput): void {
  const tx = db.transaction(() => {
    if (input.name !== undefined || input.description !== undefined) {
      const sets: string[] = ["updated_at = datetime('now')"];
      const params: any[] = [];
      if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
      if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
      params.push(id);
      db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
    if (input.repositoryIds !== undefined) {
      db.prepare("DELETE FROM project_repositories WHERE project_id = ?").run(id);
      const stmt = db.prepare("INSERT INTO project_repositories (project_id, repository_id) VALUES (?, ?)");
      for (const repoId of input.repositoryIds) {
        stmt.run(id, repoId);
      }
    }
  });
  tx();
}

export function deleteProject(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getRepositoryProjectId(db: Database.Database, repositoryId: number): number | null {
  const row = db.prepare(
    "SELECT project_id FROM project_repositories WHERE repository_id = ? LIMIT 1"
  ).get(repositoryId) as any | undefined;
  return row?.project_id ?? null;
}
```

- [ ] **Step 9: DB Repository — milestone-repository.ts 구현**

```typescript
// src/infra/db/milestone-repository.ts
import type Database from "better-sqlite3";
import type { Milestone } from "@/core/project/project-types";

interface InsertMilestoneInput {
  userId: string;
  projectId: number | null;
  repositoryId: number | null;
  title: string;
  rawInput: string;
  deadline: string | null;
}

export function insertMilestone(db: Database.Database, input: InsertMilestoneInput): number {
  const result = db.prepare(
    `INSERT INTO milestones (user_id, project_id, repository_id, title, raw_input, deadline, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(input.userId, input.projectId, input.repositoryId, input.title, input.rawInput, input.deadline);
  return result.lastInsertRowid as number;
}

export function getMilestonesByUser(db: Database.Database, userId: string): Milestone[] {
  const rows = db.prepare(
    "SELECT * FROM milestones WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[];
  return rows.map(mapMilestone);
}

export function getActiveMilestonesByScope(
  db: Database.Database,
  scopeType: "project" | "repository",
  scopeId: number
): Milestone[] {
  const col = scopeType === "project" ? "project_id" : "repository_id";
  const rows = db.prepare(
    `SELECT * FROM milestones WHERE ${col} = ? AND status = 'active' ORDER BY deadline ASC NULLS LAST`
  ).all(scopeId) as any[];
  return rows.map(mapMilestone);
}

interface UpdateMilestoneInput {
  title?: string;
  deadline?: string | null;
  status?: "active" | "completed" | "cancelled";
}

export function updateMilestone(db: Database.Database, id: number, input: UpdateMilestoneInput): void {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.deadline !== undefined) { sets.push("deadline = ?"); params.push(input.deadline); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  params.push(id);
  db.prepare(`UPDATE milestones SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteMilestone(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
}

function mapMilestone(row: any): Milestone {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    title: row.title,
    rawInput: row.raw_input,
    deadline: row.deadline,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 10: 테스트 실행 — 전체 통과 확인**

Run: `npx vitest run src/__tests__/infra/db/feed-tables.test.ts`
Expected: PASS

- [ ] **Step 11: 커밋**

```bash
git add src/core/feed/feed-types.ts src/core/project/project-types.ts src/infra/db/schema.ts src/infra/db/feed-repository.ts src/infra/db/project-repository.ts src/infra/db/milestone-repository.ts src/__tests__/infra/db/feed-tables.test.ts
git commit -m "feat: 뉴스피드·프로젝트·마일스톤 데이터 모델 및 DB Repository 추가"
```

---

### Task 2: RSS 파서 + 클라이언트

**Files:**
- Create: `src/core/feed/rss-parser.ts`
- Create: `src/infra/rss/rss-client.ts`
- Test: `src/__tests__/core/rss-parser.test.ts`
- Test: `src/__tests__/infra/rss/rss-client.test.ts`

**Interfaces:**
- Consumes: `RssCommit` (from Task 1), `GitProviderMeta` (from `core/types.ts`), credential DB 함수
- Produces:
  - `parseAtomFeed(xml: string, repositoryId: number): RssCommit[]`
  - `parseRssFeed(xml: string, repositoryId: number): RssCommit[]`
  - `buildRssUrl(meta: GitProviderMeta, owner: string, repo: string, branch: string): string`
  - `fetchRssCommits(repositoryId: number, meta: GitProviderMeta, owner: string, repo: string, branch: string): Promise<RssCommit[]>`

- [ ] **Step 1: 테스트 작성 — Atom 피드 파싱**

```typescript
// src/__tests__/core/rss-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseAtomFeed, parseRssFeed } from "@/core/feed/rss-parser";

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Recent Commits to my-repo:main</title>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/abc1234567890</id>
    <title>feat: 로그인 페이지 구현</title>
    <updated>2026-06-23T10:30:00Z</updated>
    <author><name>jaeseok</name></author>
    <link rel="alternate" type="text/html" href="https://github.com/owner/repo/commit/abc1234567890"/>
  </entry>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/def4567890123</id>
    <title>fix: 세션 만료 버그 수정</title>
    <updated>2026-06-23T09:00:00Z</updated>
    <author><name>minsu</name></author>
    <link rel="alternate" type="text/html" href="https://github.com/owner/repo/commit/def4567890123"/>
  </entry>
</feed>`;

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>my-repo commits</title>
    <item>
      <title>refactor: 코드 정리</title>
      <link>https://gitea.example.com/owner/repo/commit/aaa1111</link>
      <pubDate>Mon, 23 Jun 2026 08:00:00 GMT</pubDate>
      <author>jiyoung</author>
    </item>
  </channel>
</rss>`;

describe("parseAtomFeed", () => {
  it("should parse GitHub Atom feed entries", () => {
    const commits = parseAtomFeed(sampleAtom, 1);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("abc1234567890");
    expect(commits[0].authorName).toBe("jaeseok");
    expect(commits[0].message).toBe("feat: 로그인 페이지 구현");
    expect(commits[0].repositoryId).toBe(1);
    expect(commits[1].sha).toBe("def4567890123");
    expect(commits[1].authorName).toBe("minsu");
  });

  it("should return empty array for empty feed", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    expect(parseAtomFeed(xml, 1)).toEqual([]);
  });
});

describe("parseRssFeed", () => {
  it("should parse Gitea RSS feed items", () => {
    const commits = parseRssFeed(sampleRss, 2);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("aaa1111");
    expect(commits[0].authorName).toBe("jiyoung");
    expect(commits[0].message).toBe("refactor: 코드 정리");
    expect(commits[0].repositoryId).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/__tests__/core/rss-parser.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: RSS 파서 구현**

```typescript
// src/core/feed/rss-parser.ts
import type { RssCommit } from "@/core/feed/feed-types";

/**
 * GitHub/GitLab Atom 피드를 파싱하여 RssCommit 배열로 변환한다.
 * 외부 XML 라이브러리 없이 정규식 기반으로 처리한다.
 * Atom entry의 id에서 SHA를 추출한다.
 */
export function parseAtomFeed(xml: string, repositoryId: number): RssCommit[] {
  const commits: RssCommit[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const id = extractTag(block, "id");
    const title = extractTag(block, "title");
    const updated = extractTag(block, "updated");
    const author = extractTag(block, "name"); // <author><name>...</name></author>

    // SHA 추출: Atom id 형식 "tag:github.com,...:Grit::Commit/SHA" 또는 URL 끝
    const sha = extractShaFromAtomId(id) ?? extractShaFromLink(block);
    if (!sha || !title) continue;

    commits.push({
      repositoryId,
      sha,
      authorName: author || "unknown",
      message: decodeXmlEntities(title),
      committedAt: updated || new Date().toISOString(),
    });
  }

  return commits;
}

/**
 * Gitea RSS 피드를 파싱하여 RssCommit 배열로 변환한다.
 * item의 link에서 SHA를 추출한다.
 */
export function parseRssFeed(xml: string, repositoryId: number): RssCommit[] {
  const commits: RssCommit[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const author = extractTag(block, "author") || extractTag(block, "dc:creator");

    const sha = link ? extractShaFromUrl(link) : null;
    if (!sha || !title) continue;

    commits.push({
      repositoryId,
      sha,
      authorName: author || "unknown",
      message: decodeXmlEntities(title),
      committedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    });
  }

  return commits;
}

function extractTag(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`);
  const match = regex.exec(xml);
  return match?.[1]?.trim() || null;
}

function extractShaFromAtomId(id: string | null): string | null {
  if (!id) return null;
  // GitHub: "tag:github.com,2008:Grit::Commit/abc123..."
  const commitMatch = /Commit\/([a-f0-9]+)$/i.exec(id);
  if (commitMatch) return commitMatch[1];
  // GitLab: 일반적으로 URL 또는 해시
  const hashMatch = /([a-f0-9]{7,40})$/i.exec(id);
  return hashMatch?.[1] || null;
}

function extractShaFromLink(block: string): string | null {
  const linkMatch = /href="([^"]*commit[^"]*)"/.exec(block);
  return linkMatch ? extractShaFromUrl(linkMatch[1]) : null;
}

function extractShaFromUrl(url: string): string | null {
  const match = /\/commit\/([a-f0-9]+)/i.exec(url);
  return match?.[1] || null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/__tests__/core/rss-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 테스트 작성 — RSS URL 생성**

```typescript
// src/__tests__/infra/rss/rss-client.test.ts
import { describe, it, expect } from "vitest";
import { buildRssUrl } from "@/infra/rss/rss-client";
import type { GitProviderMeta } from "@/core/types";

describe("buildRssUrl", () => {
  it("should build GitHub Atom URL", () => {
    const meta: GitProviderMeta = { type: "github", host: "github.com", apiBase: "https://api.github.com" };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://github.com/owner/repo/commits/main.atom"
    );
  });

  it("should build GitLab Atom URL", () => {
    const meta: GitProviderMeta = { type: "gitlab", host: "gitlab.com", apiBase: "https://gitlab.com/api/v4" };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://gitlab.com/owner/repo/-/commits/main?format=atom"
    );
  });

  it("should build Gitea RSS URL", () => {
    const meta: GitProviderMeta = { type: "gitea", host: "gitea.internal.com", apiBase: "https://gitea.internal.com/api/v1" };
    expect(buildRssUrl(meta, "owner", "repo", "main")).toBe(
      "https://gitea.internal.com/owner/repo.rss"
    );
  });
});
```

- [ ] **Step 6: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/__tests__/infra/rss/rss-client.test.ts`
Expected: FAIL

- [ ] **Step 7: RSS 클라이언트 구현**

```typescript
// src/infra/rss/rss-client.ts
import type { GitProviderMeta } from "@/core/types";
import type { RssCommit } from "@/core/feed/feed-types";
import { parseAtomFeed, parseRssFeed } from "@/core/feed/rss-parser";

export function buildRssUrl(
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): string {
  const host = meta.host.replace(/\/$/, "");
  const protocol = host.includes("localhost") ? "http" : "https";

  switch (meta.type) {
    case "github":
      return `${protocol}://${host}/${owner}/${repo}/commits/${branch}.atom`;
    case "gitlab":
      return `${protocol}://${host}/${owner}/${repo}/-/commits/${branch}?format=atom`;
    case "gitea":
      return `${protocol}://${host}/${owner}/${repo}.rss`;
    case "bitbucket":
      return `${protocol}://${host}/${owner}/${repo}/rss`;
    default:
      return `${protocol}://${host}/${owner}/${repo}/commits/${branch}.atom`;
  }
}

export async function fetchRssCommits(
  repositoryId: number,
  meta: GitProviderMeta,
  owner: string,
  repo: string,
  branch: string
): Promise<RssCommit[]> {
  const url = buildRssUrl(meta, owner, repo, branch);

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/atom+xml, application/rss+xml, application/xml" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[RSS] ${url} returned ${response.status}`);
      return [];
    }

    const xml = await response.text();

    // Atom 피드인지 RSS 피드인지 판별
    if (xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"")) {
      return parseAtomFeed(xml, repositoryId);
    }
    if (xml.includes("<rss") || xml.includes("<channel>")) {
      return parseRssFeed(xml, repositoryId);
    }

    // 알 수 없는 형식이면 Atom으로 시도
    return parseAtomFeed(xml, repositoryId);
  } catch (error) {
    console.warn(`[RSS] fetch failed for ${url}:`, error);
    return [];
  }
}
```

- [ ] **Step 8: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/__tests__/infra/rss/rss-client.test.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add src/core/feed/rss-parser.ts src/infra/rss/rss-client.ts src/__tests__/core/rss-parser.test.ts src/__tests__/infra/rss/rss-client.test.ts
git commit -m "feat: RSS/Atom 피드 파서 및 멀티 플랫폼 RSS 클라이언트 구현"
```

---

### Task 3: 브리핑 프롬프트 빌더

**Files:**
- Create: `src/core/feed/briefing-prompt.ts`
- Test: `src/__tests__/core/briefing-prompt.test.ts`

**Interfaces:**
- Consumes: `RssCommit` (Task 1), `Milestone` (Task 1)
- Produces:
  - `buildBriefingPrompt(input: BriefingPromptInput): string`
  - `buildMilestoneParsePrompt(rawInput: string, currentDate: string, projects: Array<{id,name}>, repositories: Array<{id,name}>): string`
  - `buildGroupSuggestionPrompt(repositories: Array<{id,name,language,recentMessages}>): string`
  - `parseMilestoneParseResponse(text: string): MilestoneParseResult`
  - `parseGroupSuggestionResponse(text: string): GroupSuggestion | null`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/__tests__/core/briefing-prompt.test.ts
import { describe, it, expect } from "vitest";
import {
  buildBriefingPrompt,
  buildMilestoneParsePrompt,
  parseMilestoneParseResponse,
  buildGroupSuggestionPrompt,
  parseGroupSuggestionResponse,
} from "@/core/feed/briefing-prompt";
import type { RssCommit } from "@/core/feed/feed-types";
import type { Milestone } from "@/core/project/project-types";

describe("buildBriefingPrompt", () => {
  it("should include commits grouped by author", () => {
    const commits: RssCommit[] = [
      { repositoryId: 1, sha: "a1", authorName: "jaeseok", message: "feat: 로그인", committedAt: "2026-06-23T10:00:00Z" },
      { repositoryId: 1, sha: "a2", authorName: "minsu", message: "fix: 버그", committedAt: "2026-06-23T11:00:00Z" },
    ];
    const prompt = buildBriefingPrompt({ scopeName: "MyProject", commits, milestones: [] });
    expect(prompt).toContain("jaeseok");
    expect(prompt).toContain("minsu");
    expect(prompt).toContain("feat: 로그인");
    expect(prompt).toContain("MyProject");
  });

  it("should include milestone context when milestones exist", () => {
    const milestone: Milestone = {
      id: 1, userId: "u1", projectId: 1, repositoryId: null,
      title: "MVP 출시", rawInput: "다음달까지 MVP",
      deadline: "2026-07-05", status: "active",
      createdAt: "", updatedAt: "",
    };
    const prompt = buildBriefingPrompt({
      scopeName: "MyProject",
      commits: [{ repositoryId: 1, sha: "a1", authorName: "x", message: "m", committedAt: "2026-06-23T10:00:00Z" }],
      milestones: [milestone],
    });
    expect(prompt).toContain("MVP 출시");
    expect(prompt).toContain("2026-07-05");
  });
});

describe("buildMilestoneParsePrompt", () => {
  it("should include raw input and current date", () => {
    const prompt = buildMilestoneParsePrompt(
      "다음 주 금요일까지 로그인 완성",
      "2026-06-23",
      [{ id: 1, name: "MyProject" }],
      [{ id: 10, name: "frontend-app" }]
    );
    expect(prompt).toContain("다음 주 금요일까지 로그인 완성");
    expect(prompt).toContain("2026-06-23");
    expect(prompt).toContain("MyProject");
    expect(prompt).toContain("frontend-app");
  });
});

describe("parseMilestoneParseResponse", () => {
  it("should parse valid JSON response", () => {
    const response = JSON.stringify({
      title: "로그인 페이지 완성",
      deadline: "2026-06-27",
      suggested_scope: { type: "repository", id: 10, name: "frontend-app", confidence: "high" },
    });
    const result = parseMilestoneParseResponse(response);
    expect(result.title).toBe("로그인 페이지 완성");
    expect(result.deadline).toBe("2026-06-27");
    expect(result.suggestedScope?.type).toBe("repository");
  });

  it("should handle code-fenced JSON", () => {
    const response = "```json\n" + JSON.stringify({ title: "Test", deadline: null, suggested_scope: null }) + "\n```";
    const result = parseMilestoneParseResponse(response);
    expect(result.title).toBe("Test");
  });
});

describe("buildGroupSuggestionPrompt", () => {
  it("should include repository info", () => {
    const prompt = buildGroupSuggestionPrompt([
      { id: 1, name: "frontend-app", language: "TypeScript", recentMessages: ["feat: UI"] },
      { id: 2, name: "frontend-design", language: "TypeScript", recentMessages: ["fix: 색상"] },
    ]);
    expect(prompt).toContain("frontend-app");
    expect(prompt).toContain("frontend-design");
  });
});

describe("parseGroupSuggestionResponse", () => {
  it("should return null for 'null' response", () => {
    expect(parseGroupSuggestionResponse("null")).toBeNull();
  });

  it("should parse valid suggestion", () => {
    const response = JSON.stringify({
      suggestion: "프론트엔드 관련 저장소",
      repositories: [{ id: 1, name: "frontend-app" }, { id: 2, name: "frontend-design" }],
    });
    const result = parseGroupSuggestionResponse(response);
    expect(result?.suggestion).toBe("프론트엔드 관련 저장소");
    expect(result?.repositories).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/__tests__/core/briefing-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: 프롬프트 빌더 구현**

```typescript
// src/core/feed/briefing-prompt.ts
import type { RssCommit } from "@/core/feed/feed-types";
import type { GroupSuggestion } from "@/core/feed/feed-types";
import type { Milestone } from "@/core/project/project-types";

export interface BriefingPromptInput {
  scopeName: string;
  commits: RssCommit[];
  milestones: Milestone[];
}

export function buildBriefingPrompt(input: BriefingPromptInput): string {
  const { scopeName, commits, milestones } = input;

  // 작업자별 그룹핑
  const byAuthor = new Map<string, RssCommit[]>();
  for (const c of commits) {
    const list = byAuthor.get(c.authorName) ?? [];
    list.push(c);
    byAuthor.set(c.authorName, list);
  }

  const authorSections = Array.from(byAuthor.entries())
    .map(([author, authorCommits]) => {
      const lines = authorCommits
        .map((c) => `  - ${c.message} (${c.committedAt})`)
        .join("\n");
      return `### ${author}\n${lines}`;
    })
    .join("\n\n");

  const milestoneSection = milestones.length > 0
    ? `\n[활성 마일스톤]\n${milestones.map((m) => {
        const deadline = m.deadline ? ` (마감: ${m.deadline})` : "";
        return `- ${m.title}${deadline}`;
      }).join("\n")}\n`
    : "";

  return `당신은 개발팀의 업무 현황을 브리핑하는 어시스턴트입니다.
친절하고 명확한 비즈니스 톤으로, 구어체로 설명하세요.
작업자별로 분류하여 누가 무엇을 하고 있는지 정리하세요.

[프로젝트/저장소]
${scopeName}
${milestoneSection}
[커밋 목록 — 작업자별]
${authorSections}

[출력 지시]
${milestones.length > 0
    ? `1. 마일스톤 상태 분석을 먼저 작성하세요. 각 마일스톤에 대해 커밋 활동을 분석하여 상태(미착수/개발 중/수정·보완/활동 없음/지연 위험)를 판단하세요. 마감일이 있으면 남은 일수를 언급하세요.
2. 이후 작업자별 활동 요약을 작성하세요.`
    : `작업자별 활동 요약을 작성하세요.`}
- 텍스트만 응답 (JSON/코드블록 불필요)
- 한국어로 작성`;
}

export function buildMilestoneParsePrompt(
  rawInput: string,
  currentDate: string,
  projects: Array<{ id: number; name: string }>,
  repositories: Array<{ id: number; name: string }>,
): string {
  const projectList = projects.length > 0
    ? projects.map((p) => `  - id: ${p.id}, name: "${p.name}"`).join("\n")
    : "  (없음)";
  const repoList = repositories.length > 0
    ? repositories.map((r) => `  - id: ${r.id}, name: "${r.name}"`).join("\n")
    : "  (없음)";

  return `사용자의 자연어 목표를 구조화하세요.

[입력]
- 사용자 원문: "${rawInput}"
- 현재 날짜: ${currentDate}
- 등록된 프로젝트 목록:
${projectList}
- 등록된 저장소 목록:
${repoList}

[출력 JSON]
{
  "title": "명확하고 간결한 마일스톤 제목",
  "deadline": "YYYY-MM-DD 또는 null",
  "suggested_scope": {
    "type": "project 또는 repository",
    "id": 숫자,
    "name": "이름",
    "confidence": "high 또는 medium 또는 low"
  }
}

규칙:
- "다음 주 금요일"처럼 상대 날짜는 현재 날짜 기준으로 절대 날짜(YYYY-MM-DD)로 변환
- 입력에 날짜 언급이 없으면 deadline은 null
- 프로젝트/저장소 목록에서 관련성 높은 것을 추천. 확신 없으면 confidence를 "low"로
- 관련 프로젝트/저장소가 전혀 없으면 suggested_scope를 null
- JSON만 응답`;
}

export interface MilestoneParseResult {
  title: string;
  deadline: string | null;
  suggestedScope: {
    type: "project" | "repository";
    id: number;
    name: string;
    confidence: "high" | "medium" | "low";
  } | null;
}

export function parseMilestoneParseResponse(text: string): MilestoneParseResult {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(cleaned);
  return {
    title: parsed.title,
    deadline: parsed.deadline || null,
    suggestedScope: parsed.suggested_scope
      ? {
          type: parsed.suggested_scope.type,
          id: parsed.suggested_scope.id,
          name: parsed.suggested_scope.name,
          confidence: parsed.suggested_scope.confidence,
        }
      : null,
  };
}

export function buildGroupSuggestionPrompt(
  repositories: Array<{ id: number; name: string; language: string | null; recentMessages: string[] }>,
): string {
  const repoLines = repositories
    .map((r) => {
      const msgs = r.recentMessages.slice(0, 5).map((m) => `    - ${m}`).join("\n");
      return `- id: ${r.id}, name: "${r.name}", language: ${r.language || "unknown"}\n  최근 커밋:\n${msgs}`;
    })
    .join("\n");

  return `아래 저장소들이 같은 프로젝트에 속할 가능성이 있는지 판단하세요.

[저장소 목록]
${repoLines}

관련성이 보이면 다음 JSON 형태로 응답:
{
  "suggestion": "프로젝트로 묶는 이유 설명",
  "repositories": [{"id": 숫자, "name": "이름"}, ...]
}

관련성이 없으면 null 만 응답하세요.
JSON 또는 null 만 응답.`;
}

export function parseGroupSuggestionResponse(text: string): GroupSuggestion | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  if (cleaned === "null" || cleaned === "") return null;
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed?.suggestion || !parsed?.repositories) return null;
    return {
      suggestion: parsed.suggestion,
      repositories: parsed.repositories,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/__tests__/core/briefing-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/feed/briefing-prompt.ts src/__tests__/core/briefing-prompt.test.ts
git commit -m "feat: 뉴스피드 브리핑·마일스톤 파싱·그룹 제안 프롬프트 빌더 구현"
```

---

### Task 4: 피드 스케줄러

**Files:**
- Create: `src/scheduler/feed-scheduler.ts`
- Modify: `instrumentation.ts:7` (feed-scheduler import + 호출 추가)

**Interfaces:**
- Consumes:
  - `fetchRssCommits(repositoryId, meta, owner, repo, branch)` (Task 2)
  - `insertRssCommits(db, commits)`, `getUnprocessedRssCommits(db, repoId)`, `insertFeedEntry(db, input)`, `markRssCommitsProcessed(db, shas, repoId, entryId)` (Task 1)
  - `getActiveMilestonesByScope(db, scopeType, scopeId)` (Task 1)
  - `getRepositoryProjectId(db, repositoryId)` (Task 1)
  - `buildBriefingPrompt(input)` (Task 3)
  - `generateText(prompt)` (기존 `infra/llm/llm-client.ts`)
  - `getActiveUsersWithRepos()` (기존 `infra/db/repository.ts`)
  - `getCredentialById(db, id)` (기존 `infra/db/credential.ts`)
  - `getDb()` (기존 `infra/db/connection.ts`)
- Produces:
  - `startFeedScheduler(): void` — 3시간 주기 cron 등록
  - `runFeedCycle(): Promise<void>` — RSS 수집 + 브리핑 생성 전체 사이클
  - `refreshFeedForUser(userId: string): Promise<{ newEntries: number }>` — 특정 사용자의 피드 즉시 갱신

- [ ] **Step 1: 피드 스케줄러 구현**

```typescript
// src/scheduler/feed-scheduler.ts
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/infra/db/connection";
import { getActiveUsersWithRepos, getRepositoriesByUser } from "@/infra/db/repository";
import { getCredentialById } from "@/infra/db/credential";
import { fetchRssCommits } from "@/infra/rss/rss-client";
import { insertRssCommits, getUnprocessedRssCommits, insertFeedEntry, markRssCommitsProcessed } from "@/infra/db/feed-repository";
import { getRepositoryProjectId } from "@/infra/db/project-repository";
import { getActiveMilestonesByScope } from "@/infra/db/milestone-repository";
import { buildBriefingPrompt } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";
import { decrypt } from "@/infra/crypto/token-encryption";
import type { GitProviderMeta } from "@/core/types";
import type { RssCommit } from "@/core/feed/feed-types";

let cronTask: ScheduledTask | null = null;

export function startFeedScheduler(): void {
  if (cronTask) return;
  console.log("[FeedScheduler] 3시간 주기 RSS 수집 시작");
  cronTask = cron.schedule("0 */3 * * *", () => {
    runFeedCycle().catch((err) => console.error("[FeedScheduler] cycle error:", err));
  });
}

export async function runFeedCycle(): Promise<void> {
  const db = getDb();
  const users = getActiveUsersWithRepos(db);

  for (const user of users) {
    try {
      await refreshFeedForUser(user.userId);
    } catch (err) {
      console.error(`[FeedScheduler] user ${user.userId} error:`, err);
    }
  }
}

export async function refreshFeedForUser(userId: string): Promise<{ newEntries: number }> {
  const db = getDb();
  const repos = getRepositoriesByUser(db, userId).filter((r: any) => r.is_active);
  let newEntries = 0;

  // 1. RSS 수집: 전 저장소 RSS fetch → rss_commits에 저장
  for (const repo of repos) {
    try {
      const meta = resolveProviderMeta(repo);
      if (!meta) continue;
      const rssCommits = await fetchRssCommits(repo.id, meta, repo.owner, repo.repo, repo.branch);
      if (rssCommits.length > 0) {
        insertRssCommits(db, rssCommits);
      }
    } catch (err) {
      console.warn(`[FeedScheduler] RSS fetch failed for repo ${repo.id}:`, err);
    }
  }

  // 2. 브리핑 생성: 프로젝트/저장소별로 미처리 커밋을 모아서 LLM 요약
  // 프로젝트에 속한 저장소는 프로젝트 단위로 묶고, 나머지는 저장소 단위
  const projectRepoMap = new Map<number, number[]>(); // projectId → repoIds
  const standaloneRepoIds: number[] = [];

  for (const repo of repos) {
    const projectId = getRepositoryProjectId(db, repo.id);
    if (projectId) {
      const list = projectRepoMap.get(projectId) ?? [];
      list.push(repo.id);
      projectRepoMap.set(projectId, list);
    } else {
      standaloneRepoIds.push(repo.id);
    }
  }

  // 프로젝트 단위 브리핑
  for (const [projectId, repoIds] of projectRepoMap) {
    const allCommits: RssCommit[] = [];
    for (const repoId of repoIds) {
      allCommits.push(...getUnprocessedRssCommits(db, repoId));
    }
    if (allCommits.length === 0) continue;

    const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as any;
    const milestones = getActiveMilestonesByScope(db, "project", projectId);
    const prompt = buildBriefingPrompt({ scopeName: project?.name ?? "Unknown", commits: allCommits, milestones });
    const briefing = await generateText(prompt);

    const milestoneSummary = milestones.length > 0 ? extractMilestoneSummary(briefing) : null;
    const shas = allCommits.map((c) => c.sha);
    const dates = allCommits.map((c) => c.committedAt).sort();

    const entryId = insertFeedEntry(db, {
      userId,
      scopeType: "project",
      scopeId: projectId,
      briefing,
      milestoneSummary,
      commitShas: shas,
      groupSuggestion: null,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
    });

    for (const repoId of repoIds) {
      const repoShas = allCommits.filter((c) => c.repositoryId === repoId).map((c) => c.sha);
      if (repoShas.length > 0) markRssCommitsProcessed(db, repoShas, repoId, entryId);
    }
    newEntries++;
  }

  // 저장소 단위 브리핑
  for (const repoId of standaloneRepoIds) {
    const commits = getUnprocessedRssCommits(db, repoId);
    if (commits.length === 0) continue;

    const repo = repos.find((r: any) => r.id === repoId);
    const scopeName = repo ? `${repo.owner}/${repo.repo}` : "Unknown";
    const milestones = getActiveMilestonesByScope(db, "repository", repoId);
    const prompt = buildBriefingPrompt({ scopeName, commits, milestones });
    const briefing = await generateText(prompt);

    const milestoneSummary = milestones.length > 0 ? extractMilestoneSummary(briefing) : null;
    const shas = commits.map((c) => c.sha);
    const dates = commits.map((c) => c.committedAt).sort();

    const entryId = insertFeedEntry(db, {
      userId,
      scopeType: "repository",
      scopeId: repoId,
      briefing,
      milestoneSummary,
      commitShas: shas,
      groupSuggestion: null,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
    });

    markRssCommitsProcessed(db, shas, repoId, entryId);
    newEntries++;
  }

  return { newEntries };
}

function resolveProviderMeta(repo: any): GitProviderMeta | null {
  if (!repo.credential_id) return null;
  const db = getDb();
  const cred = getCredentialById(db, repo.credential_id);
  if (!cred?.metadata) return null;
  try {
    const meta = typeof cred.metadata === "string" ? JSON.parse(cred.metadata) : cred.metadata;
    return meta as GitProviderMeta;
  } catch {
    return null;
  }
}

function extractMilestoneSummary(briefing: string): string | null {
  // 브리핑 앞부분에서 마일스톤 관련 내용을 추출 (첫 단락)
  const lines = briefing.split("\n");
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (summaryLines.length > 0 && line.trim() === "") break;
    summaryLines.push(line);
  }
  return summaryLines.length > 0 ? summaryLines.join("\n") : null;
}
```

- [ ] **Step 2: instrumentation.ts에 피드 스케줄러 등록**

`instrumentation.ts`에 feed-scheduler import와 호출을 추가:

```typescript
// instrumentation.ts (프로젝트 루트)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/scheduler/polling-manager");
    const { startReportScheduler } = await import("@/scheduler/report-scheduler");
    const { startHrmsScheduler } = await import("@/scheduler/hrms-scheduler");
    const { startFeedScheduler } = await import("@/scheduler/feed-scheduler");
    startScheduler(15);
    startReportScheduler();
    startHrmsScheduler();
    startFeedScheduler();
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/scheduler/feed-scheduler.ts instrumentation.ts
git commit -m "feat: 3시간 주기 RSS 피드 수집 스케줄러 및 브리핑 생성 파이프라인 구현"
```

---

### Task 5: API 라우트

**Files:**
- Create: `src/app/api/feed/route.ts`
- Create: `src/app/api/feed/refresh/route.ts`
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[id]/route.ts`
- Create: `src/app/api/milestones/route.ts`
- Create: `src/app/api/milestones/[id]/route.ts`
- Create: `src/app/api/milestones/parse/route.ts`

**Interfaces:**
- Consumes:
  - `auth()` (기존 `@/lib/auth`)
  - `getDb()` (기존 `@/infra/db/connection`)
  - `refreshFeedForUser(userId)` (Task 4)
  - `getFeedEntries(db, userId)` (Task 1)
  - `insertProject(db, input)`, `getProjectsByUser(db, userId)`, `updateProject(db, id, input)`, `deleteProject(db, id)` (Task 1)
  - `insertMilestone(db, input)`, `getMilestonesByUser(db, userId)`, `updateMilestone(db, id, input)`, `deleteMilestone(db, id)` (Task 1)
  - `buildMilestoneParsePrompt(...)`, `parseMilestoneParseResponse(...)` (Task 3)
  - `generateText(prompt)` (기존 LLM)
- Produces: REST API 엔드포인트들

- [ ] **Step 1: Feed API — GET /api/feed**

```typescript
// src/app/api/feed/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getFeedEntries } from "@/infra/db/feed-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const entries = getFeedEntries(db, String(session.user.id));
  return NextResponse.json(entries);
}
```

- [ ] **Step 2: Feed Refresh API — POST /api/feed/refresh**

```typescript
// src/app/api/feed/refresh/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshFeedForUser } from "@/scheduler/feed-scheduler";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await refreshFeedForUser(String(session.user.id));
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Projects API — GET/POST /api/projects**

```typescript
// src/app/api/projects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { insertProject, getProjectsByUser } from "@/infra/db/project-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const projects = getProjectsByUser(db, String(session.user.id));
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name || !Array.isArray(body.repositoryIds)) {
    return NextResponse.json({ error: "name and repositoryIds required" }, { status: 400 });
  }

  const db = getDb();
  const id = insertProject(db, {
    userId: String(session.user.id),
    name: body.name,
    description: body.description || null,
    repositoryIds: body.repositoryIds,
  });
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 4: Projects API — PUT/DELETE /api/projects/[id]**

```typescript
// src/app/api/projects/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { updateProject, deleteProject, getProjectWithRepos } from "@/infra/db/project-repository";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const project = getProjectWithRepos(db, Number(id));
  if (!project || project.userId !== String(session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  updateProject(db, Number(id), {
    name: body.name,
    description: body.description,
    repositoryIds: body.repositoryIds,
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  deleteProject(db, Number(id));
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Milestones API — GET/POST /api/milestones**

```typescript
// src/app/api/milestones/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { insertMilestone, getMilestonesByUser } from "@/infra/db/milestone-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const milestones = getMilestonesByUser(db, String(session.user.id));
  return NextResponse.json(milestones);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.title || !body.rawInput) {
    return NextResponse.json({ error: "title and rawInput required" }, { status: 400 });
  }
  if (!body.projectId && !body.repositoryId) {
    return NextResponse.json({ error: "projectId or repositoryId required" }, { status: 400 });
  }

  const db = getDb();
  const id = insertMilestone(db, {
    userId: String(session.user.id),
    projectId: body.projectId || null,
    repositoryId: body.repositoryId || null,
    title: body.title,
    rawInput: body.rawInput,
    deadline: body.deadline || null,
  });
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 6: Milestones API — PUT/DELETE /api/milestones/[id]**

```typescript
// src/app/api/milestones/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { updateMilestone, deleteMilestone } from "@/infra/db/milestone-repository";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  updateMilestone(db, Number(id), {
    title: body.title,
    deadline: body.deadline,
    status: body.status,
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  deleteMilestone(db, Number(id));
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: Milestones Parse API — POST /api/milestones/parse**

```typescript
// src/app/api/milestones/parse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getProjectsByUser } from "@/infra/db/project-repository";
import { getRepositoriesByUser } from "@/infra/db/repository";
import { buildMilestoneParsePrompt, parseMilestoneParseResponse } from "@/core/feed/briefing-prompt";
import { generateText } from "@/infra/llm/llm-client";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.rawInput) {
    return NextResponse.json({ error: "rawInput required" }, { status: 400 });
  }

  const userId = String(session.user.id);
  const db = getDb();
  const projects = getProjectsByUser(db, userId).map((p: any) => ({ id: p.id, name: p.name }));
  const repos = getRepositoriesByUser(db, userId).map((r: any) => ({ id: r.id, name: `${r.owner}/${r.repo}` }));

  const today = new Date().toISOString().split("T")[0];
  const prompt = buildMilestoneParsePrompt(body.rawInput, today, projects, repos);

  try {
    const text = await generateText(prompt);
    const result = parseMilestoneParseResponse(text);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 8: 커밋**

```bash
git add src/app/api/feed/ src/app/api/projects/ src/app/api/milestones/
git commit -m "feat: 뉴스피드·프로젝트·마일스톤 API 라우트 구현"
```

---

### Task 6: 대시보드 UI — 레이아웃 + 뉴스피드

**Files:**
- Modify: `src/app/(dashboard)/page.tsx` (대시보드 전면 개편)
- Create: `src/components/feed/newsfeed-panel.tsx`
- Create: `src/components/feed/feed-card.tsx`
- Create: `src/components/feed/status-panel.tsx`

**Interfaces:**
- Consumes:
  - `api("/feed")`, `api("/feed/refresh")`, `api("/milestones")`, `api("/projects")` (Task 5)
  - 기존 `api("/dashboard/stats")`, `api("/commits/heatmap")` 엔드포인트
  - 기존 컴포넌트: `StatCard`, `ContributionHeatmap`, `GrowthTree`
- Produces: 좌우 분할 대시보드 레이아웃. 왼쪽=상태 패널, 오른쪽=뉴스피드 패널

- [ ] **Step 1: 상태 패널 컴포넌트 추출**

기존 `page.tsx`에서 인사말 + 통계 카드 + 히트맵 + 성장 트리를 `status-panel.tsx`로 추출한다. 에러 시 알림 배너 로직을 추가한다.

```typescript
// src/components/feed/status-panel.tsx
"use client";

import { StatCard } from "@/components/data-display/stat-card";
import { ContributionHeatmap } from "@/components/data-display/contribution-heatmap";
import { GrowthTree } from "@/components/growth-tree/growth-tree";
import type { DashboardStats, TreeMetrics } from "@/core/types";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusPanelProps {
  greeting: string;
  stats: DashboardStats | null;
  heatmapData: any[];
  treeMetrics: TreeMetrics | null;
  syncError: string | null;
  onRetrySync: () => void;
  isSyncing: boolean;
}

export function StatusPanel({
  greeting, stats, heatmapData, treeMetrics, syncError, onRetrySync, isSyncing,
}: StatusPanelProps) {
  return (
    <div className="space-y-6">
      {/* 인사말 */}
      <div>
        <h1 className="text-2xl font-bold">{greeting}</h1>
        {syncError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{syncError}</span>
            <Button variant="ghost" size="sm" onClick={onRetrySync} disabled={isSyncing}>
              <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        )}
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="오늘 커밋" value={stats.todayCommits} />
          <StatCard label="주간 커밋" value={stats.weekCommits} />
          <StatCard label="보고서" value={stats.totalReports} />
          <StatCard label="저장소" value={stats.repoCount} />
        </div>
      )}

      {/* 히트맵 */}
      {heatmapData.length > 0 && <ContributionHeatmap data={heatmapData} />}

      {/* 성장 트리 */}
      {treeMetrics && <GrowthTree metrics={treeMetrics} />}
    </div>
  );
}
```

- [ ] **Step 2: 피드 카드 컴포넌트**

```typescript
// src/components/feed/feed-card.tsx
"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";
import type { FeedEntry } from "@/core/feed/feed-types";

interface FeedCardProps {
  entry: FeedEntry;
  scopeName: string;
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number) => void;
}

export function FeedCard({ entry, scopeName, onAddMilestone }: FeedCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="font-semibold text-sm">{scopeName}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onAddMilestone(entry.scopeType, entry.scopeId)}
          title="마일스톤 추가"
        >
          <Target className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {entry.milestoneSummary && (
          <div className="mb-3 rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
            {entry.milestoneSummary}
          </div>
        )}
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {entry.briefing}
        </div>
        <p className="mt-2 text-xs text-muted-foreground/60">
          {formatPeriod(entry.periodStart, entry.periodEnd)}
        </p>
      </CardContent>
    </Card>
  );
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${fmt(s)} ~ ${fmt(e)}`;
}
```

- [ ] **Step 3: 뉴스피드 패널 컴포넌트**

```typescript
// src/components/feed/newsfeed-panel.tsx
"use client";

import { useState } from "react";
import { FeedCard } from "@/components/feed/feed-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Target, Loader2 } from "lucide-react";
import { api } from "@/lib/api-url";
import type { FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";

interface NewsfeedPanelProps {
  entries: FeedEntry[];
  scopeNames: Map<string, string>; // "project:1" → "MyProject"
  isRefreshing: boolean;
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number) => void;
  onAcceptGroupSuggestion: (suggestion: GroupSuggestion) => void;
  onDismissGroupSuggestion: (entryId: number) => void;
}

export function NewsfeedPanel({
  entries, scopeNames, isRefreshing,
  onAddMilestone, onAcceptGroupSuggestion, onDismissGroupSuggestion,
}: NewsfeedPanelProps) {
  const [milestoneInput, setMilestoneInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const getScopeName = (entry: FeedEntry) =>
    scopeNames.get(`${entry.scopeType}:${entry.scopeId}`) ?? "Unknown";

  return (
    <div className="space-y-4">
      {/* 마일스톤 입력 바 */}
      <div
        className="rounded-lg border bg-card p-3 cursor-text"
        onClick={() => setIsExpanded(true)}
      >
        {isExpanded ? (
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="목표를 자유롭게 입력하세요..."
              value={milestoneInput}
              onChange={(e) => setMilestoneInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setIsExpanded(false); setMilestoneInput(""); }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setIsExpanded(false); setMilestoneInput(""); }}>
                취소
              </Button>
              <Button
                size="sm"
                disabled={!milestoneInput.trim()}
                onClick={() => onAddMilestone("project" as any, -1)}
              >
                설정하기
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Target className="h-4 w-4" />
            <span>목표를 자유롭게 입력하세요...</span>
          </div>
        )}
      </div>

      {/* 로딩 표시 */}
      {isRefreshing && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>최신 활동을 확인하고 있어요...</span>
        </div>
      )}

      {/* 피드 카드 목록 */}
      {entries.map((entry) => (
        <div key={entry.id}>
          <FeedCard
            entry={entry}
            scopeName={getScopeName(entry)}
            onAddMilestone={onAddMilestone}
          />
          {/* 프로젝트 그룹핑 제안 배너 */}
          {entry.groupSuggestion && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
              <p className="text-sm font-medium">{entry.groupSuggestion.suggestion}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {entry.groupSuggestion.repositories.map((r) => r.name).join(", ")}을(를) 하나의 프로젝트로 묶을까요?
              </p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="default" onClick={() => onAcceptGroupSuggestion(entry.groupSuggestion!)}>
                  묶기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDismissGroupSuggestion(entry.id)}>
                  무시
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* 빈 상태 */}
      {!isRefreshing && entries.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">아직 뉴스피드가 없어요.</p>
          <p className="text-xs mt-1">저장소를 등록하면 활동 브리핑이 여기에 표시됩니다.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 대시보드 page.tsx 개편**

기존 `src/app/(dashboard)/page.tsx`를 전면 개편한다. 좌우 분할 레이아웃으로 변경하고, 기존 저장소 목록/스케줄러 상태/수동 동기화 버튼을 제거한다.

핵심 변경:
1. 기존 단일 컬럼 → `grid grid-cols-1 lg:grid-cols-[350px_1fr]` 좌우 분할
2. 왼쪽: `StatusPanel` (인사말 + 에러배너 + 통계 + 히트맵 + 성장트리)
3. 오른쪽: `NewsfeedPanel` (마일스톤 입력 + 피드 카드 + 그룹 제안)
4. 데이터 fetch: 기존 `/dashboard/stats`, `/commits/heatmap` + 신규 `/feed`, `/feed/refresh`, `/milestones`, `/projects`
5. 대시보드 접속 시 `POST /api/feed/refresh` 호출 → 완료 후 `GET /api/feed` 로 피드 로드
6. 스케줄러 상태 표시 제거 → 에러 시만 알림 배너

이 파일은 361줄로 큰 파일이므로, 전체 재작성이 필요하다. 기존 파일에서 `parseUTC`, `formatRelativeDate`, `formatTimeAgo` 유틸 함수는 유지하되, 컴포넌트 구조를 완전히 변경한다.

상세 구현은 기존 data fetch 패턴(60초 폴링 + visibility 감지)을 유지하되, fetch 대상을 신규 API로 교체한다. 마일스톤 추가 다이얼로그는 Task 7에서 구현한다.

- [ ] **Step 5: 브라우저에서 테스트**

Run: `npm run dev`

확인 항목:
1. 대시보드 접속 시 좌우 분할 레이아웃 표시
2. 왼쪽 패널: 인사말 + 통계 카드 + 히트맵 + 성장 트리 (기존 동작 유지)
3. 오른쪽 패널: "최신 활동을 확인하고 있어요..." 로딩 → 피드 카드 표시 (또는 빈 상태)
4. 에러 시 인사말 아래 알림 배너 표시
5. 모바일: 세로 스택 레이아웃

- [ ] **Step 6: 커밋**

```bash
git add src/app/\(dashboard\)/page.tsx src/components/feed/
git commit -m "feat: 대시보드 좌우 분할 레이아웃 개편 — 상태 패널 + 뉴스피드 패널"
```

---

### Task 7: 마일스톤 입력 다이얼로그 + 프로젝트 그룹핑 인터랙션

**Files:**
- Create: `src/components/feed/milestone-dialog.tsx`
- Modify: `src/components/feed/newsfeed-panel.tsx` (다이얼로그 연결)
- Modify: `src/app/(dashboard)/page.tsx` (프로젝트 그룹핑 수락 로직)

**Interfaces:**
- Consumes:
  - `api("/milestones/parse")` POST (Task 5)
  - `api("/milestones")` POST (Task 5)
  - `api("/projects")` POST (Task 5)
  - shadcn/ui: Dialog, Input, Button, Select, Badge
- Produces: 마일스톤 생성 다이얼로그 UI + 프로젝트 그룹핑 수락 핸들러

- [ ] **Step 1: shadcn/ui 컴포넌트 추가 (필요 시)**

프로젝트에 아직 없는 컴포넌트가 있다면 추가:

```bash
npx shadcn@latest add dialog select
```

(이미 있으면 스킵)

- [ ] **Step 2: 마일스톤 다이얼로그 컴포넌트**

```typescript
// src/components/feed/milestone-dialog.tsx
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target } from "lucide-react";
import { api } from "@/lib/api-url";
import type { MilestoneParseResult } from "@/core/feed/briefing-prompt";

interface MilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRawInput?: string;
  preselectedScope?: { type: "project" | "repository"; id: number; name: string } | null;
  projects: Array<{ id: number; name: string }>;
  repositories: Array<{ id: number; name: string }>;
  onCreated: () => void;
}

export function MilestoneDialog({
  open, onOpenChange, initialRawInput = "", preselectedScope,
  projects, repositories, onCreated,
}: MilestoneDialogProps) {
  const [rawInput, setRawInput] = useState(initialRawInput);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [parseResult, setParseResult] = useState<MilestoneParseResult | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDeadline, setEditedDeadline] = useState("");
  const [selectedScope, setSelectedScope] = useState<{ type: string; id: number } | null>(
    preselectedScope ? { type: preselectedScope.type, id: preselectedScope.id } : null
  );

  async function handleParse() {
    if (!rawInput.trim()) return;
    setIsParsing(true);
    try {
      const res = await fetch(api("/milestones/parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: rawInput.trim() }),
      });
      const data = await res.json();
      setParseResult(data);
      setEditedTitle(data.title || rawInput);
      setEditedDeadline(data.deadline || "");
      if (data.suggestedScope && !preselectedScope) {
        setSelectedScope({ type: data.suggestedScope.type, id: data.suggestedScope.id });
      }
    } catch (err) {
      console.error("milestone parse error:", err);
    } finally {
      setIsParsing(false);
    }
  }

  async function handleCreate() {
    if (!editedTitle.trim() || !selectedScope) return;
    setIsCreating(true);
    try {
      await fetch(api("/milestones"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editedTitle.trim(),
          rawInput: rawInput.trim(),
          deadline: editedDeadline || null,
          projectId: selectedScope.type === "project" ? selectedScope.id : null,
          repositoryId: selectedScope.type === "repository" ? selectedScope.id : null,
        }),
      });
      onCreated();
      onOpenChange(false);
      resetState();
    } catch (err) {
      console.error("milestone create error:", err);
    } finally {
      setIsCreating(false);
    }
  }

  function resetState() {
    setRawInput("");
    setParseResult(null);
    setEditedTitle("");
    setEditedDeadline("");
    setSelectedScope(preselectedScope ? { type: preselectedScope.type, id: preselectedScope.id } : null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            마일스톤 설정
          </DialogTitle>
        </DialogHeader>

        {!parseResult ? (
          <div className="space-y-4">
            <Input
              placeholder="목표를 자유롭게 입력하세요..."
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleParse(); }}
              autoFocus
            />
            <Button className="w-full" onClick={handleParse} disabled={isParsing || !rawInput.trim()}>
              {isParsing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isParsing ? "분석 중..." : "확인"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">제목</label>
              <Input value={editedTitle} onChange={(e) => setEditedTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">마감일</label>
              <Input type="date" value={editedDeadline} onChange={(e) => setEditedDeadline(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">연결 대상</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {projects.map((p) => (
                  <Badge
                    key={`p-${p.id}`}
                    variant={selectedScope?.type === "project" && selectedScope?.id === p.id ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setSelectedScope({ type: "project", id: p.id })}
                  >
                    {p.name}
                  </Badge>
                ))}
                {repositories.map((r) => (
                  <Badge
                    key={`r-${r.id}`}
                    variant={selectedScope?.type === "repository" && selectedScope?.id === r.id ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setSelectedScope({ type: "repository", id: r.id })}
                  >
                    {r.name}
                  </Badge>
                ))}
              </div>
              {parseResult.suggestedScope && (
                <p className="text-xs text-muted-foreground mt-1">
                  AI 추천: {parseResult.suggestedScope.name}
                  ({parseResult.suggestedScope.confidence === "high" ? "높은 확신" : parseResult.suggestedScope.confidence === "medium" ? "보통" : "낮은 확신"})
                </p>
              )}
            </div>
          </div>
        )}

        {parseResult && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setParseResult(null)}>다시 입력</Button>
            <Button onClick={handleCreate} disabled={isCreating || !editedTitle.trim() || !selectedScope}>
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              설정 완료
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: newsfeed-panel.tsx에 다이얼로그 연결**

`NewsfeedPanel`의 마일스톤 입력 바에서 "설정하기" 클릭 시 `MilestoneDialog`를 열도록 수정한다. 상단 입력 바의 입력 값을 `initialRawInput`으로 전달한다.

- [ ] **Step 4: page.tsx에 프로젝트 그룹핑 수락 핸들러 구현**

`onAcceptGroupSuggestion` 핸들러가 `POST /api/projects`를 호출하여 프로젝트를 생성한 후 피드를 새로고침한다.

- [ ] **Step 5: 브라우저에서 테스트**

Run: `npm run dev`

확인 항목:
1. 뉴스피드 상단 입력 바 클릭 → 확장 → 텍스트 입력 → "설정하기" → 다이얼로그 열림
2. 다이얼로그에서 자연어 입력 → "확인" → LLM 파싱 결과 표시 (제목, 마감일, 추천 대상)
3. 제목/마감일 수정 가능, 연결 대상 Badge 클릭으로 변경 가능
4. "설정 완료" → 마일스톤 생성 → 다이얼로그 닫힘
5. 피드 카드의 마일스톤 추가 버튼 → preselectedScope 설정된 다이얼로그
6. 프로젝트 그룹핑 제안 배너 "묶기" → 프로젝트 생성 → 피드 새로고침

- [ ] **Step 6: 커밋**

```bash
git add src/components/feed/milestone-dialog.tsx src/components/feed/newsfeed-panel.tsx src/app/\(dashboard\)/page.tsx
git commit -m "feat: 마일스톤 설정 다이얼로그 및 프로젝트 그룹핑 인터랙션 구현"
```

---

### Task 8: 통합 테스트 + 마무리

**Files:**
- Create: `src/__tests__/infra/db/project-repository.test.ts`
- Create: `src/__tests__/infra/db/milestone-repository.test.ts`
- Modify: `src/__tests__/infra/db/feed-tables.test.ts` (CRUD 테스트 추가)

**Interfaces:**
- Consumes: Task 1~7의 모든 산출물
- Produces: 통합 테스트 스위트 + 전체 기능 검증

- [ ] **Step 1: 프로젝트 Repository 테스트**

```typescript
// src/__tests__/infra/db/project-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import { insertProject, getProjectsByUser, getProjectWithRepos, updateProject, deleteProject } from "@/infra/db/project-repository";

describe("project-repository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
    // 테스트용 저장소 2개 삽입
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run("o1", "r1", "main", "u1", "https://x.com/o1/r1");
    db.prepare("INSERT INTO repositories (owner, repo, branch, user_id, clone_url) VALUES (?, ?, ?, ?, ?)").run("o1", "r2", "main", "u1", "https://x.com/o1/r2");
  });

  afterEach(() => { db.close(); });

  it("should create project with repository links", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const id = insertProject(db, {
      userId: "u1", name: "MyProject", description: "test",
      repositoryIds: repos.map((r: any) => r.id),
    });
    expect(id).toBeGreaterThan(0);
    const project = getProjectWithRepos(db, id);
    expect(project?.name).toBe("MyProject");
    expect(project?.repositoryIds).toHaveLength(2);
  });

  it("should list projects by user", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    insertProject(db, { userId: "u1", name: "P1", description: null, repositoryIds: [repos[0].id] });
    insertProject(db, { userId: "u1", name: "P2", description: null, repositoryIds: [repos[1].id] });
    const projects = getProjectsByUser(db, "u1");
    expect(projects).toHaveLength(2);
  });

  it("should update project repositories", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const id = insertProject(db, { userId: "u1", name: "P1", description: null, repositoryIds: [repos[0].id] });
    updateProject(db, id, { repositoryIds: [repos[0].id, repos[1].id] });
    const updated = getProjectWithRepos(db, id);
    expect(updated?.repositoryIds).toHaveLength(2);
  });

  it("should delete project and cascade", () => {
    const repos = db.prepare("SELECT id FROM repositories").all() as any[];
    const id = insertProject(db, { userId: "u1", name: "P1", description: null, repositoryIds: [repos[0].id] });
    deleteProject(db, id);
    expect(getProjectWithRepos(db, id)).toBeNull();
    const links = db.prepare("SELECT * FROM project_repositories WHERE project_id = ?").all(id);
    expect(links).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 마일스톤 Repository 테스트**

```typescript
// src/__tests__/infra/db/milestone-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import { insertMilestone, getMilestonesByUser, getActiveMilestonesByScope, updateMilestone, deleteMilestone } from "@/infra/db/milestone-repository";

describe("milestone-repository", () => {
  let db: Database.Database;
  let projectId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    createTables(db);
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run("u1", "P1");
    projectId = (db.prepare("SELECT id FROM projects").get() as any).id;
  });

  afterEach(() => { db.close(); });

  it("should insert and retrieve milestone", () => {
    const id = insertMilestone(db, {
      userId: "u1", projectId, repositoryId: null,
      title: "MVP 출시", rawInput: "다음달까지 MVP", deadline: "2026-07-05",
    });
    const milestones = getMilestonesByUser(db, "u1");
    expect(milestones).toHaveLength(1);
    expect(milestones[0].title).toBe("MVP 출시");
    expect(milestones[0].status).toBe("active");
  });

  it("should filter active milestones by scope", () => {
    insertMilestone(db, { userId: "u1", projectId, repositoryId: null, title: "M1", rawInput: "m1", deadline: null });
    insertMilestone(db, { userId: "u1", projectId, repositoryId: null, title: "M2", rawInput: "m2", deadline: null });
    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(2);
  });

  it("should update milestone status", () => {
    const id = insertMilestone(db, { userId: "u1", projectId, repositoryId: null, title: "M1", rawInput: "m1", deadline: null });
    updateMilestone(db, id, { status: "completed" });
    const active = getActiveMilestonesByScope(db, "project", projectId);
    expect(active).toHaveLength(0);
  });

  it("should delete milestone", () => {
    const id = insertMilestone(db, { userId: "u1", projectId, repositoryId: null, title: "M1", rawInput: "m1", deadline: null });
    deleteMilestone(db, id);
    expect(getMilestonesByUser(db, "u1")).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 전체 테스트 스위트**

Run: `npx vitest run`
Expected: 기존 테스트 + 신규 테스트 모두 PASS

- [ ] **Step 4: 브라우저 최종 검증**

Run: `npm run dev`

E2E 확인 체크리스트:
1. 대시보드 접속 → 좌우 분할 표시
2. 왼쪽: 인사말 + 통계 + 히트맵 + 성장 트리 정상 표시
3. 오른쪽: 피드 로딩 → 브리핑 카드 표시 (저장소 등록 + 커밋이 있는 경우)
4. 마일스톤 입력 바 → 자연어 입력 → LLM 파싱 → 확인 → 생성
5. 피드 카드 마일스톤 버튼 → 스코프 사전 선택된 다이얼로그
6. 프로젝트 그룹핑 제안 → "묶기" → 프로젝트 생성
7. 모바일 반응형: 세로 스택
8. 에러 시 알림 배너 표시 + 재시도

- [ ] **Step 5: 커밋**

```bash
git add src/__tests__/infra/db/project-repository.test.ts src/__tests__/infra/db/milestone-repository.test.ts
git commit -m "test: 프로젝트·마일스톤 DB Repository 통합 테스트 추가"
```
