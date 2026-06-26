import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateProject, deleteProject, getProjectWithRepos } from "@/infra/db/project-repository";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const project = await getProjectWithRepos(Number(id));
  if (!project || project.userId !== String(session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await updateProject(Number(id), {
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
  await deleteProject(Number(id));
  return NextResponse.json({ success: true });
}
