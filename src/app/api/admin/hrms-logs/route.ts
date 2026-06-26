import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getHrmsLogs, getHrmsLogStats, getAllUsersForFilter, getAllHrmsProjectsForFilter } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const [logs, stats, users, projects] = await Promise.all([
    getHrmsLogs({
      userId: searchParams.get("userId") || undefined,
      projectId: searchParams.get("projectId") || undefined,
      status: searchParams.get("status") || undefined,
      date: searchParams.get("date") || undefined,
      limit: Number(searchParams.get("limit")) || 100,
    }),
    getHrmsLogStats(searchParams.get("date") || undefined),
    getAllUsersForFilter(),
    getAllHrmsProjectsForFilter(),
  ]);

  return NextResponse.json({ logs, stats, filters: { users, projects } });
}
