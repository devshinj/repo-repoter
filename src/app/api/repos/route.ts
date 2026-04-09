import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import {
  insertRepository,
  getActiveRepositories,
  deleteRepository,
  getRepositoryByOwnerRepo,
} from "@/infra/db/repository";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  try {
    const repos = getActiveRepositories(db);
    return NextResponse.json(repos);
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { owner, repo, branch = "main" } = body;

  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  const db = getDb();
  try {
    const existing = getRepositoryByOwnerRepo(db, owner, repo);
    if (existing) {
      return NextResponse.json({ error: "Repository already registered" }, { status: 409 });
    }

    insertRepository(db, { owner, repo, branch });
    return NextResponse.json({ message: "Repository registered" }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  try {
    deleteRepository(db, Number(id));
    return NextResponse.json({ message: "Deleted" });
  } finally {
    db.close();
  }
}
