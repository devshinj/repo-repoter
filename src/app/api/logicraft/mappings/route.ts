import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLogicraftMappingsByUser, insertLogicraftMapping } from "@/infra/db/logicraft";
import { refreshLogicraftJob } from "@/scheduler/hrms-scheduler";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mappings = await getLogicraftMappingsByUser(session.user.id);
  return NextResponse.json(mappings);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { hrmsProjectId, hrmsProjectName, logicraftProjectId, logicraftProjectName, autoRegister, cronTime } = body;

  if (!hrmsProjectId || !logicraftProjectId) {
    return NextResponse.json({ error: "hrmsProjectId and logicraftProjectId are required" }, { status: 400 });
  }

  try {
    const id = await insertLogicraftMapping({
      userId: session.user.id,
      hrmsProjectId,
      hrmsProjectName: hrmsProjectName ?? "",
      logicraftProjectId,
      logicraftProjectName: logicraftProjectName ?? "",
      autoRegister: autoRegister ?? false,
      cronTime: cronTime ?? "0 9 * * 1-5",
    });

    if (autoRegister) {
      refreshLogicraftJob(id);
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "이미 매핑된 LogiCraft 프로젝트입니다." }, { status: 409 });
    }
    throw err;
  }
}
