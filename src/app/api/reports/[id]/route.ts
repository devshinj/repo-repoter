import { NextRequest, NextResponse } from "next/server";
import { getReportById, updateReport, deleteReport } from "@/infra/db/report";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const report = await getReportById(Number(id), session.user.id);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { title, content } = body;

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const updated = await updateReport(Number(id), session.user.id, { title, content });
  if (!updated) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ message: "Report updated" });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteReport(Number(id), session.user.id);
  if (!deleted) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ message: "Report deleted" });
}
