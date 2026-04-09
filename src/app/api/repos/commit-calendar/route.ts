import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import { getRepositoriesByUser } from "@/infra/db/repository";
import { getBranches, getCommitCountsByDate } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") || undefined;
  const until = searchParams.get("until") || undefined;
  const repoIdsParam = searchParams.get("repoIds");

  const db = getDb();
  try {
    let repos = getRepositoriesByUser(db, session.user.id);

    if (repoIdsParam) {
      const repoIdSet = new Set(repoIdsParam.split(",").map(Number));
      repos = repos.filter((r: any) => repoIdSet.has(r.id));
    }
    const totalCounts: Record<string, number> = {};

    for (const repo of repos) {
      if (!repo.clone_path) continue;

      try {
        const branches = await getBranches(repo.clone_path);
        const counts = await getCommitCountsByDate(repo.clone_path, branches, since, until);

        for (const [date, count] of Object.entries(counts)) {
          totalCounts[date] = (totalCounts[date] || 0) + count;
        }
      } catch {
        // 저장소 오류 시 무시하고 계속
      }
    }

    return NextResponse.json(totalCounts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
