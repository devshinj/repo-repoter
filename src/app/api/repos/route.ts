// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { createTables } from "@/infra/db/schema";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { cloneRepository } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const db = getDb();
  try {
    const repos = getRepositoriesByUser(db, userId);
    return NextResponse.json(repos);
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { cloneUrl, branch = "main" } = body;

  if (!cloneUrl) {
    return NextResponse.json({ error: "cloneUrl is required" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseGitUrl(cloneUrl);
  } catch {
    return NextResponse.json({ error: "Invalid Git URL. Only HTTPS URLs are supported." }, { status: 400 });
  }

  const userId = session.user.id;
  const db = getDb();
  try {
    // Git PAT 확인
    const gitCred = getCredentialByUserAndProvider(db, userId, "git");
    if (!gitCred) {
      return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
    }

    const token = decrypt(gitCred.credential);
    const clonePath = join(process.cwd(), "data", "repos", userId, parsed.owner, `${parsed.repo}.git`);

    insertRepositoryForUser(db, {
      userId,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      cloneUrl,
    });

    // 비동기로 bare clone 시작 (응답은 즉시 반환)
    const repoRow = db.prepare(
      "SELECT id FROM repositories WHERE user_id = ? AND clone_url = ?"
    ).get(userId, cloneUrl) as any;

    db.prepare("UPDATE repositories SET clone_path = ? WHERE id = ?").run(clonePath, repoRow.id);

    // clone은 백그라운드로 실행
    (async () => {
      try {
        await mkdir(join(process.cwd(), "data", "repos", userId, parsed!.owner), { recursive: true });
        await cloneRepository(cloneUrl, clonePath, token);
        console.log(`[Repos] Cloned ${cloneUrl} to ${clonePath}`);
      } catch (err) {
        console.error(`[Repos] Failed to clone ${cloneUrl}:`, err);
      }
    })();

    return NextResponse.json({ message: "Repository registered. Cloning in progress." }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), userId);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    const deleted = deleteRepositoryForUser(db, Number(id), userId);
    if (!deleted) {
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }

    // clone 디렉토리 정리
    if (repo.clone_path) {
      rm(repo.clone_path, { recursive: true, force: true }).catch(console.error);
    }

    return NextResponse.json({ message: "Deleted" });
  } finally {
    db.close();
  }
}
