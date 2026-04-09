import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import {
  insertCredential,
  getCredentialsByUser,
  getCredentialByUserAndProvider,
  updateCredential,
  deleteCredential,
} from "@/infra/db/credential";
import { encrypt, maskToken } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  try {
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
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, token, label, metadata } = body;

  if (!provider || !token) {
    return NextResponse.json({ error: "provider and token are required" }, { status: 400 });
  }
  if (provider !== "git" && provider !== "notion") {
    return NextResponse.json({ error: "provider must be 'git' or 'notion'" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (existing) {
      return NextResponse.json({ error: `${provider} credential already exists. Use PUT to update.` }, { status: 409 });
    }

    const encrypted = encrypt(token);
    insertCredential(db, {
      userId: session.user.id,
      provider,
      credential: encrypted,
      label: label || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return NextResponse.json({ message: "Credential saved" }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, token, label, metadata } = body;

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (!existing) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    updateCredential(db, existing.id, {
      credential: token ? encrypt(token) : existing.credential,
      label: label !== undefined ? label : existing.label,
      metadata: metadata !== undefined ? JSON.stringify(metadata) : existing.metadata,
    });

    return NextResponse.json({ message: "Credential updated" });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });

  const db = getDb();
  try {
    const existing = getCredentialByUserAndProvider(db, session.user.id, provider);
    if (!existing) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    deleteCredential(db, existing.id);
    return NextResponse.json({ message: "Credential deleted" });
  } finally {
    db.close();
  }
}
