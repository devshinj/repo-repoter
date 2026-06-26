import { NextRequest, NextResponse } from "next/server";
import { insertReport, getReportsByUser } from "@/infra/db/report";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reports = await getReportsByUser(session.user.id);
  return NextResponse.json(reports);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { repositoryId, project, date, title, content, dateStart, dateEnd, status } = body;

  if (!repositoryId || !project || !date || !title) {
    return NextResponse.json({ error: "repositoryId, project, date, title are required" }, { status: 400 });
  }

  const id = await insertReport({
    userId: session.user.id,
    repositoryId,
    project,
    date,
    title,
    content: content ?? "",
    dateStart,
    dateEnd,
    status,
  });
  return NextResponse.json({ id, message: "Report saved" }, { status: 201 });
}
