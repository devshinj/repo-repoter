import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getMappingById, updateMapping, deleteMapping } from "@/infra/db/hrms";
import { refreshJob } from "@/scheduler/hrms-scheduler";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const mappingId = parseInt(id, 10);
  const db = getDb();

  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const body = await request.json();
  updateMapping(db, mappingId, {
    hrmsProjectName: body.hrmsProjectName,
    autoRegister: body.autoRegister,
    cronTime: body.cronTime,
    repositoryIds: body.repositoryIds,
  });

  refreshJob(mappingId);
  return NextResponse.json({ message: "Mapping updated" });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const mappingId = parseInt(id, 10);
  const db = getDb();

  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  deleteMapping(db, mappingId);
  refreshJob(mappingId);
  return NextResponse.json({ message: "Mapping deleted" });
}
