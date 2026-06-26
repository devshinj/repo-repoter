import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLogicraftApiKey } from "@/infra/db/logicraft";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listProjects } from "@/infra/logicraft/logicraft-client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  let { apiKey } = body;

  // "__stored__" 이면 DB에 저장된 key 사용
  if (apiKey === "__stored__") {
    const row = await getLogicraftApiKey(session.user.id);
    if (!row) return NextResponse.json({ error: "No stored LogiCraft API key" }, { status: 400 });
    apiKey = decrypt(row.encrypted_key);
  }

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  try {
    const projects = await listProjects(apiKey);
    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json({ error: `LogiCraft API verification failed: ${err.message}` }, { status: 400 });
  }
}
