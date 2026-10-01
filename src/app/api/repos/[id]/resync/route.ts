// src/app/api/repos/[id]/resync/route.ts
// 전체 재동기화 — 최근 6개월 커밋을 처음부터 다시 조회해 캐시 누락분을 채운다 (백그라운드 실행)
import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByIdAndUser } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { backfillRepoCommits } from "@/scheduler/polling-manager";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const repo = await getRepositoryByIdAndUser(Number(id), session.user.id);
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  if (repo.sync_status === "syncing") {
    return NextResponse.json({ error: "이미 동기화 중입니다" }, { status: 409 });
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  backfillRepoCommits(session.user.id, repo, { since: sixMonthsAgo.toISOString() })
    .catch(() => { /* backfillRepoCommits가 sync_logs에 에러 기록 */ });

  return NextResponse.json({ message: "전체 재동기화를 시작했습니다" }, { status: 202 });
}
