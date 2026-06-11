# Clone → API 전환 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** git clone --bare 기반 구조를 완전 제거하고, Git 호스팅 프로바이더 REST API로 교체하여 commit_cache를 유일한 커밋 데이터 소스로 승격한다.

**Architecture:** `GitProviderClient` 인터페이스를 정의하고 GitHub/Gitea/GitLab/Bitbucket 프로바이더별로 구현한다. 저장소 등록 시 API로 최근 6개월 커밋을 조회하여 commit_cache에 저장하고, 증분 동기화도 API 기반으로 전환한다. commit_cache에 additions/deletions/files_changed 컬럼을 추가하여 보고서 생성 시 추가 API 호출 없이 DB 조회만으로 완결한다.

**Tech Stack:** Next.js 16, TypeScript, better-sqlite3, @octokit/rest (GitHub), fetch (Gitea/GitLab/Bitbucket), Vitest

**Spec:** `docs/superpowers/specs/2026-06-11-clone-to-api-migration-design.md`

---

### Task 1: GitProviderClient 인터페이스 및 공통 타입 정의

**Files:**
- Create: `src/infra/git-provider/types.ts`

- [ ] **Step 1: 공통 타입 및 인터페이스 파일 생성**

```typescript
// src/infra/git-provider/types.ts
import type { RemoteRepository } from "@/core/types";

export interface ApiCommit {
  sha: string;
  message: string;
  author: string;
  date: string;           // ISO 8601
  additions: number;
  deletions: number;
  filesChanged: string[];
}

export interface ApiBranch {
  name: string;
  isDefault: boolean;
}

export interface ListCommitsOptions {
  branch?: string;
  since?: string;   // ISO 8601
  author?: string;
  perPage?: number;
  page?: number;
}

export interface GitProviderClient {
  listRepos(): Promise<RemoteRepository[]>;
  listBranches(owner: string, repo: string): Promise<ApiBranch[]>;
  listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]>;
  getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit>;
  getCommitDiff(owner: string, repo: string, sha: string): Promise<string>;
  getRepoLanguage(owner: string, repo: string): Promise<string | null>;
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/infra/git-provider/types.ts
git commit -m "feat: GitProviderClient 인터페이스 및 공통 타입 정의"
```

---

### Task 2: DB 스키마 변경

commit_cache에 additions/deletions/files_changed 컬럼 추가, repositories에서 clone_path/clone_status 제거 → sync_status 추가.

**Files:**
- Modify: `src/infra/db/schema.ts`

- [ ] **Step 1: createTables() 수정**

`src/infra/db/schema.ts`의 `createTables()` 내 repositories 테이블에서:
- `clone_path TEXT,` 행 제거
- `clone_status` 관련이 없으므로 추가 삭제 불필요 (clone_status는 migrateSchema에서만 추가됨)
- `sync_status TEXT NOT NULL DEFAULT 'pending',` 추가 (clone_path가 있던 자리)

commit_cache 테이블에 3개 컬럼 추가:
```sql
additions INTEGER NOT NULL DEFAULT 0,
deletions INTEGER NOT NULL DEFAULT 0,
files_changed TEXT,
```

정확한 변경: `src/infra/db/schema.ts`의 repositories DDL 부분에서:

```
-- 변경 전:
clone_url TEXT NOT NULL DEFAULT '',
clone_path TEXT,
git_author TEXT,

-- 변경 후:
clone_url TEXT NOT NULL DEFAULT '',
sync_status TEXT NOT NULL DEFAULT 'pending',
git_author TEXT,
```

commit_cache DDL 부분에서:
```
-- 변경 전:
committed_at TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),

-- 변경 후:
committed_at TEXT NOT NULL,
additions INTEGER NOT NULL DEFAULT 0,
deletions INTEGER NOT NULL DEFAULT 0,
files_changed TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
```

- [ ] **Step 2: migrateSchema() 정리**

다음 코드 블록을 삭제:
- `clone_path` 추가 마이그레이션 (185~187행 부근)
- `clone_status` 추가 마이그레이션 (269~273행 부근)
- `credential_id` 마이그레이션 내의 clone_url 기반 매핑 코드는 유지 (credential_id 자체는 필요)

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run src/__tests__/infra/db/schema.test.ts
```

기존 테스트 중 `clone_path`를 검증하는 테스트가 실패할 것이다. 다음 단계에서 수정.

- [ ] **Step 4: schema 테스트 수정**

`src/__tests__/infra/db/schema.test.ts`에서:

```typescript
// 변경 전:
it("should have user_id, clone_url, clone_path columns in repositories", () => {
  const info = db.prepare("PRAGMA table_info(repositories)").all() as any[];
  const columnNames = info.map((col: any) => col.name);
  expect(columnNames).toContain("user_id");
  expect(columnNames).toContain("clone_url");
  expect(columnNames).toContain("clone_path");
});

// 변경 후:
it("should have user_id, clone_url, sync_status columns in repositories", () => {
  const info = db.prepare("PRAGMA table_info(repositories)").all() as any[];
  const columnNames = info.map((col: any) => col.name);
  expect(columnNames).toContain("user_id");
  expect(columnNames).toContain("clone_url");
  expect(columnNames).toContain("sync_status");
  expect(columnNames).not.toContain("clone_path");
  expect(columnNames).not.toContain("clone_status");
});
```

commit_cache 컬럼 검증 테스트 추가:

```typescript
it("should have additions, deletions, files_changed columns in commit_cache", () => {
  const info = db.prepare("PRAGMA table_info(commit_cache)").all() as any[];
  const columnNames = info.map((col: any) => col.name);
  expect(columnNames).toContain("additions");
  expect(columnNames).toContain("deletions");
  expect(columnNames).toContain("files_changed");
});
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/infra/db/schema.test.ts
```

- [ ] **Step 6: 커밋**

```bash
git add src/infra/db/schema.ts src/__tests__/infra/db/schema.test.ts
git commit -m "refactor: DB 스키마에서 clone 컬럼 제거, sync_status 추가, commit_cache 확장"
```

---

### Task 3: commit_cache DB 함수 확장 및 clone 관련 함수 정리

CacheCommit 타입에 additions/deletions/filesChanged 추가, updateCloneStatus → updateSyncStatus 교체, clone_path 의존 함수 정리.

**Files:**
- Modify: `src/infra/db/repository.ts`

- [ ] **Step 1: CacheCommit 타입 확장**

```typescript
// 변경 전:
export interface CacheCommit {
  sha: string;
  repositoryId: number;
  branch: string;
  author: string;
  message: string;
  committedDate: string;
  committedAt: string;
}

// 변경 후:
export interface CacheCommit {
  sha: string;
  repositoryId: number;
  branch: string;
  author: string;
  message: string;
  committedDate: string;
  committedAt: string;
  additions: number;
  deletions: number;
  filesChanged: string[];  // 코드에서는 배열, DB 저장 시 JSON 직렬화
}
```

- [ ] **Step 2: insertCommitCache 수정**

```typescript
// 변경 전:
export function insertCommitCache(db: Database.Database, commits: CacheCommit[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: CacheCommit[]) => {
    let inserted = 0;
    for (const c of rows) {
      const result = stmt.run(c.sha, c.repositoryId, c.branch, c.author, c.message, c.committedDate, c.committedAt);
      inserted += result.changes;
    }
    return inserted;
  });
  return insertMany(commits);
}

