import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import { getRepositoriesByUser } from "@/infra/db/repository";
import { getBranches, getCommitsForDate } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}

function eachDateInRange(since: string, until: string): string[] {
  const dates: string[] = [];
  const current = new Date(since);
  const end = new Date(until);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const repoIdsParam = searchParams.get("repoIds");

  if (!since || !until) {
    return NextResponse.json({ error: "since and until query params are required (YYYY-MM-DD)" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  if (since > until) {
    return NextResponse.json({ error: "since must be before or equal to until" }, { status: 400 });
  }

  const db = getDb();
  try {
    let repos = getRepositoriesByUser(db, session.user.id);

    if (repoIdsParam) {
      const repoIdSet = new Set(repoIdsParam.split(",").map(Number));
      repos = repos.filter((r: any) => repoIdSet.has(r.id));
    }

    const dates = eachDateInRange(since, until);

    const result: Array<{
      date: string;
      repos: Array<{
        repoId: number;
        repoName: string;
        owner: string;
        branches: Array<{ branch: string; commits: Array<{ sha: string; message: string; author: string; date: string }> }>;
      }>;
    }> = [];

    for (const date of dates) {
      const dateRepos: Array<{
        repoId: number;
        repoName: string;
        owner: string;
        branches: Array<{ branch: string; commits: Array<{ sha: string; message: string; author: string; date: string }> }>;
      }> = [];

      for (const repo of repos) {
        if (!repo.clone_path) continue;

        try {
          const branches = await getBranches(repo.clone_path);
          const branchCommits = await getCommitsForDate(repo.clone_path, branches, date);

          if (branchCommits.length > 0) {
            dateRepos.push({
              repoId: repo.id,
              repoName: repo.repo,
              owner: repo.owner,
              branches: branchCommits,
            });
          }
        } catch {
          // 저장소 오류 시 무시
        }
      }

      if (dateRepos.length > 0) {
        result.push({ date, repos: dateRepos });
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
