import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { initDb, sql, closeSql } from "@/infra/db/connection";
import {
  insertCommitCache,
  getLatestCacheDate,
  getCommitCountsByDateRange,
  getCommitsByDateRange,
  getCommitsByDate,
  type CacheCommit,
} from "@/infra/db/repository";

function makeCommit(overrides: Partial<CacheCommit> = {}): CacheCommit {
  return {
    sha: "abc123def456abc123def456abc123def456abc1",
    repositoryId: 0, // will be set by test via actual DB id
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

describe("commit_cache CRUD", () => {
  let repoId1: number;
  let repoId2: number;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`;
  });

  afterAll(async () => {
    await closeSql();
  });

  async function insertTestRepos(): Promise<{ repoId1: number; repoId2: number }> {
    const [r1] = await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner', 'repo', 'main', 'user1', 'https://github.com/owner/repo.git')
      RETURNING id
    ` as any[];
    const [r2] = await sql`
      INSERT INTO repositories (owner, repo, branch, user_id, clone_url)
      VALUES ('owner', 'repo2', 'main', 'user1', 'https://github.com/owner/repo2.git')
      RETURNING id
    ` as any[];
    return { repoId1: r1.id, repoId2: r2.id };
  }

  it("INSERT OR IGNORE로 동일 (repo, sha) 중복을 무시한다", async () => {
    const { repoId1 } = await insertTestRepos();
    const commit = makeCommit({ repositoryId: repoId1 });
    const inserted1 = await insertCommitCache([commit]);
    expect(inserted1).toBe(1);
    const inserted2 = await insertCommitCache([commit]);
    expect(inserted2).toBe(0);
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM commit_cache` as any[];
    expect(c).toBe(1);
  });

  it("같은 SHA라도 repository_id가 다르면 각각 저장된다", async () => {
    const { repoId1, repoId2 } = await insertTestRepos();
    const sha = "abc123def456abc123def456abc123def456abc1";
    const inserted = await insertCommitCache([
      makeCommit({ sha, repositoryId: repoId1 }),
      makeCommit({ sha, repositoryId: repoId2 }),
    ]);
    expect(inserted).toBe(2);
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM commit_cache` as any[];
    expect(c).toBe(2);
  });

  it("벌크 INSERT가 트랜잭션으로 동작한다", async () => {
    const { repoId1 } = await insertTestRepos();
    const commits = [
      makeCommit({ sha: "aaa1".padEnd(40, "0"), repositoryId: repoId1 }),
      makeCommit({ sha: "bbb2".padEnd(40, "0"), repositoryId: repoId1 }),
      makeCommit({ sha: "ccc3".padEnd(40, "0"), repositoryId: repoId1 }),
    ];
    const inserted = await insertCommitCache(commits);
    expect(inserted).toBe(3);
  });

  it("getLatestCacheDate가 가장 최근 날짜를 반환한다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-08" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10" }),
      makeCommit({ sha: "c".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-09" }),
    ]);
    expect(await getLatestCacheDate(repoId1)).toBe("2026-04-10");
  });

  it("getLatestCacheDate가 캐시 없으면 null을 반환한다", async () => {
    const { repoId1 } = await insertTestRepos();
    expect(await getLatestCacheDate(repoId1)).toBeNull();
  });

  it("getCommitCountsByDateRange가 날짜별 개수를 반환한다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-08" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-08" }),
      makeCommit({ sha: "c".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10" }),
    ]);
    const counts = await getCommitCountsByDateRange([repoId1], "2026-04-01", "2026-04-30");
    expect(counts).toEqual({ "2026-04-08": 2, "2026-04-10": 1 });
  });

  it("getCommitCountsByDateRange가 author 필터를 적용한다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, author: "Alice" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId1, author: "Bob" }),
    ]);
    const counts = await getCommitCountsByDateRange([repoId1], "2026-04-01", "2026-04-30", ["Alice"]);
    expect(counts).toEqual({ "2026-04-10": 1 });
  });

  it("getCommitCountsByDateRange가 여러 저장소를 합산한다", async () => {
    const { repoId1, repoId2 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId2, committedDate: "2026-04-10" }),
    ]);
    const counts = await getCommitCountsByDateRange([repoId1, repoId2], "2026-04-01", "2026-04-30");
    expect(counts).toEqual({ "2026-04-10": 2 });
  });

  it("getCommitsByDateRange가 범위 내 커밋을 시간 역순으로 반환한다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-08", committedAt: "2026-04-08T10:00:00+09:00" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10", committedAt: "2026-04-10T15:00:00+09:00" }),
      makeCommit({ sha: "c".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10", committedAt: "2026-04-10T09:00:00+09:00" }),
    ]);
    const commits = await getCommitsByDateRange([repoId1], "2026-04-09", "2026-04-10");
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("b".padEnd(40, "0"));
    expect(commits[1].sha).toBe("c".padEnd(40, "0"));
  });

  it("getCommitsByDate가 단일 날짜 커밋을 반환한다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([
      makeCommit({ sha: "a".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-10" }),
      makeCommit({ sha: "b".padEnd(40, "0"), repositoryId: repoId1, committedDate: "2026-04-11" }),
    ]);
    const commits = await getCommitsByDate([repoId1], "2026-04-10");
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("a".padEnd(40, "0"));
  });

  it("ON DELETE CASCADE로 저장소 삭제 시 캐시도 삭제된다", async () => {
    const { repoId1 } = await insertTestRepos();
    await insertCommitCache([makeCommit({ repositoryId: repoId1 })]);
    await sql`DELETE FROM repositories WHERE id = ${repoId1}`;
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM commit_cache` as any[];
    expect(c).toBe(0);
  });

  it("repoIds가 빈 배열이면 빈 결과를 반환한다", async () => {
    expect(await getCommitCountsByDateRange([], "2026-04-01", "2026-04-30")).toEqual({});
    expect(await getCommitsByDateRange([], "2026-04-01", "2026-04-30")).toEqual([]);
    expect(await getCommitsByDate([], "2026-04-10")).toEqual([]);
  });

  it("additions/deletions/filesChanged가 저장 및 조회된다", async () => {
    const { repoId1 } = await insertTestRepos();
    const commit = makeCommit({
      repositoryId: repoId1,
      additions: 50,
      deletions: 10,
      filesChanged: ["src/foo.ts", "src/bar.ts"],
    });
    await insertCommitCache([commit]);
    const commits = await getCommitsByDate([repoId1], "2026-04-10");
    expect(commits[0].additions).toBe(50);
    expect(commits[0].deletions).toBe(10);
    expect(commits[0].filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("filesChanged가 빈 배열이면 null로 저장되고 빈 배열로 반환된다", async () => {
    const { repoId1 } = await insertTestRepos();
    const commit = makeCommit({ repositoryId: repoId1, filesChanged: [] });
    await insertCommitCache([commit]);
    const commits = await getCommitsByDate([repoId1], "2026-04-10");
    expect(commits[0].filesChanged).toEqual([]);
  });
});
