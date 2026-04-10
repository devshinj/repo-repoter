import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables, migrateSchema } from "@/infra/db/schema";
import { getRepositoriesByUser, getCommitsByDate, type CacheCommit } from "@/infra/db/repository";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
  return db;
}

function groupByRepo(commits: CacheCommit[], repos: any[]) {
  const repoMap = new Map(repos.map((r: any) => [r.id, r]));

  const grouped = new Map<number, Map<string, CacheCommit[]>>();
  for (const c of commits) {
    if (!grouped.has(c.repositoryId)) grouped.set(c.repositoryId, new Map());
    const repoGroup = grouped.get(c.repositoryId)!;
    if (!repoGroup.has(c.branch)) repoGroup.set(c.branch, []);
    repoGroup.get(c.branch)!.push(c);
  }

  const result: any[] = [];
  for (const [repoId, branchEntries] of grouped) {
    const repo = repoMap.get(repoId);
    if (!repo) continue;
    const branches: any[] = [];
    for (const [branch, branchCommits] of branchEntries) {
      branches.push({
        branch,
        commits: branchCommits.map(c => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          date: c.committedAt,
        })),
      });
    }
    result.push({ repoId, repoName: repo.repo, owner: repo.owner, branches });
  }

  return result;
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

    const repoIds = repos.map((r: any) => r.id);
    if (repoIds.length === 0) return NextResponse.json([]);

    const allAuthors: string[] = [];
    for (const repo of repos) {
      if (repo.git_author) {
        allAuthors.push(...repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean));
      }
    }

    const commits = getCommitsByDate(
      db,
      repoIds,
      date,
      allAuthors.length > 0 ? allAuthors : undefined
    );

    return NextResponse.json(groupByRepo(commits, repos));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
