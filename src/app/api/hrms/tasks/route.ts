import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listTasks } from "@/infra/hrms/hrms-client";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const db = getDb();
  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const tasks = await listTasks(apiKey, { projectId: Number(projectId) });
    return NextResponse.json(tasks);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
