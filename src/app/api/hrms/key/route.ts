import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey, upsertHrmsApiKey, deleteHrmsApiKey } from "@/infra/db/hrms";
import { encrypt, decrypt, maskToken } from "@/infra/crypto/token-encryption";
import { verifyApiKey } from "@/infra/hrms/hrms-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const row = getHrmsApiKey(db, session.user.id);

  if (!row) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
    hrmsUserName: row.hrms_user_name,
    scopes: row.scopes ? JSON.parse(row.scopes) : null,
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

  if (!apiKey.startsWith("sk_")) {
    return NextResponse.json({ error: "Invalid API key format (must start with sk_)" }, { status: 400 });
  }

  try {
    const userInfo = await verifyApiKey(apiKey);

    if (!userInfo.permissions.can_create) {
      return NextResponse.json({ error: "API key must have 'create' permission for task registration" }, { status: 400 });
    }

    const db = getDb();
    upsertHrmsApiKey(db, {
      userId: session.user.id,
      encryptedKey: encrypt(apiKey),
      hrmsUserId: userInfo.id,
      hrmsUserName: userInfo.name,
      scopes: JSON.stringify(userInfo.permissions),
    });

    return NextResponse.json({
      message: "API key registered",
      hrmsUserName: userInfo.name,
      permissions: userInfo.permissions,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: `HRMS verification failed: ${err.message}` }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  deleteHrmsApiKey(db, session.user.id);
  return NextResponse.json({ message: "API key deleted" });
}
