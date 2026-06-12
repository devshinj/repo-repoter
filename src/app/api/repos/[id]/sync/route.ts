// src/app/api/repos/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { syncOneRepo } from "@/scheduler/polling-manager";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  try {
    const result = await syncOneRepo(db, session.user.id, repo);
    if (result === null) {
      return NextResponse.json({ error: "이미 동기화 중입니다" }, { status: 409 });
    }
    return NextResponse.json({
      message: result.commitsProcessed === 0 ? "No new commits" : "Sync complete",
      commitsProcessed: result.commitsProcessed,
      tasksCreated: result.tasksCreated,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
