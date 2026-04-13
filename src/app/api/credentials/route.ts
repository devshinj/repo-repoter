import { NextRequest, NextResponse } from "next/server";
import {
  insertCredential,
  getCredentialsByUser,
} from "@/infra/db/credential";
import { encrypt, maskToken } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

const validProviders = ["git"] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const creds = getCredentialsByUser(db, session.user.id);
  const masked = creds.map((c: any) => ({
    id: c.id,
    provider: c.provider,
    label: c.label,
    metadata: c.metadata ? JSON.parse(c.metadata) : null,
    maskedToken: maskToken(c.credential.split(":").pop() || "****"),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
  return NextResponse.json(masked);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, token, label, metadata } = body;

  if (!provider || !token || !label) {
    return NextResponse.json({ error: "provider, token, label are required" }, { status: 400 });
  }
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: `provider must be one of: ${validProviders.join(", ")}` }, { status: 400 });
  }

  // metadata 검증: git provider는 type, host, apiBase 필수
  if (provider === "git") {
    if (!metadata?.type || !metadata?.host || !metadata?.apiBase) {
      return NextResponse.json({ error: "metadata.type, metadata.host, metadata.apiBase are required for git provider" }, { status: 400 });
    }
    if (!["github", "gitea", "gitlab", "bitbucket"].includes(metadata.type)) {
      return NextResponse.json({ error: "metadata.type must be 'github', 'gitea', 'gitlab', or 'bitbucket'" }, { status: 400 });
    }
  }

  const db = getDb();
  const encrypted = encrypt(token);
  insertCredential(db, {
    userId: session.user.id,
    provider,
    credential: encrypted,
    label,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });

  return NextResponse.json({ message: "Credential saved" }, { status: 201 });
}
