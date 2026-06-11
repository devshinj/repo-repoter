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
