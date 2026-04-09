import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runSyncCycle } from "@/scheduler/polling-manager";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await runSyncCycle();
    return NextResponse.json({ message: "Sync completed" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
