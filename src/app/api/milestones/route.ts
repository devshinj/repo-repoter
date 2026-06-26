import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { insertMilestone, getMilestonesByUser } from "@/infra/db/milestone-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const milestones = await getMilestonesByUser(String(session.user.id));
  return NextResponse.json(milestones);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.title || !body.rawInput) {
    return NextResponse.json({ error: "title and rawInput required" }, { status: 400 });
  }
  if (!body.projectId && !body.repositoryId) {
    return NextResponse.json({ error: "projectId or repositoryId required" }, { status: 400 });
  }

  const id = await insertMilestone({
    userId: String(session.user.id),
    projectId: body.projectId || null,
    repositoryId: body.repositoryId || null,
    title: body.title,
    rawInput: body.rawInput,
    deadline: body.deadline || null,
  });
  return NextResponse.json({ id }, { status: 201 });
}
