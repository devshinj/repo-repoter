import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMappingsByUser } from "@/infra/db/hrms";
import { getActiveJobs } from "@/infra/hrms/registration-jobs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mappings = await getMappingsByUser(session.user.id);
  const mappingIds = mappings.map((m: any) => m.id);

  const activeJobs = getActiveJobs(mappingIds);

  return NextResponse.json(activeJobs);
}
