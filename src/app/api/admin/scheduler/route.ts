import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { getSchedulerStatus } from "@/scheduler/polling-manager";
import { getSchedulerRepos, getHrmsMappings, getLogicraftMappings } from "@/infra/db/admin-repository";

export async function GET(request: NextRequest) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = getSchedulerStatus();
  const db = getDb();
  const repos = getSchedulerRepos(db);
  const hrmsMappings = getHrmsMappings(db);
  const logicraftMappings = getLogicraftMappings(db);

  return NextResponse.json({ scheduler: status, repos, hrmsMappings, logicraftMappings });
}
