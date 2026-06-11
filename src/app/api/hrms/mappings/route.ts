import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getHrmsApiKey, getMappingsByUser, insertMapping } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { getProject } from "@/infra/hrms/hrms-client";
import { refreshJob } from "@/scheduler/hrms-scheduler";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const mappings = getMappingsByUser(db, session.user.id);
  return NextResponse.json(mappings);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { hrmsProjectId, repositoryIds, autoRegister, cronTime } = body;

  if (!hrmsProjectId || !Array.isArray(repositoryIds) || repositoryIds.length === 0) {
    return NextResponse.json({ error: "hrmsProjectId and repositoryIds[] are required" }, { status: 400 });
  }

  const db = getDb();
  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const project = await getProject(apiKey, hrmsProjectId);

    const mappingId = insertMapping(db, {
      userId: session.user.id,
      hrmsProjectId,
      hrmsProjectName: project.name,
      autoRegister: autoRegister ?? false,
      cronTime: cronTime ?? "0 9 * * 1-5",
      repositoryIds,
    });

    refreshJob(mappingId);

    return NextResponse.json({ id: mappingId, message: "Mapping created" }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
