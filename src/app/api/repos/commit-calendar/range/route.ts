import { NextRequest, NextResponse } from "next/server";
import { getRepositoriesByUser, getCommitsByDateRange, type CacheCommit } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

function groupByDateAndRepo(commits: CacheCommit[], repos: any[]) {
  const repoMap = new Map(repos.map((r: any) => [r.id, r]));

  const grouped = new Map<string, Map<number, Map<string, CacheCommit[]>>>();
  for (const c of commits) {
    if (!grouped.has(c.committedDate)) grouped.set(c.committedDate, new Map());
    const dateMap = grouped.get(c.committedDate)!;
    if (!dateMap.has(c.repositoryId)) dateMap.set(c.repositoryId, new Map());
    const repoGroup = dateMap.get(c.repositoryId)!;
    if (!repoGroup.has(c.branch)) repoGroup.set(c.branch, []);
    repoGroup.get(c.branch)!.push(c);
  }

  const result: any[] = [];
  for (const [date, repoEntries] of grouped) {
    const dateRepos: any[] = [];
    for (const [repoId, branchEntries] of repoEntries) {
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
      dateRepos.push({ repoId, repoName: repo.repo, owner: repo.owner, label: repo.label || null, branches });
    }
    result.push({ date, repos: dateRepos });
  }

  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
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

    const repoIds = repos.map((r: any) => r.id);
    if (repoIds.length === 0) return NextResponse.json([]);

    const allAuthors: string[] = [];
    for (const repo of repos) {
      if (repo.git_author) {
        allAuthors.push(...repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean));
      }
    }

    const commits = getCommitsByDateRange(
      db,
      repoIds,
      since,
      until,
      allAuthors.length > 0 ? allAuthors : undefined
    );

    return NextResponse.json(groupByDateAndRepo(commits, repos));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