// 변경 후:
export function insertCommitCache(db: Database.Database, commits: CacheCommit[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO commit_cache (sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: CacheCommit[]) => {
    let inserted = 0;
    for (const c of rows) {
      const result = stmt.run(
        c.sha, c.repositoryId, c.branch, c.author, c.message,
        c.committedDate, c.committedAt,
        c.additions, c.deletions,
        c.filesChanged.length > 0 ? JSON.stringify(c.filesChanged) : null
      );
      inserted += result.changes;
    }
    return inserted;
  });
  return insertMany(commits);
}
```

- [ ] **Step 3: getCommitsByDateRange 수정 — additions/deletions/filesChanged 반환**

```typescript
// 변경 전 SELECT:
`SELECT sha, repository_id, branch, author, message, committed_date, committed_at`

// 변경 후 SELECT:
`SELECT sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed`

// 변경 전 매핑:
return rows.map(r => ({
  sha: r.sha,
  repositoryId: r.repository_id,
  branch: r.branch,
  author: r.author,
  message: r.message,
  committedDate: r.committed_date,
  committedAt: r.committed_at,
}));

// 변경 후 매핑:
return rows.map(r => ({
  sha: r.sha,
  repositoryId: r.repository_id,
  branch: r.branch,
  author: r.author,
  message: r.message,
  committedDate: r.committed_date,
  committedAt: r.committed_at,
  additions: r.additions ?? 0,
  deletions: r.deletions ?? 0,
  filesChanged: r.files_changed ? JSON.parse(r.files_changed) : [],
}));
```

- [ ] **Step 4: updateCloneStatus → updateSyncStatus 교체**

```typescript
// 삭제:
export function updateCloneStatus(db: Database.Database, id: number, status: string): void {
  db.prepare(
    "UPDATE repositories SET clone_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

// 추가:
export function updateSyncStatus(db: Database.Database, id: number, status: string): void {
  db.prepare(
    "UPDATE repositories SET sync_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}
```

- [ ] **Step 5: getAutoReportEnabledRepos 수정**

```typescript
// 변경 전:
"SELECT * FROM repositories WHERE auto_report_enabled = 1 AND clone_path IS NOT NULL"

// 변경 후:
"SELECT * FROM repositories WHERE auto_report_enabled = 1 AND sync_status = 'ready'"
```

- [ ] **Step 6: commit_cache 테스트 수정**

`src/__tests__/infra/db/commit-cache.test.ts`에서 `makeCommit` 헬퍼에 새 필드 추가:

```typescript
// 변경 전:
function makeCommit(overrides: Partial<CacheCommit> = {}): CacheCommit {
  return {
    sha: "abc123def456abc123def456abc123def456abc1",
    repositoryId: 1,
    branch: "main",
    author: "tester",
    message: "test commit",
    committedDate: "2026-04-10",
    committedAt: "2026-04-10T09:00:00+09:00",
    ...overrides,
  };
}

// 변경 후:
function makeCommit(overrides: Partial<CacheCommit> = {}): CacheCommit {
  return {
    sha: "abc123def456abc123def456abc123def456abc1",
    repositoryId: 1,
    branch: "main",
    author: "tester",
    message: "test commit",
    committedDate: "2026-04-10",
    committedAt: "2026-04-10T09:00:00+09:00",
    additions: 0,
    deletions: 0,
    filesChanged: [],
    ...overrides,
  };
}
```

additions/deletions/filesChanged 저장 및 조회 테스트 추가:

```typescript
it("additions/deletions/filesChanged가 저장 및 조회된다", () => {
  const commit = makeCommit({
    additions: 50,
    deletions: 10,
    filesChanged: ["src/foo.ts", "src/bar.ts"],
  });
  insertCommitCache(db, [commit]);
  const commits = getCommitsByDate(db, [1], "2026-04-10");
  expect(commits[0].additions).toBe(50);
  expect(commits[0].deletions).toBe(10);
  expect(commits[0].filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
});

it("filesChanged가 빈 배열이면 null로 저장되고 빈 배열로 반환된다", () => {
  const commit = makeCommit({ filesChanged: [] });
  insertCommitCache(db, [commit]);
  const commits = getCommitsByDate(db, [1], "2026-04-10");
  expect(commits[0].filesChanged).toEqual([]);
});
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/infra/db/commit-cache.test.ts
```

- [ ] **Step 8: 커밋**

```bash
git add src/infra/db/repository.ts src/__tests__/infra/db/commit-cache.test.ts
git commit -m "refactor: CacheCommit에 additions/deletions/filesChanged 추가, clone 함수 정리"
```

---

### Task 4: GitHub 프로바이더 GitProviderClient 구현

기존 `github-api.ts`의 `listGitHubRepos`를 유지하면서 GitProviderClient 인터페이스를 구현하는 클래스를 추가한다.

**Files:**
- Modify: `src/infra/git-provider/github-api.ts`
- Test: `src/__tests__/infra/git-provider/github-api.test.ts`

- [ ] **Step 1: GitHub 프로바이더 클래스 구현**

기존 `normalizeGitHubRepo`, `listGitHubRepos` 함수를 유지하고, 그 아래에 클래스를 추가한다:

```typescript
import { Octokit } from "@octokit/rest";
import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

// ... 기존 normalizeGitHubRepo, listGitHubRepos 유지 ...

export class GitHubProvider implements GitProviderClient {
  private client: Octokit;

  constructor(token: string) {
    this.client = new Octokit({ auth: token });
  }

  async listRepos(): Promise<RemoteRepository[]> {
    const repos: RemoteRepository[] = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.rest.repos.listForAuthenticatedUser({
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
        per_page: 100,
        page,
      });
      if (data.length === 0) break;
      repos.push(...data.map(normalizeGitHubRepo));
      if (data.length < 100) break;
      page++;
    }
    return repos;
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.rest.repos.listBranches({
        owner, repo, per_page: 100, page,
      });
      if (data.length === 0) break;
      // default branch 판별을 위해 repo 정보 필요 — 첫 페이지에서 확인
      branches.push(...data.map((b: any) => ({ name: b.name, isDefault: false })));
      if (data.length < 100) break;
      page++;
    }
    // default branch 마킹
    try {
      const { data: repoInfo } = await this.client.rest.repos.get({ owner, repo });
      const defaultBranch = repoInfo.default_branch;
      for (const b of branches) {
        if (b.name === defaultBranch) b.isDefault = true;
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params: any = { owner, repo, per_page: options?.perPage ?? 100 };
    if (options?.branch) params.sha = options.branch;
    if (options?.since) params.since = options.since;
    if (options?.author) params.author = options.author;
    if (options?.page) params.page = options.page;

    const { data } = await this.client.rest.repos.listCommits(params);

    return data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || "unknown",
      date: c.commit.author?.date || new Date().toISOString(),
      additions: 0,
      deletions: 0,
      filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const { data } = await this.client.rest.repos.getCommit({ owner, repo, ref: sha });
    const files = data.files || [];
    return {
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name || "unknown",
      date: data.commit.author?.date || new Date().toISOString(),
      additions: files.reduce((sum: number, f: any) => sum + (f.additions || 0), 0),
      deletions: files.reduce((sum: number, f: any) => sum + (f.deletions || 0), 0),
      filesChanged: files.map((f: any) => f.filename),
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const { data } = await this.client.rest.repos.getCommit({
      owner, repo, ref: sha,
      mediaType: { format: "diff" },
    });
    return data as unknown as string;
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const { data } = await this.client.rest.repos.get({ owner, repo });
      return data.language ?? null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: 기존 테스트 유지 확인 + 새 테스트 추가하지 않음 (API 호출이므로)**

기존 `normalizeGitHubRepo` 테스트는 그대로 유지한다. 클래스 메서드는 Octokit API 호출이므로 단위 테스트 대상이 아니다.

```bash
npx vitest run src/__tests__/infra/git-provider/github-api.test.ts
```

- [ ] **Step 3: 커밋**

```bash
git add src/infra/git-provider/github-api.ts
git commit -m "feat: GitHub GitProviderClient 구현"
```

---

### Task 5: Gitea 프로바이더 GitProviderClient 구현

**Files:**
- Modify: `src/infra/git-provider/gitea-api.ts`

- [ ] **Step 1: Gitea 프로바이더 클래스 구현**

기존 `normalizeGiteaRepo`, `listGiteaRepos` 함수를 유지하고 클래스 추가:

```typescript
import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

// ... 기존 normalizeGiteaRepo, listGiteaRepos 유지 ...

export class GiteaProvider implements GitProviderClient {
  private apiBase: string;
  private token: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.token = token;
    this.headers = { Authorization: `token ${token}` };
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listGiteaRepos(this.apiBase, this.token);
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${this.apiBase}/repos/${owner}/${repo}/branches?page=${page}&limit=50`,
        { headers: this.headers }
      );
      if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      branches.push(...data.map((b: any) => ({
        name: b.name,
        isDefault: b.name === b.default_branch || false,
      })));
      if (data.length < 50) break;
      page++;
    }
    // default branch 마킹
    try {
      const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}`, { headers: this.headers });
      if (res.ok) {
        const repoInfo = await res.json();
        for (const b of branches) {
          b.isDefault = b.name === repoInfo.default_branch;
        }
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params = new URLSearchParams();
    if (options?.branch) params.set("sha", options.branch);
    if (options?.since) params.set("since", options.since);
    params.set("limit", String(options?.perPage ?? 50));
    if (options?.page) params.set("page", String(options.page));

    const res = await fetch(
      `${this.apiBase}/repos/${owner}/${repo}/commits?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    const data = await res.json();

    return (data as any[]).map((c: any) => ({
      sha: c.sha,
      message: c.commit?.message || "",
      author: c.commit?.author?.name || "unknown",
      date: c.commit?.author?.date || c.created || new Date().toISOString(),
      additions: 0,
      deletions: 0,
      filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const res = await fetch(
      `${this.apiBase}/repos/${owner}/${repo}/git/commits/${sha}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    const data = await res.json();

    // Gitea의 stats 필드에서 additions/deletions 가져오기
    // files 목록은 diff API로 별도 조회
    const diffRes = await fetch(
      `${this.apiBase}/repos/${owner}/${repo}/commits/${sha}`,
      { headers: this.headers }
    );
    let files: string[] = [];
    let additions = data.stats?.additions ?? 0;
    let deletions = data.stats?.deletions ?? 0;

    if (diffRes.ok) {
      const diffData = await diffRes.json();
      if (Array.isArray(diffData.files)) {
        files = diffData.files.map((f: any) => f.filename);
        additions = diffData.stats?.total_additions ?? additions;
        deletions = diffData.stats?.total_deletions ?? deletions;
      }
    }

    return {
      sha: data.sha,
      message: data.message || data.commit?.message || "",
      author: data.author?.login || data.commit?.author?.name || "unknown",
      date: data.created || data.commit?.author?.date || new Date().toISOString(),
      additions,
      deletions,
      filesChanged: files,
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const res = await fetch(
      `${this.apiBase}/repos/${owner}/${repo}/git/commits/${sha}.diff`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Gitea API error: ${res.status}`);
    return res.text();
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiBase}/repos/${owner}/${repo}/languages`, { headers: this.headers });
      if (!res.ok) return null;
      const data = await res.json();
      // 가장 많이 사용된 언어 반환
      const entries = Object.entries(data) as [string, number][];
      if (entries.length === 0) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: 기존 테스트 통과 확인**

```bash
npx vitest run src/__tests__/infra/git-provider/gitea-api.test.ts
```

- [ ] **Step 3: 커밋**

```bash
git add src/infra/git-provider/gitea-api.ts
git commit -m "feat: Gitea GitProviderClient 구현"
```

---

### Task 6: GitLab 프로바이더 GitProviderClient 구현

**Files:**
- Modify: `src/infra/git-provider/gitlab-api.ts`

- [ ] **Step 1: GitLab 프로바이더 클래스 구현**

기존 `normalizeGitLabRepo`, `listGitLabRepos` 유지하고 클래스 추가:

```typescript
import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

// ... 기존 코드 유지 ...

export class GitLabProvider implements GitProviderClient {
  private apiBase: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.headers = { "PRIVATE-TOKEN": token };
  }

  private encodeProject(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listGitLabRepos(this.apiBase, Object.values(this.headers)[0]);
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const projectId = this.encodeProject(owner, repo);
    const branches: ApiBranch[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${this.apiBase}/projects/${projectId}/repository/branches?per_page=100&page=${page}`,
        { headers: this.headers }
      );
      if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      branches.push(...data.map((b: any) => ({
        name: b.name,
        isDefault: b.default ?? false,
      })));
      if (data.length < 100) break;
      page++;
    }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const projectId = this.encodeProject(owner, repo);
    const params = new URLSearchParams();
    if (options?.branch) params.set("ref_name", options.branch);
    if (options?.since) params.set("since", options.since);
    params.set("per_page", String(options?.perPage ?? 100));
    if (options?.page) params.set("page", String(options.page));

    const res = await fetch(
      `${this.apiBase}/projects/${projectId}/repository/commits?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const data = await res.json();

    return (data as any[]).map((c: any) => ({
      sha: c.id,
      message: c.message || "",
      author: c.author_name || "unknown",
      date: c.authored_date || c.created_at || new Date().toISOString(),
      additions: 0,
      deletions: 0,
      filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    const projectId = this.encodeProject(owner, repo);

    // 커밋 기본 정보
    const commitRes = await fetch(
      `${this.apiBase}/projects/${projectId}/repository/commits/${sha}`,
      { headers: this.headers }
    );
    if (!commitRes.ok) throw new Error(`GitLab API error: ${commitRes.status}`);
    const commitData = await commitRes.json();

    // diff로 파일 목록 조회
    const diffRes = await fetch(
      `${this.apiBase}/projects/${projectId}/repository/commits/${sha}/diff`,
      { headers: this.headers }
    );
    let files: string[] = [];
    if (diffRes.ok) {
      const diffData = await diffRes.json();
      if (Array.isArray(diffData)) {
        files = diffData.map((d: any) => d.new_path || d.old_path);
      }
    }

    return {
      sha: commitData.id,
      message: commitData.message || "",
      author: commitData.author_name || "unknown",
      date: commitData.authored_date || commitData.created_at || new Date().toISOString(),
      additions: commitData.stats?.additions ?? 0,
      deletions: commitData.stats?.deletions ?? 0,
      filesChanged: files,
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const projectId = this.encodeProject(owner, repo);
    const res = await fetch(
      `${this.apiBase}/projects/${projectId}/repository/commits/${sha}/diff`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const data = await res.json();
    // diff 배열을 텍스트로 결합
    if (Array.isArray(data)) {
      return data.map((d: any) => d.diff || "").join("\n");
    }
    return JSON.stringify(data);
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const projectId = this.encodeProject(owner, repo);
      const res = await fetch(
        `${this.apiBase}/projects/${projectId}/languages`,
        { headers: this.headers }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const entries = Object.entries(data) as [string, number][];
      if (entries.length === 0) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/infra/git-provider/gitlab-api.ts
git commit -m "feat: GitLab GitProviderClient 구현"
```

---

### Task 7: Bitbucket 프로바이더 GitProviderClient 구현

**Files:**
- Modify: `src/infra/git-provider/bitbucket-api.ts`

- [ ] **Step 1: Bitbucket 프로바이더 클래스 구현**

기존 `normalizeBitbucketRepo`, `listBitbucketRepos` 유지하고 클래스 추가:

```typescript
import type { RemoteRepository } from "@/core/types";
import type { GitProviderClient, ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";

// ... 기존 코드 유지 ...

export class BitbucketProvider implements GitProviderClient {
  private apiBase: string;
  private headers: Record<string, string>;

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase;
    this.headers = { Authorization: `Basic ${token}` };
  }

  async listRepos(): Promise<RemoteRepository[]> {
    return listBitbucketRepos(this.apiBase, Object.values(this.headers)[0].replace("Basic ", ""));
  }

  async listBranches(owner: string, repo: string): Promise<ApiBranch[]> {
    const branches: ApiBranch[] = [];
    let nextUrl: string | null = `${this.apiBase}/repositories/${owner}/${repo}/refs/branches?pagelen=100`;
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: this.headers });
      if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.values)) {
        branches.push(...data.values.map((b: any) => ({
          name: b.name,
          isDefault: b.name === data.values[0]?.name, // 첫 번째가 default인 경우가 많음
        })));
      }
      nextUrl = data.next || null;
    }
    // default branch 정확히 마킹
    try {
      const res = await fetch(`${this.apiBase}/repositories/${owner}/${repo}`, { headers: this.headers });
      if (res.ok) {
        const repoInfo = await res.json();
        const defaultName = repoInfo.mainbranch?.name;
        if (defaultName) {
          for (const b of branches) {
            b.isDefault = b.name === defaultName;
          }
        }
      }
    } catch { /* non-critical */ }
    return branches;
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<ApiCommit[]> {
    const params = new URLSearchParams();
    if (options?.branch) params.set("include", options.branch);
    params.set("pagelen", String(options?.perPage ?? 30));
    if (options?.page) params.set("page", String(options.page));

    // Bitbucket은 since 파라미터 대신 쿼리 필터 사용
    // 날짜 필터: q=date > 2026-01-01
    if (options?.since) {
      params.set("q", `date > ${options.since.slice(0, 10)}`);
    }

    const res = await fetch(
      `${this.apiBase}/repositories/${owner}/${repo}/commits?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
    const data = await res.json();

    return (data.values as any[] || []).map((c: any) => ({
      sha: c.hash,
      message: c.message || "",
      author: c.author?.raw?.split("<")[0]?.trim() || c.author?.user?.display_name || "unknown",
      date: c.date || new Date().toISOString(),
      additions: 0,
      deletions: 0,
      filesChanged: [],
    }));
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<ApiCommit> {
    // 커밋 기본 정보
    const commitRes = await fetch(
      `${this.apiBase}/repositories/${owner}/${repo}/commit/${sha}`,
      { headers: this.headers }
    );
    if (!commitRes.ok) throw new Error(`Bitbucket API error: ${commitRes.status}`);
    const commitData = await commitRes.json();

    // diffstat으로 파일 목록 + additions/deletions
    const diffRes = await fetch(
      `${this.apiBase}/repositories/${owner}/${repo}/diffstat/${sha}`,
      { headers: this.headers }
    );
    let files: string[] = [];
    let additions = 0;
    let deletions = 0;

    if (diffRes.ok) {
      const diffData = await diffRes.json();
      if (Array.isArray(diffData.values)) {
        for (const entry of diffData.values) {
          files.push(entry.new?.path || entry.old?.path || "");
          additions += entry.lines_added || 0;
          deletions += entry.lines_removed || 0;
        }
      }
    }

    return {
      sha: commitData.hash,
      message: commitData.message || "",
      author: commitData.author?.raw?.split("<")[0]?.trim() || "unknown",
      date: commitData.date || new Date().toISOString(),
      additions,
      deletions,
      filesChanged: files.filter(Boolean),
    };
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const res = await fetch(
      `${this.apiBase}/repositories/${owner}/${repo}/diff/${sha}`,
      { headers: this.headers }
    );
    if (!res.ok) throw new Error(`Bitbucket API error: ${res.status}`);
    return res.text();
  }

  async getRepoLanguage(owner: string, repo: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.apiBase}/repositories/${owner}/${repo}`,
        { headers: this.headers }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.language || null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/infra/git-provider/bitbucket-api.ts
git commit -m "feat: Bitbucket GitProviderClient 구현"
```

---

### Task 8: 프로바이더 팩토리 생성

**Files:**
- Create: `src/infra/git-provider/index.ts`

- [ ] **Step 1: 팩토리 함수 구현**

```typescript
// src/infra/git-provider/index.ts
import type { GitProviderMeta } from "@/core/types";
import type { GitProviderClient } from "@/infra/git-provider/types";
import { GitHubProvider } from "@/infra/git-provider/github-api";
import { GiteaProvider } from "@/infra/git-provider/gitea-api";
import { GitLabProvider } from "@/infra/git-provider/gitlab-api";
import { BitbucketProvider } from "@/infra/git-provider/bitbucket-api";

export function createGitProvider(meta: GitProviderMeta, token: string): GitProviderClient {
  switch (meta.type) {
    case "github":
      return new GitHubProvider(token);
    case "gitea":
      return new GiteaProvider(meta.apiBase, token);
    case "gitlab":
      return new GitLabProvider(meta.apiBase, token);
    case "bitbucket":
      return new BitbucketProvider(meta.apiBase, token);
    default:
      throw new Error(`Unsupported git provider: ${(meta as any).type}`);
  }
}

export type { GitProviderClient } from "@/infra/git-provider/types";
export type { ApiCommit, ApiBranch, ListCommitsOptions } from "@/infra/git-provider/types";
```

- [ ] **Step 2: 커밋**

```bash
git add src/infra/git-provider/index.ts
git commit -m "feat: Git 프로바이더 팩토리 함수 생성"
```

---

### Task 9: core/types.ts 업데이트

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/__tests__/core/types.test.ts`

- [ ] **Step 1: Repository 타입 수정**

```typescript
// 변경 전:
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
  cloneStatus: "pending" | "cloning" | "caching" | "ready" | "error";
  label: string | null;
}

// 변경 후:
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
  syncStatus: "pending" | "syncing" | "ready" | "error";
  label: string | null;
}
```

- [ ] **Step 2: types 테스트 수정**

```typescript
// 변경 전:
describe("Repository type", () => {
  it("should have userId, cloneUrl, clonePath fields", () => {
    expectTypeOf<Repository>().toHaveProperty("userId");
    expectTypeOf<Repository>().toHaveProperty("cloneUrl");
    expectTypeOf<Repository>().toHaveProperty("clonePath");
  });
});

// 변경 후:
describe("Repository type", () => {
  it("should have userId, cloneUrl, syncStatus fields", () => {
    expectTypeOf<Repository>().toHaveProperty("userId");
    expectTypeOf<Repository>().toHaveProperty("cloneUrl");
    expectTypeOf<Repository>().toHaveProperty("syncStatus");
  });
});
```

- [ ] **Step 3: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/core/types.test.ts
```

- [ ] **Step 4: 커밋**

```bash
git add src/core/types.ts src/__tests__/core/types.test.ts
git commit -m "refactor: Repository 타입에서 clonePath/cloneStatus 제거, syncStatus 추가"
```

---

### Task 10: 저장소 등록/삭제 API 재작성

clone 로직을 완전히 제거하고 API 기반 초기 동기화로 교체한다.

**Files:**
- Modify: `src/app/api/repos/route.ts`

- [ ] **Step 1: import 정리 및 registerSingleRepo 재작성**

```typescript
// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  insertRepositoryForUser,
  getRepositoriesWithLastCommit,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
  updateGitAuthor,
  updateLabel,
  updateSyncStatus,
  updatePrimaryLanguage,
  updateAutoReportEnabled,
  insertCommitCache,
  getLatestCacheDate,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { createGitProvider } from "@/infra/git-provider";
import type { GitProviderMeta } from "@/core/types";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

const detailConcurrency = 5;

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}

async function initialSync(
  db: ReturnType<typeof getDb>,
  repoId: number,
  owner: string,
  repo: string,
  branch: string,
  meta: GitProviderMeta,
  token: string
): Promise<void> {
  updateSyncStatus(db, repoId, "syncing");

  try {
    const provider = createGitProvider(meta, token);

    // 1. 언어 정보
    try {
      const language = await provider.getRepoLanguage(owner, repo);
      updatePrimaryLanguage(db, repoId, language);
    } catch { /* non-critical */ }

    // 2. 브랜치 목록 조회
    const branches = await provider.listBranches(owner, repo);
    const branchNames = branches.map(b => b.name);
    const targetBranches = branchNames.length > 0 ? branchNames : [branch];

    // 3. 최근 6개월 커밋 수집
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sinceDate = sixMonthsAgo.toISOString();

    const seenShas = new Set<string>();
    const allCommits: CacheCommit[] = [];

    for (const br of targetBranches) {
      let page = 1;
      while (true) {
        const commits = await provider.listCommits(owner, repo, {
          branch: br,
          since: sinceDate,
          perPage: 100,
          page,
        });
        if (commits.length === 0) break;

        // 상세 정보(additions/deletions/filesChanged) 병렬 조회
        const detailed = await pMap(
          commits.filter(c => !seenShas.has(c.sha)),
          (c) => provider.getCommitDetail(owner, repo, c.sha),
          detailConcurrency
        );

        for (const c of detailed) {
          if (seenShas.has(c.sha)) continue;
          seenShas.add(c.sha);
          allCommits.push({
            sha: c.sha,
            repositoryId: repoId,
            branch: br,
            author: c.author,
            message: c.message,
            committedDate: c.date.slice(0, 10),
            committedAt: c.date,
            additions: c.additions,
            deletions: c.deletions,
            filesChanged: c.filesChanged,
          });
        }

        if (commits.length < 100) break;
        page++;
      }
    }

    // 4. commit_cache에 일괄 저장
    if (allCommits.length > 0) {
      const inserted = insertCommitCache(db, allCommits);
      console.log(`[Repos] ${owner}/${repo}: cached ${inserted} commits via API`);
    }

    updateSyncStatus(db, repoId, "ready");
  } catch (err) {
    console.error(`[Repos] ${owner}/${repo}: initial sync failed -`, err);
    updateSyncStatus(db, repoId, "error");
  }
}

async function registerSingleRepo(
  db: ReturnType<typeof getDb>,
  userId: string,
  token: string,
  cloneUrl: string,
  branch: string,
  credentialId: number,
  meta: GitProviderMeta
): Promise<{ success: boolean; error?: string; cloneUrl: string }> {
  let parsed;
  try {
    parsed = parseGitUrl(cloneUrl);
  } catch {
    return { success: false, error: "Invalid Git URL", cloneUrl };
  }

  try {
    const repoRow = db.transaction(() => {
      insertRepositoryForUser(db, {
        userId,
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        cloneUrl,
        credentialId,
      });
      return db.prepare(
        "SELECT id FROM repositories WHERE user_id = ? AND clone_url = ?"
      ).get(userId, cloneUrl) as any;
    })();

    // 백그라운드 초기 동기화
    initialSync(db, repoRow.id, parsed.owner, parsed.repo, branch, meta, token).catch(console.error);

    return { success: true, cloneUrl };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg, cloneUrl };
  }
}
```

- [ ] **Step 2: GET, POST 핸들러 수정**

GET은 변경 없음. POST에서 credential metadata를 GitProviderMeta로 파싱하여 전달:

```typescript
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const userId = session.user.id;
  const db = getDb();

  const credentialId = body.credentialId ? Number(body.credentialId) : undefined;

  let gitCred: any;
  if (credentialId) {
    gitCred = getCredentialById(db, credentialId);
    if (!gitCred || gitCred.user_id !== userId) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
  } else {
    gitCred = getCredentialByUserAndProvider(db, userId, "git");
  }

  if (!gitCred) {
    return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
  }
  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata ? JSON.parse(gitCred.metadata) : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

  if (Array.isArray(body.repositories)) {
    const results = [];
    for (const item of body.repositories) {
      const result = await registerSingleRepo(db, userId, token, item.cloneUrl, item.branch || "main", credentialId ?? gitCred.id, meta);
      results.push(result);
    }
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    return NextResponse.json({
      message: `${succeeded}개 저장소 등록됨${failed.length > 0 ? `, ${failed.length}개 실패` : ""}`,
      results,
    }, { status: 201 });
  }

  const { cloneUrl, branch = "main" } = body;
  if (!cloneUrl) {
    return NextResponse.json({ error: "cloneUrl is required" }, { status: 400 });
  }

  const result = await registerSingleRepo(db, userId, token, cloneUrl, branch, credentialId ?? gitCred.id, meta);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ message: "Repository registered. Syncing in progress." }, { status: 201 });
}
```

- [ ] **Step 3: PATCH 핸들러 — updateCloneStatus import 제거**

기존 PATCH는 `updateCloneStatus`를 사용하지 않으므로 import에서 제거만 하면 됨. 나머지 로직은 동일.

- [ ] **Step 4: DELETE 핸들러 — clone 디렉토리 삭제 로직 제거**

```typescript
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  const repo = getRepositoryByIdAndUser(db, Number(id), userId);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const deleted = deleteRepositoryForUser(db, Number(id), userId);
  if (!deleted) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ message: "Deleted" });
}
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/repos/route.ts
git commit -m "refactor: 저장소 등록/삭제에서 clone 제거, API 기반 초기 동기화로 교체"
```

---

### Task 11: 수동 동기화 API 재작성

**Files:**
- Modify: `src/app/api/repos/[id]/sync/route.ts`

- [ ] **Step 1: API 기반 동기화로 전체 재작성**

```typescript
// src/app/api/repos/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getRepositoryByIdAndUser, updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage, updateSyncStatus,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialById, getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createGitProvider } from "@/infra/git-provider";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord, GitProviderMeta } from "@/core/types";

const detailConcurrency = 5;

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    if (repo.sync_status !== "ready" && repo.sync_status !== "error") {
      return NextResponse.json({ error: "Repository is still syncing" }, { status: 400 });
    }

    const gitCred = repo.credential_id
      ? getCredentialById(db, repo.credential_id)
      : getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });

    const token = decrypt(gitCred.credential);
    const meta: GitProviderMeta = gitCred.metadata
      ? JSON.parse(gitCred.metadata)
      : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

    const provider = createGitProvider(meta, token);

    // 1. 언어 정보 갱신
    try {
      const language = await provider.getRepoLanguage(repo.owner, repo.repo);
      updatePrimaryLanguage(db, repo.id, language);
    } catch { /* non-critical */ }

    // 2. 증분 커밋 조회
    const latestDate = getLatestCacheDate(db, repo.id);
    const sinceDate = latestDate
      ? new Date(new Date(latestDate).getTime() - 86400000).toISOString() // 1일 전 여유
      : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

    const branches = await provider.listBranches(repo.owner, repo.repo);
    const branchNames = branches.map(b => b.name);
    const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

    const seenShas = new Set<string>();
    const newCacheCommits: CacheCommit[] = [];
    const newCommitRecords: CommitRecord[] = [];

    for (const br of targetBranches) {
      let page = 1;
      while (true) {
        const commits = await provider.listCommits(repo.owner, repo.repo, {
          branch: br,
          since: sinceDate,
          perPage: 100,
          page,
        });
        if (commits.length === 0) break;

        const newCommits = commits.filter(c => !seenShas.has(c.sha));
        const detailed = await pMap(
          newCommits,
          (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
          detailConcurrency
        );

        for (const c of detailed) {
          if (seenShas.has(c.sha)) continue;
          seenShas.add(c.sha);
          newCacheCommits.push({
            sha: c.sha,
            repositoryId: repo.id,
            branch: br,
            author: c.author,
            message: c.message,
            committedDate: c.date.slice(0, 10),
            committedAt: c.date,
            additions: c.additions,
            deletions: c.deletions,
            filesChanged: c.filesChanged,
          });
          newCommitRecords.push({
            sha: c.sha,
            message: c.message,
            author: c.author,
            date: c.date,
            repoOwner: repo.owner,
            repoName: repo.repo,
            branch: br,
            filesChanged: c.filesChanged,
            additions: c.additions,
            deletions: c.deletions,
          });
        }

        if (commits.length < 100) break;
        page++;
      }
    }

    // 3. 캐시 저장
    if (newCacheCommits.length > 0) {
      insertCommitCache(db, newCacheCommits);
    }

    if (newCommitRecords.length === 0) {
      insertSyncLogForUser(db, {
        repositoryId: repo.id, userId: session.user.id,
        status: "success", commitsProcessed: 0, tasksCreated: 0, errorMessage: null,
      });
      return NextResponse.json({ message: "No new commits", commitsProcessed: 0, tasksCreated: 0 });
    }

    // 4. 모호한 커밋 보강
    const enrichedCommits: CommitRecord[] = [];
    for (const commit of newCommitRecords) {
      if (isAmbiguousCommitMessage(commit.message)) {
        try {
          const diff = await provider.getCommitDiff(repo.owner, repo.repo, commit.sha);
          const summary = await analyzeCommitWithDiff(commit, diff);
          enrichedCommits.push({ ...commit, message: summary });
        } catch {
          enrichedCommits.push(commit);
        }
      } else {
        enrichedCommits.push(commit);
      }
    }

    // 5. 그룹핑 + Gemini 분석
    const groups = groupCommitsByDateAndProject(enrichedCommits);
    let tasksCreated = 0;
    for (const group of groups) {
      const tasks = await analyzeCommits(group.commits, group.project, group.date);
      tasksCreated += tasks.length;
    }

    // 6. SHA 업데이트 + 로그
    updateLastSyncedSha(db, repo.id, newCommitRecords[0].sha);
    insertSyncLogForUser(db, {
      repositoryId: repo.id, userId: session.user.id,
      status: "success", commitsProcessed: newCommitRecords.length, tasksCreated, errorMessage: null,
    });

    return NextResponse.json({ message: "Sync complete", commitsProcessed: newCommitRecords.length, tasksCreated });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    insertSyncLogForUser(db, {
      repositoryId: Number(id), userId: session.user.id,
      status: "error", commitsProcessed: 0, tasksCreated: 0, errorMessage: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/repos/[id]/sync/route.ts
git commit -m "refactor: 수동 동기화 API를 프로바이더 API 기반으로 재작성"
```

---

### Task 12: commits/branches API 라우트 재작성

**Files:**
- Modify: `src/app/api/repos/[id]/commits/route.ts`
- Modify: `src/app/api/repos/[id]/branches/route.ts`

- [ ] **Step 1: commits 라우트 — commit_cache 조회로 교체**

```typescript
// src/app/api/repos/[id]/commits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser, getCommitsByDateRange, type CacheCommit } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);

  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

    // commit_cache에서 최근 커밋 조회 (날짜 범위를 넓게 잡아 limit만큼)
    const rows = db.prepare(
      `SELECT sha, repository_id, branch, author, message, committed_date, committed_at, additions, deletions, files_changed
       FROM commit_cache WHERE repository_id = ?
       ORDER BY committed_at DESC LIMIT ?`
    ).all(repo.id, limit) as any[];

    const commits = rows.map((r: any) => ({
      sha: r.sha,
      message: r.message,
      author: r.author,
      date: r.committed_at,
      repoOwner: repo.owner,
      repoName: repo.repo,
      branch: r.branch,
      filesChanged: r.files_changed ? JSON.parse(r.files_changed) : [],
      additions: r.additions ?? 0,
      deletions: r.deletions ?? 0,
    }));

    return NextResponse.json(commits);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: branches 라우트 — 프로바이더 API 호출로 교체**

```typescript
// src/app/api/repos/[id]/branches/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { getCredentialById, getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createGitProvider } from "@/infra/git-provider";
import type { GitProviderMeta } from "@/core/types";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

    const gitCred = repo.credential_id
      ? getCredentialById(db, repo.credential_id)
      : getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });

    const token = decrypt(gitCred.credential);
    const meta: GitProviderMeta = gitCred.metadata
      ? JSON.parse(gitCred.metadata)
      : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

    const provider = createGitProvider(meta, token);
    const branches = await provider.listBranches(repo.owner, repo.repo);

    return NextResponse.json(branches.map(b => b.name));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/repos/[id]/commits/route.ts src/app/api/repos/[id]/branches/route.ts
git commit -m "refactor: commits/branches API를 commit_cache/프로바이더 API로 교체"
```

---

### Task 13: polling-manager 재작성

**Files:**
- Modify: `src/scheduler/polling-manager.ts`

- [ ] **Step 1: API 기반 동기화로 전체 재작성**

```typescript
// src/scheduler/polling-manager.ts
import cron, { type ScheduledTask } from "node-cron";
import {
  getActiveUsersWithRepos, getRepositoriesByUser,
  updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { createGitProvider } from "@/infra/git-provider";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { decrypt } from "@/infra/crypto/token-encryption";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord, GitProviderMeta } from "@/core/types";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;
let syncStartedAt: string | null = null;

const repoSyncConcurrency = 3;
const detailConcurrency = 5;

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

async function pMapFulfilled<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}

export function getSchedulerStatus() {
  return { isRunning, lastRunAt, syncStartedAt, scheduled: cronTask !== null, intervalMin: 15 };
}

async function syncOneRepo(database: ReturnType<typeof getDb>, userId: string, repo: any): Promise<void> {
  const gitCred = repo.credential_id
    ? getCredentialById(database, repo.credential_id)
    : getCredentialByUserAndProvider(database, userId, "git");
  if (!gitCred) throw new Error("Git credential not found for sync");

  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata
    ? JSON.parse(gitCred.metadata)
    : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

  const provider = createGitProvider(meta, token);

  // 언어 갱신
  try {
    const language = await provider.getRepoLanguage(repo.owner, repo.repo);
    updatePrimaryLanguage(database, repo.id, language);
  } catch { /* non-critical */ }

  // 증분 동기화
  const latestDate = getLatestCacheDate(database, repo.id);
  const sinceDate = latestDate
    ? new Date(new Date(latestDate).getTime() - 86400000).toISOString()
    : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

  const branches = await provider.listBranches(repo.owner, repo.repo);
  const branchNames = branches.map(b => b.name);
  const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

  const seenShas = new Set<string>();
  const newCacheCommits: CacheCommit[] = [];
  const newCommitRecords: CommitRecord[] = [];

  for (const br of targetBranches) {
    let page = 1;
    while (true) {
      const commits = await provider.listCommits(repo.owner, repo.repo, {
        branch: br, since: sinceDate, perPage: 100, page,
      });
      if (commits.length === 0) break;

      const newCommits = commits.filter(c => !seenShas.has(c.sha));
      const detailed = await pMapFulfilled(
        newCommits,
        (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
        detailConcurrency
      );

      for (const c of detailed) {
        if (seenShas.has(c.sha)) continue;
        seenShas.add(c.sha);
        newCacheCommits.push({
          sha: c.sha, repositoryId: repo.id, branch: br,
          author: c.author, message: c.message,
          committedDate: c.date.slice(0, 10), committedAt: c.date,
          additions: c.additions, deletions: c.deletions, filesChanged: c.filesChanged,
        });
        newCommitRecords.push({
          sha: c.sha, message: c.message, author: c.author, date: c.date,
          repoOwner: repo.owner, repoName: repo.repo, branch: br,
          filesChanged: c.filesChanged, additions: c.additions, deletions: c.deletions,
        });
      }

      if (commits.length < 100) break;
      page++;
    }
  }

  // 캐시 저장
  if (newCacheCommits.length > 0) {
    const inserted = insertCommitCache(database, newCacheCommits);
    if (inserted > 0) console.log(`[Scheduler] ${repo.owner}/${repo.repo}: cached ${inserted} new commits`);
  }

  if (newCommitRecords.length === 0) {
    console.log(`[Scheduler] ${repo.owner}/${repo.repo}: no new commits`);
    insertSyncLogForUser(database, {
      repositoryId: repo.id, userId, status: "success",
      commitsProcessed: 0, tasksCreated: 0, errorMessage: null,
    });
    return;
  }

  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: found ${newCommitRecords.length} new commits`);

  // 모호한 커밋 보강
  const enrichedCommits: CommitRecord[] = [];
  for (const commit of newCommitRecords) {
    if (isAmbiguousCommitMessage(commit.message)) {
      try {
        const diff = await provider.getCommitDiff(repo.owner, repo.repo, commit.sha);
        const summary = await analyzeCommitWithDiff(commit, diff);
        enrichedCommits.push({ ...commit, message: summary });
      } catch {
        enrichedCommits.push(commit);
      }
    } else {
      enrichedCommits.push(commit);
    }
  }

  // 그룹핑 + Gemini 분석
  const groups = groupCommitsByDateAndProject(enrichedCommits);
  let tasksCreated = 0;
  for (const group of groups) {
    const tasks = await analyzeCommits(group.commits, group.project, group.date);
    tasksCreated += tasks.length;
  }

  updateLastSyncedSha(database, repo.id, newCommitRecords[0].sha);
  insertSyncLogForUser(database, {
    repositoryId: repo.id, userId, status: "success",
    commitsProcessed: newCommitRecords.length, tasksCreated, errorMessage: null,
  });
  console.log(`[Scheduler] ${repo.owner}/${repo.repo}: synced ${newCommitRecords.length} commits, created ${tasksCreated} tasks`);
}

export async function runSyncCycle(): Promise<void> {
  if (isRunning) { console.log("[Scheduler] Sync already in progress, skipping"); return; }
  isRunning = true;
  syncStartedAt = new Date().toISOString();
  const database = getDb();

  try {
    const userIds = getActiveUsersWithRepos(database);
    for (const userId of userIds) {
      try {
        const repos = getRepositoriesByUser(database, userId).filter((r: any) => r.sync_status === "ready");
        const results = await pMap(repos, (repo: any) => syncOneRepo(database, userId, repo), repoSyncConcurrency);
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === "rejected") {
            const repo = repos[i];
            const errorMsg = (results[i] as PromiseRejectedResult).reason?.message ?? String((results[i] as PromiseRejectedResult).reason);
            insertSyncLogForUser(database, {
              repositoryId: repo.id, userId, status: "error",
              commitsProcessed: 0, tasksCreated: 0, errorMessage: errorMsg,
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
  if (cronTask) { console.log("[Scheduler] Already running"); return; }
  runSyncCycle().catch(console.error);
  cronTask = cron.schedule(`*/${intervalMin} * * * *`, () => { runSyncCycle().catch(console.error); });
  console.log(`[Scheduler] Started with ${intervalMin}min interval`);
}

export function stopScheduler(): void {
  if (cronTask) { cronTask.stop(); cronTask = null; console.log("[Scheduler] Stopped"); }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/scheduler/polling-manager.ts
git commit -m "refactor: polling-manager를 프로바이더 API 기반 동기화로 재작성"
```

---

### Task 14: report-generator 및 보고서 생성 라우트 수정

commit_cache에서 직접 조회하도록 변경한다. git-client 의존 제거.

**Files:**
- Modify: `src/scheduler/report-generator.ts`
- Modify: `src/app/api/reports/generate/route.ts`
- Modify: `src/scheduler/report-scheduler.ts`

- [ ] **Step 1: report-generator의 collectCommitsForDate를 commit_cache 기반으로 교체**

```typescript
// src/scheduler/report-generator.ts
import { GoogleGenAI } from "@google/genai";
import { getDb } from "@/infra/db/connection";
import type { CacheCommit } from "@/infra/db/repository";

export interface CommitEntry {
  branch: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
  commitDate?: string;
}

export function collectCommitsForDateFromCache(
  repositoryId: number,
  date: string,
  authors?: string[]
): CommitEntry[] {
  const db = getDb();

  let sql = `SELECT sha, branch, author, message, committed_at, committed_date, additions, deletions, files_changed
    FROM commit_cache WHERE repository_id = ? AND committed_date = ?`;
  const params: (string | number)[] = [repositoryId, date];

  if (authors && authors.length > 0) {
    const authorClauses = authors.map(() => "author LIKE ?").join(" OR ");
    sql += ` AND (${authorClauses})`;
    params.push(...authors.map(a => `%${a}%`));
  }

  sql += " ORDER BY committed_at ASC";

  const rows = db.prepare(sql).all(...params) as any[];
  const seenShas = new Set<string>();

  return rows
    .filter(r => {
      if (seenShas.has(r.sha)) return false;
      seenShas.add(r.sha);
      return true;
    })
    .map(r => ({
      branch: r.branch,
      sha: r.sha,
      message: r.message,
      author: r.author,
      date: r.committed_at,
      filesChanged: r.files_changed ? JSON.parse(r.files_changed) : [],
      additions: r.additions ?? 0,
      deletions: r.deletions ?? 0,
      commitDate: r.committed_date,
    }));
}

// buildPrompt, parseGeneratedReport — 변경 없이 유지

// generateReportContent — clone_path 제거, DB 기반으로 교체
export async function generateReportContent(
  repo: { id: number; owner: string; repo: string; label: string | null; git_author: string | null },
  date: string
): Promise<{ title: string; content: string; commitCount: number } | null> {
  const authors = repo.git_author
    ? repo.git_author.split(",").map((a) => a.trim()).filter(Boolean)
    : undefined;

  const commits = collectCommitsForDateFromCache(repo.id, date, authors);
  if (commits.length === 0) return null;

  const displayName = repo.label || `${repo.owner}/${repo.repo}`;
  const prompt = buildPrompt(repo.owner, repo.repo, repo.label, date, commits, false);

  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const result = await genai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
  });

  const parsed = parseGeneratedReport(result.text ?? "", displayName);
  return { title: parsed.title, content: parsed.content, commitCount: commits.length };
}
```

`buildPrompt`과 `parseGeneratedReport` 함수는 변경 없이 그대로 유지. 이전에 `getDetailedCommitsForDate`, `getBranches` import만 제거.

- [ ] **Step 2: report-scheduler.ts — getAutoReportEnabledRepos 반환값 변경 반영**

`repo.clone_path`를 참조하지 않고 `repo.id`를 `generateReportContent`에 전달하도록 수정. 기존 코드에서 `generateReportContent(repo, date)` 호출 시 repo 객체에 `clone_path`가 있었으나, 새 시그니처는 `id`를 사용. `getAutoReportEnabledRepos`의 WHERE 조건을 `sync_status = 'ready'`로 이미 Task 3에서 변경했으므로, 여기서는 함수 호출부만 확인.

변경 없음 — `generateReportContent`의 새 시그니처가 `repo.id`를 포함하는 객체를 받으므로, `getAutoReportEnabledRepos(db)` 결과의 row에 `id`가 있어 호환됨.

- [ ] **Step 3: reports/generate/route.ts — clone_path 의존 제거**

```typescript
// src/app/api/reports/generate/route.ts
// import 변경: collectCommitsForDate → collectCommitsForDateFromCache
import {
  CommitEntry,
  collectCommitsForDateFromCache,
  buildPrompt,
  parseGeneratedReport,
} from "@/scheduler/report-generator";

// repo.clone_path 체크 제거
// collectCommitsForDate(repo.clone_path, repo.clone_url, d, authors)
// → collectCommitsForDateFromCache(repo.id, d, authors)
```

전체 POST 핸들러에서:
1. `if (!repo.clone_path) return ...` 행 제거
2. `collectCommitsForDate(repo.clone_path!, repo.clone_url, d, authors)` → `collectCommitsForDateFromCache(repo.id, d, authors)` 로 모두 교체 (4곳: 비동기 range, 비동기 single, 동기 range, 동기 single)
3. `collectCommitsForDate(repo.clone_path, repo.clone_url, date!, syncAuthors)` → `collectCommitsForDateFromCache(repo.id, date!, syncAuthors)` 로 교체

- [ ] **Step 4: 커밋**

```bash
git add src/scheduler/report-generator.ts src/scheduler/report-scheduler.ts src/app/api/reports/generate/route.ts
git commit -m "refactor: 보고서 생성을 commit_cache DB 조회 기반으로 전환"
```

---

### Task 15: HRMS 스케줄러 — commit_cache 확장 필드 활용

**Files:**
- Modify: `src/scheduler/hrms-scheduler.ts`

- [ ] **Step 1: cacheCommits에서 additions/deletions/filesChanged 활용**

`executeRegistration` 함수에서 `getCommitsByDateRange` 결과를 CommitRecord로 변환할 때, 기존에 `filesChanged: []`, `additions: 0`, `deletions: 0`으로 하드코딩했던 부분을 cache 데이터로 교체:

```typescript
// 변경 전:
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

// 변경 후:
entry.commits.push({
  sha: c.sha,
  message: c.message,
  author: c.author,
  date: c.committedAt,
  repoOwner: "",
  repoName: "",
  branch: c.branch,
  filesChanged: c.filesChanged,
  additions: c.additions,
  deletions: c.deletions,
});
```

주의: `getCommitsByDateRange`의 반환 타입이 `CacheCommit`이므로, 필드명은 camelCase (`committedAt`, `filesChanged` 등).

- [ ] **Step 2: 커밋**

```bash
git add src/scheduler/hrms-scheduler.ts
git commit -m "fix: HRMS 스케줄러에서 commit_cache의 additions/deletions/filesChanged 활용"
```

---

### Task 16: 프론트엔드 — clone_status → sync_status 전환

**Files:**
- Modify: `src/app/(dashboard)/repos/page.tsx`

- [ ] **Step 1: clone_status 참조를 sync_status로 교체**

4곳 변경:

```typescript
// 1. 폴링 조건 (176행 부근)
// 변경 전:
const hasPending = repos.some((r: any) => r.clone_status && r.clone_status !== "ready" && r.clone_status !== "error");
// 변경 후:
const hasPending = repos.some((r: any) => r.sync_status && r.sync_status !== "ready" && r.sync_status !== "error");

// 2~4. 상태 뱃지 (484~492행 부근)
// 변경 전:
{repo.clone_status === "ready" ? (
  <Badge variant="outline" className="text-[10px] px-1.5 py-0">준비됨</Badge>
) : repo.clone_status === "error" ? (
  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">오류</Badge>
) : repo.clone_status === "caching" ? (
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 animate-pulse">커밋 캐싱 중...</Badge>
) : (
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 animate-pulse">클론 중...</Badge>
)}

// 변경 후:
{repo.sync_status === "ready" ? (
  <Badge variant="outline" className="text-[10px] px-1.5 py-0">준비됨</Badge>
) : repo.sync_status === "error" ? (
  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">오류</Badge>
) : (
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 animate-pulse">동기화 중...</Badge>
)}

// 5. 동기화 버튼 disabled 조건 (548행 부근)
// 변경 전:
disabled={syncing === repo.id || repo.clone_status !== "ready"}
// 변경 후:
disabled={syncing === repo.id || repo.sync_status !== "ready"}
```

- [ ] **Step 2: 커밋**

```bash
git add "src/app/(dashboard)/repos/page.tsx"
git commit -m "refactor: 프론트엔드 clone_status → sync_status 전환"
```

---

### Task 17: 이전 파일 삭제 및 정리

**Files:**
- Delete: `src/infra/git/git-client.ts`
- Delete: `src/infra/github/github-client.ts`
- Delete: `src/__tests__/infra/github-client.test.ts`
- Modify: `src/infra/git/parse-git-url.ts` — `buildAuthEnv` 삭제

- [ ] **Step 1: git-client.ts 삭제**

```bash
git rm src/infra/git/git-client.ts
```

- [ ] **Step 2: github-client.ts 삭제**

```bash
git rm src/infra/github/github-client.ts
```

- [ ] **Step 3: github-client 테스트 삭제**

```bash
git rm src/__tests__/infra/github-client.test.ts
```

- [ ] **Step 4: parse-git-url.ts에서 buildAuthEnv 삭제**

`buildAuthEnv` 함수와 JSDoc 주석을 삭제. `parseGitUrl` 함수만 유지.

```typescript
// 삭제할 코드:
/**
 * git 명령에 전달할 인증용 환경변수를 반환한다. ...
 */
export function buildAuthEnv(token: string): Record<string, string> {
  const encoded = Buffer.from(`oauth2:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  };
}
```

- [ ] **Step 5: 전체 빌드 확인**

```bash
npx tsc --noEmit
```

git-client나 github-client를 참조하는 import가 남아있으면 TypeScript 에러로 잡힌다. 이 시점에서 모든 참조가 이전 태스크에서 제거되었어야 한다.

- [ ] **Step 6: 전체 테스트 실행**

```bash
npx vitest run
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: git-client, github-client 삭제 및 buildAuthEnv 정리"
```

---

### Task 18: DB 초기화 및 E2E 검증

실 배포 전이므로 기존 DB를 삭제하고 재생성한다.

**Files:**
- 없음 (운영 작업)

- [ ] **Step 1: 기존 DB 및 클론 데이터 삭제**

```bash
rm -f data/tracker.db
rm -rf data/repos/
```

- [ ] **Step 2: 서버 시작 및 DB 재생성 확인**

```bash
npm run dev
```

서버 시작 시 `createTables()`가 실행되어 새 스키마로 DB가 생성된다.

- [ ] **Step 3: E2E 수동 테스트**

1. 설정 > Git 자격증명 등록
2. 저장소 추가 (저장소 관리 페이지)
3. sync_status가 "동기화 중..." → "준비됨"으로 변경되는지 확인
4. 태스크 캘린더에서 커밋 데이터 표시 확인
5. 보고서 생성 동작 확인
6. HRMS 업무 등록 동작 확인

- [ ] **Step 4: 커밋 (테스트 통과 확인 후)**

```bash
git add -A
git commit -m "chore: DB 초기화 및 E2E 검증 완료"
```
