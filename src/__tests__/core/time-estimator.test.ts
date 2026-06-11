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
