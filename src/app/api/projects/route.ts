import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import { insertProject, getProjectsByUser } from "@/infra/db/project-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const projects = getProjectsByUser(db, String(session.user.id));
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name || !Array.isArray(body.repositoryIds)) {
    return NextResponse.json({ error: "name and repositoryIds required" }, { status: 400 });
  }

  const db = getDb();
  const id = insertProject(db, {
    userId: String(session.user.id),
    name: body.name,
    description: body.description || null,
    repositoryIds: body.repositoryIds,
  });
  return NextResponse.json({ id }, { status: 201 });
}
