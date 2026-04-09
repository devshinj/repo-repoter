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

export async function GET(request: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const repoIdsParam = searchParams.get("repoIds");

  const db = getDb();
  try {
    let repos = getRepositoriesByUser(db, session.user.id);

    if (repoIdsParam) {
      const repoIdSet = new Set(repoIdsParam.split(",").map(Number));
      repos = repos.filter((r: any) => repoIdSet.has(r.id));
    }
    const result: {
      repoId: number;
      repoName: string;
      owner: string;
      branches: { branch: string; commits: { sha: string; message: string; author: string; date: string }[] }[];
    }[] = [];

    for (const repo of repos) {
      if (!repo.clone_path) continue;

      try {
        const branches = await getBranches(repo.clone_path);
        const branchCommits = await getCommitsForDate(repo.clone_path, branches, date);

        if (branchCommits.length > 0) {
          result.push({
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

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
