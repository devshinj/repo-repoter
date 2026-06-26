import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLogicraftTaskLogs } from "@/infra/db/logicraft";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);

  const logs = await getLogicraftTaskLogs(session.user.id, limit);
  return NextResponse.json(logs);
}
