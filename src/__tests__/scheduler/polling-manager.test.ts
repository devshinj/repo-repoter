import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiCommit, GitProviderClient, ListCommitsOptions } from "@/infra/git-provider/types";

const cachedShas = new Set<string>();

vi.mock("@/infra/db/repository", () => ({
  getCachedShas: vi.fn(async (_repoId: number, shas: string[]) => new Set(shas.filter((s) => cachedShas.has(s)))),
}));
vi.mock("@/infra/db/credential", () => ({}));
vi.mock("@/infra/crypto/token-encryption", () => ({}));

const { fetchUncachedCommits } = await import("@/scheduler/polling-manager");

function makeCommit(sha: string, date: string, statsLoaded = true): ApiCommit {
  return { sha, message: `msg ${sha}`, author: "dev", date, additions: 1, deletions: 0, filesChanged: [], statsLoaded };
}

/** 서버 페이지 상한(pageCap)을 흉내내는 가짜 프로바이더 — Gitea는 limit=100 요청에도 50건만 반환 */
function fakeProvider(branchCommits: Record<string, ApiCommit[]>, pageCap: number, overrides: Partial<GitProviderClient> = {}): GitProviderClient {
  return {
    listRepos: async () => [],
    listBranches: async () => Object.keys(branchCommits).map((name) => ({ name, isDefault: name === "main" })),
    listCommits: async (_o: string, _r: string, opts?: ListCommitsOptions) => {
      const size = Math.min(opts?.perPage ?? 100, pageCap);
      const page = opts?.page ?? 1;
      return branchCommits[opts!.branch!].slice((page - 1) * size, page * size);
    },
    getCommitDetail: async () => { throw new Error("not used"); },
    getCommitDiff: async () => "",
    getRepoLanguage: async () => null,
    ...overrides,
  };
}

const repo = { id: 1, owner: "infra_dev", repo: "klid-portal-web", branch: "main" };

describe("fetchUncachedCommits", () => {
  beforeEach(() => cachedShas.clear());

  it("서버가 페이지당 50건만 주더라도 마지막 페이지까지 모두 수집한다", async () => {
    const commits = Array.from({ length: 130 }, (_, i) => makeCommit(`sha${i}`, "2026-09-15T10:00:00+09:00"));
    const provider = fakeProvider({ main: commits }, 50);

    const { cacheCommits } = await fetchUncachedCommits(provider, repo, { since: "2026-09-01T00:00:00Z", maxCommits: 1000 });

    expect(cacheCommits).toHaveLength(130);
  });

  it("이미 캐시된 커밋은 제외한다", async () => {
    const commits = [makeCommit("a", "2026-09-15T10:00:00+09:00"), makeCommit("b", "2026-09-15T11:00:00+09:00")];
    cachedShas.add("a");

    const { cacheCommits } = await fetchUncachedCommits(fakeProvider({ main: commits }, 50), repo, { since: "x", maxCommits: 1000 });

    expect(cacheCommits.map((c) => c.sha)).toEqual(["b"]);
  });

  it("다른 브랜치에서 본 커밋은 중복 수집하지 않는다", async () => {
    const shared = [makeCommit("s1", "2026-09-15T10:00:00+09:00"), makeCommit("s2", "2026-09-14T10:00:00+09:00")];
    const provider = fakeProvider({ main: shared, feature: [makeCommit("f1", "2026-09-16T10:00:00+09:00"), ...shared] }, 50);

    const { cacheCommits } = await fetchUncachedCommits(provider, repo, { since: "x", maxCommits: 1000 });

    expect(cacheCommits.map((c) => c.sha).sort()).toEqual(["f1", "s1", "s2"]);
  });

  it("committedDate를 KST 기준으로 저장한다", async () => {
    const provider = fakeProvider({ main: [makeCommit("utc", "2026-09-14T16:30:00Z")] }, 50);

    const { cacheCommits } = await fetchUncachedCommits(provider, repo, { since: "x", maxCommits: 1000 });

    expect(cacheCommits[0].committedDate).toBe("2026-09-15");
  });

  it("상세 조회가 실패해도 커밋을 버리지 않고 목록 정보로 저장한다", async () => {
    const provider = fakeProvider({ main: [makeCommit("nodetail", "2026-09-15T10:00:00Z", false)] }, 100, {
      getCommitDetail: async () => { throw new Error("rate limited"); },
    });

    const { cacheCommits } = await fetchUncachedCommits(provider, repo, { since: "x", maxCommits: 1000 });

    expect(cacheCommits.map((c) => c.sha)).toEqual(["nodetail"]);
  });

  it("since/until을 프로바이더에 전달한다", async () => {
    const listCommits = vi.fn(async () => [] as ApiCommit[]);
    const provider = fakeProvider({ main: [] }, 50, { listCommits });

    await fetchUncachedCommits(provider, repo, { since: "S", until: "U", maxCommits: 1000 });

    expect(listCommits).toHaveBeenCalledWith("infra_dev", "klid-portal-web", expect.objectContaining({ since: "S", until: "U" }));
  });
});
