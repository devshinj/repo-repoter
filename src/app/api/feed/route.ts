import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteOrphanedFeedEntries, getFeedEntries } from "@/infra/db/feed-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = String(session.user.id);
  await deleteOrphanedFeedEntries(userId);
  const entries = await getFeedEntries(userId);
  return NextResponse.json(entries);
}
