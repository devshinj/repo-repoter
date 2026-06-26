import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSchedulerStatus } from "@/scheduler/polling-manager";
import { getLastSyncSummary } from "@/infra/db/repository";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = getSchedulerStatus();
  const summary = await getLastSyncSummary(session.user?.id ?? "");

  return NextResponse.json({
    ...status,
    lastRunAt: summary.lastSuccessAt ?? status.lastRunAt,
    syncSummary: summary,
  });
}
