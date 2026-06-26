import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { insertProject, getProjectsByUser } from "@/infra/db/project-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await getProjectsByUser(String(session.user.id));
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name || !Array.isArray(body.repositoryIds)) {
    return NextResponse.json({ error: "name and repositoryIds required" }, { status: 400 });
  }

  const id = await insertProject({
    userId: String(session.user.id),
    name: body.name,
    description: body.description || null,
    repositoryIds: body.repositoryIds,
  });
  return NextResponse.json({ id }, { status: 201 });
}
