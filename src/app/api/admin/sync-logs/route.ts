import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getSyncLogs, getAllUsersForFilter, getAllReposForFilter } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const db = getDb();

  const logs = getSyncLogs(db, {
    userId: searchParams.get("userId") || undefined,
    repoId: searchParams.get("repoId") || undefined,
    status: searchParams.get("status") || undefined,
    limit: Number(searchParams.get("limit")) || 100,
  });
  const users = getAllUsersForFilter(db);
  const repos = getAllReposForFilter(db);

  return NextResponse.json({ logs, filters: { users, repos } });
}
