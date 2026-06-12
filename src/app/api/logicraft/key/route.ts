import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getLogicraftApiKey, upsertLogicraftApiKey, deleteLogicraftApiKey } from "@/infra/db/logicraft";
import { encrypt, decrypt, maskToken } from "@/infra/crypto/token-encryption";
import { verifyApiKey } from "@/infra/logicraft/logicraft-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const row = getLogicraftApiKey(db, session.user.id);

  if (!row) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
    maskedKey: maskToken(decrypt(row.encrypted_key)),
    createdAt: row.created_at,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  try {
    const projects = await verifyApiKey(apiKey);

    const db = getDb();
    upsertLogicraftApiKey(db, {
      userId: session.user.id,
      encryptedKey: encrypt(apiKey),
    });

    return NextResponse.json({
      message: "LogiCraft API key registered",
      projectCount: projects.length,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: `LogiCraft verification failed: ${err.message}` }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  deleteLogicraftApiKey(db, session.user.id);
  return NextResponse.json({ message: "LogiCraft API key deleted" });
}
