import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { getMilestoneById, updateMilestone, deleteMilestone } from "@/infra/db/milestone-repository";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const milestone = getMilestoneById(db, Number(id));
  if (!milestone) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (milestone.userId !== String(session.user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  updateMilestone(db, Number(id), {
    title: body.title,
    deadline: body.deadline,
    status: body.status,
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const milestone = getMilestoneById(db, Number(id));
  if (!milestone) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (milestone.userId !== String(session.user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  deleteMilestone(db, Number(id));
  return NextResponse.json({ success: true });
}
