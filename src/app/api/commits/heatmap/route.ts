// src/app/api/commits/heatmap/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getHeatmapCounts } from "@/infra/db/repository";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getKstToday, toKstDateString } from "@/core/date-utils";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const months = Math.min(Number(searchParams.get("months") || 6), 12);

  const until = getKstToday();
  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - months);
  const since = toKstDateString(sinceDate);

  const db = getDb();
  const data = getHeatmapCounts(db, session.user.id, since, until);
  return NextResponse.json({ data, since, until });
}
