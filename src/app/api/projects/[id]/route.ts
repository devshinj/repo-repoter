import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { updateProject, deleteProject, getProjectWithRepos } from "@/infra/db/project-repository";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const project = getProjectWithRepos(db, Number(id));
  if (!project || project.userId !== String(session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  updateProject(db, Number(id), {
    name: body.name,
    description: body.description,
    repositoryIds: body.repositoryIds,
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  deleteProject(db, Number(id));
  return NextResponse.json({ success: true });
}
