import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { sql } from "@/infra/db/connection";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);

  try {
    const repo = await getRepositoryByIdAndUser(Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

    const branch = searchParams.get("branch");

    let rows: any[];
    if (branch) {
      rows = await sql`
        SELECT sha, branch, author, message, committed_at, additions, deletions, files_changed
        FROM commit_cache WHERE repository_id = ${repo.id} AND branch = ${branch}
        ORDER BY committed_at DESC LIMIT ${limit}
      ` as any[];
    } else {
      rows = await sql`
        SELECT sha, branch, author, message, committed_at, additions, deletions, files_changed
        FROM commit_cache WHERE repository_id = ${repo.id}
        ORDER BY committed_at DESC LIMIT ${limit}
      ` as any[];
    }

    const commits = rows.map((r: any) => ({
      sha: r.sha,
      message: r.message,
      author: r.author,
      date: r.committed_at,
      repoOwner: repo.owner,
      repoName: repo.repo,
      branch: r.branch,
      filesChanged: r.files_changed ? (Array.isArray(r.files_changed) ? r.files_changed : JSON.parse(r.files_changed)) : [],
      additions: r.additions ?? 0,
      deletions: r.deletions ?? 0,
    }));

    return NextResponse.json(commits);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
