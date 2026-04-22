import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTables } from "@/infra/db/schema";
import {
  insertCommitCache,
  getLatestCacheDate,
  getCommitCountsByDateRange,
  getCommitsByDateRange,
  getCommitsByDate,
  type CacheCommit,
} from "@/infra/db/repository";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  createTables(db);
  return db;
}

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

describe("commit_cache CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (1, 'owner', 'repo', 'main', 'user1', 'https://github.com/owner/repo.git')"
    ).run();
    db.prepare(
      "INSERT INTO repositories (id, owner, repo, branch, user_id, clone_url) VALUES (2, 'owner', 'repo2', 'main', 'user1', 'https://github.com/owner/repo2.git')"
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it("INSERT OR IGNORE로 동일 (repo, sha) 중복을 무시한다", () => {
    const commit = makeCommit();
    const inserted1 = insertCommitCache(db, [commit]);
    expect(inserted1).toBe(1);
    const inserted2 = insertCommitCache(db, [commit]);
    expect(inserted2).toBe(0);
    const count = (db.prepare("SELECT COUNT(*) as c FROM commit_cache").get() as any).c;
    expect(count).toBe(1);
  });

  it("같은 SHA라도 repository_id가 다르면 각각 저장된다", () => {
    const sha = "abc123def456abc123def456abc123def456abc1";
    const inserted = insertCommitCache(db, [
      makeCommit({ sha, repositoryId: 1 }),
      makeCommit({ sha, repositoryId: 2 }),
    ]);
    expect(inserted).toBe(2);
    const count = (db.prepare("SELECT COUNT(*) as c FROM commit_cache").get() as any).c;
    expect(count).toBe(2);
  });

  it("벌크 INSERT가 트랜잭션으로 동작한다", () => {
    const commits = [
      makeCommit({ sha: "aaa1".padEnd(40, "0") }),
      makeCommit({ sha: "bbb2".padEnd(40, "0") }),
      makeCommit({ sha: "ccc3".padEnd(40, "0") }),
    ];
    const inserted = insertCommitCache(db, commits);
    expect(inserted).toBe(3);
  });

  it("getLatestCacheDate가 가장 최근 날짜를 반환한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), committedDate: "2026-04-08" }),
      makeCommit({ sha: "b".padEnd(40, "0"), committedDate: "2026-04-10" }),
      makeCommit({ sha: "c".padEnd(40, "0"), committedDate: "2026-04-09" }),
    ]);
    expect(getLatestCacheDate(db, 1)).toBe("2026-04-10");
  });

  it("getLatestCacheDate가 캐시 없으면 null을 반환한다", () => {
    expect(getLatestCacheDate(db, 1)).toBeNull();
  });

  it("getCommitCountsByDateRange가 날짜별 개수를 반환한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), committedDate: "2026-04-08" }),
      makeCommit({ sha: "b".padEnd(40, "0"), committedDate: "2026-04-08" }),
      makeCommit({ sha: "c".padEnd(40, "0"), committedDate: "2026-04-10" }),
    ]);
    const counts = getCommitCountsByDateRange(db, [1], "2026-04-01", "2026-04-30");
    expect(counts).toEqual({ "2026-04-08": 2, "2026-04-10": 1 });
  });

  it("getCommitCountsByDateRange가 author 필터를 적용한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), author: "Alice" }),
      makeCommit({ sha: "b".padEnd(40, "0"), author: "Bob" }),
    ]);
    const counts = getCommitCountsByDateRange(db, [1], "2026-04-01", "2026-04-30", ["Alice"]);
    expect(counts).toEqual({ "2026-04-10": 1 });
  });

  it("getCommitCountsByDateRange가 여러 저장소를 합산한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: 1, committedDate: "2026-04-10" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: 2, committedDate: "2026-04-10" }),
    ]);
    const counts = getCommitCountsByDateRange(db, [1, 2], "2026-04-01", "2026-04-30");
    expect(counts).toEqual({ "2026-04-10": 2 });
  });

  it("getCommitsByDateRange가 범위 내 커밋을 시간 역순으로 반환한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), committedDate: "2026-04-08", committedAt: "2026-04-08T10:00:00+09:00" }),
      makeCommit({ sha: "b".padEnd(40, "0"), committedDate: "2026-04-10", committedAt: "2026-04-10T15:00:00+09:00" }),
      makeCommit({ sha: "c".padEnd(40, "0"), committedDate: "2026-04-10", committedAt: "2026-04-10T09:00:00+09:00" }),
    ]);
    const commits = getCommitsByDateRange(db, [1], "2026-04-09", "2026-04-10");
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("b".padEnd(40, "0"));
    expect(commits[1].sha).toBe("c".padEnd(40, "0"));
  });

  it("getCommitsByDate가 단일 날짜 커밋을 반환한다", () => {
    insertCommitCache(db, [
      makeCommit({ sha: "a".padEnd(40, "0"), committedDate: "2026-04-10" }),
      makeCommit({ sha: "b".padEnd(40, "0"), committedDate: "2026-04-11" }),
    ]);
    const commits = getCommitsByDate(db, [1], "2026-04-10");
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("a".padEnd(40, "0"));
  });

  it("ON DELETE CASCADE로 저장소 삭제 시 캐시도 삭제된다", () => {
    insertCommitCache(db, [makeCommit()]);
    db.prepare("DELETE FROM repositories WHERE id = 1").run();
    const count = (db.prepare("SELECT COUNT(*) as c FROM commit_cache").get() as any).c;
    expect(count).toBe(0);
  });

  it("repoIds가 빈 배열이면 빈 결과를 반환한다", () => {
    expect(getCommitCountsByDateRange(db, [], "2026-04-01", "2026-04-30")).toEqual({});
    expect(getCommitsByDateRange(db, [], "2026-04-01", "2026-04-30")).toEqual([]);
    expect(getCommitsByDate(db, [], "2026-04-10")).toEqual([]);
  });
});
