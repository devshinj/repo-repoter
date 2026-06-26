import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLogicraftMappingById, updateLogicraftMapping, deleteLogicraftMapping } from "@/infra/db/logicraft";
import { refreshLogicraftJob } from "@/scheduler/hrms-scheduler";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const mapping = await getLogicraftMappingById(id);

  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const body = await request.json();
  await updateLogicraftMapping(id, {
    hrmsProjectName: body.hrmsProjectName,
    autoRegister: body.autoRegister,
    cronTime: body.cronTime,
  });

  refreshLogicraftJob(id);

  return NextResponse.json({ message: "Updated" });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const mapping = await getLogicraftMappingById(id);

  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  await deleteLogicraftMapping(id);
  refreshLogicraftJob(id);

  return NextResponse.json({ message: "Deleted" });
}
