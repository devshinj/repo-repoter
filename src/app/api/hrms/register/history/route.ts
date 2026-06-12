import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getUnifiedTaskLogs } from "@/infra/db/hrms";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const db = getDb();
  const logs = getUnifiedTaskLogs(db, session.user.id, limit);
  return NextResponse.json(logs);
}
