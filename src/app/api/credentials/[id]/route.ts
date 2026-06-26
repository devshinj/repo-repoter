import { NextRequest, NextResponse } from "next/server";
import { getCredentialById, updateCredential, deleteCredential } from "@/infra/db/credential";
import { encrypt } from "@/infra/crypto/token-encryption";
import { auth } from "@/lib/auth";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const credId = parseInt(id, 10);
  if (isNaN(credId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const { token, label } = body;

  if (!token && label === undefined) {
    return NextResponse.json({ error: "token or label is required" }, { status: 400 });
  }

  const existing = await getCredentialById(credId);
  if (!existing) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  if (existing.user_id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await updateCredential(credId, {
    credential: token ? encrypt(token) : existing.credential,
    label: label !== undefined ? label : existing.label,
    metadata: existing.metadata,
  });

  return NextResponse.json({ message: "Credential updated" });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const credId = parseInt(id, 10);
  if (isNaN(credId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await getCredentialById(credId);
  if (!existing) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  if (existing.user_id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteCredential(credId);
  return NextResponse.json({ message: "Credential deleted" });
}
