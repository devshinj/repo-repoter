import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getDashboardStats } from "@/infra/db/repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const stats = getDashboardStats(db, session.user.id);
  return NextResponse.json(stats);
}
