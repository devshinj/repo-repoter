import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getSchedulerStatus } from "@/scheduler/polling-manager";
import { getSchedulerRepos, getHrmsMappings, getLogicraftMappings } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = getSchedulerStatus();
  const [repos, hrmsMappings, logicraftMappings] = await Promise.all([
    getSchedulerRepos(),
    getHrmsMappings(),
    getLogicraftMappings(),
  ]);

  return NextResponse.json({ scheduler: status, repos, hrmsMappings, logicraftMappings });
}
