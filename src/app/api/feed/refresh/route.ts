import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshFeedForUser } from "@/scheduler/feed-scheduler";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await refreshFeedForUser(String(session.user.id));
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
