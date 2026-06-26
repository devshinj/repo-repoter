import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listProjects } from "@/infra/hrms/hrms-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyRow = await getHrmsApiKey(session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const projects = await listProjects(apiKey);
    return NextResponse.json(projects);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
