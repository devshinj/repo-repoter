import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);

  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

    const rows = db.prepare(
      `SELECT sha, branch, author, message, committed_at, additions, deletions, files_changed
       FROM commit_cache WHERE repository_id = ?
       ORDER BY committed_at DESC LIMIT ?`
    ).all(repo.id, limit) as any[];

    const commits = rows.map((r: any) => ({
      sha: r.sha,
      message: r.message,
      author: r.author,
      date: r.committed_at,
      repoOwner: repo.owner,
      repoName: repo.repo,
      branch: r.branch,
      filesChanged: r.files_changed ? JSON.parse(r.files_changed) : [],
      additions: r.additions ?? 0,
      deletions: r.deletions ?? 0,
    }));

    return NextResponse.json(commits);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
