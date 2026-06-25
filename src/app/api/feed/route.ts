import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { deleteOrphanedFeedEntries, getFeedEntries } from "@/infra/db/feed-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const userId = String(session.user.id);
  deleteOrphanedFeedEntries(db, userId);
  const entries = getFeedEntries(db, userId);
  return NextResponse.json(entries);
}
