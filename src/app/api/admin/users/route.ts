import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAllUsers, getUserStats } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [users, stats] = await Promise.all([getAllUsers(), getUserStats()]);

  return NextResponse.json({ users, stats });
}
