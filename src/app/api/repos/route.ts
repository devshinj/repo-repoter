// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { createTables, migrateSchema } from "@/infra/db/schema";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
  updateGitAuthor,
  insertCommitCache,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { cloneRepository, getBranches, getCommitsForCache } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  migrateSchema(db);
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

        // 초기 캐시 빌드
        try {
          const cacheDb = getDb();
          try {
            const branches = await getBranches(clonePath);
            const cacheCommits = await getCommitsForCache(clonePath, branches);
            if (cacheCommits.length > 0) {
              const rows: CacheCommit[] = cacheCommits.map(c => ({
                sha: c.sha,
                repositoryId: repoRow.id,
                branch: c.branch,
                author: c.author,
                message: c.message,
                committedDate: c.committedDate,
                committedAt: c.committedAt,
              }));
              const inserted = insertCommitCache(cacheDb, rows);
              console.log(`[Repos] Cached ${inserted} commits for ${parsed!.owner}/${parsed!.repo}`);
            }
          } finally {
            cacheDb.close();
          }
        } catch (cacheErr) {
          console.error(`[Repos] Cache build failed for ${cloneUrl}:`, cacheErr);
        }
      } catch (err) {
        console.error(`[Repos] Failed to clone ${cloneUrl}:`, err);
      }
    })();

    return NextResponse.json({ message: "Repository registered. Cloning in progress." }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json();
  const { id, gitAuthor } = body as { id: number; gitAuthor?: string };

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  try {
    const updated = updateGitAuthor(db, id, userId, gitAuthor?.trim() || null);
    if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    return NextResponse.json({ message: "Updated" });
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
