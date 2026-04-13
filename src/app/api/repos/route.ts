// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { mkdir, rm } from "fs/promises";
import {
  insertRepositoryForUser,
  getRepositoriesByUser,
  getRepositoriesWithLastCommit,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
  updateGitAuthor,
  updatePrimaryLanguage,
  insertCommitCache,
  type CacheCommit,
} from "@/infra/db/repository";
import { fetchRepoLanguage } from "@/infra/github/github-client";
import { getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { cloneRepository, getBranches, getCommitsForCache } from "@/infra/git/git-client";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

async function registerSingleRepo(
  db: ReturnType<typeof getDb>,
  userId: string,
  token: string,
  cloneUrl: string,
  branch: string
): Promise<{ success: boolean; error?: string; cloneUrl: string }> {
  let parsed;
  try {
    parsed = parseGitUrl(cloneUrl);
  } catch {
    return { success: false, error: "Invalid Git URL", cloneUrl };
  }

  try {
    const { join } = await import("path");
    const clonePath = join(process.cwd(), "data", "repos", userId, parsed.owner, `${parsed.repo}.git`);

    insertRepositoryForUser(db, {
      userId,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      cloneUrl,
    });

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

        try {
          const language = await fetchRepoLanguage(parsed!.owner, parsed!.repo);
          updatePrimaryLanguage(db, repoRow.id, language);
        } catch (langErr) {
          console.error(`[Repos] Language fetch failed for ${cloneUrl}:`, langErr);
        }

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
            const inserted = insertCommitCache(db, rows);
            console.log(`[Repos] Cached ${inserted} commits for ${parsed!.owner}/${parsed!.repo}`);
          }
        } catch (cacheErr) {
          console.error(`[Repos] Cache build failed for ${cloneUrl}:`, cacheErr);
        }
      } catch (err) {
        console.error(`[Repos] Failed to clone ${cloneUrl}:`, err);
      }
    })();

    return { success: true, cloneUrl };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg, cloneUrl };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const db = getDb();
  const repos = getRepositoriesWithLastCommit(db, userId);
  return NextResponse.json(repos);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const userId = session.user.id;
  const db = getDb();

  // Git PAT 확인
  const gitCred = getCredentialByUserAndProvider(db, userId, "git");
  if (!gitCred) {
    return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
  }
  const token = decrypt(gitCred.credential);

  // 일괄 등록
  if (Array.isArray(body.repositories)) {
    const results = [];
    for (const item of body.repositories) {
      const result = await registerSingleRepo(db, userId, token, item.cloneUrl, item.branch || "main");
      results.push(result);
    }
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    return NextResponse.json({
      message: `${succeeded}개 저장소 등록됨${failed.length > 0 ? `, ${failed.length}개 실패` : ""}`,
      results,
    }, { status: 201 });
  }

  // 단건 등록 (기존 호환)
  const { cloneUrl, branch = "main" } = body;
  if (!cloneUrl) {
    return NextResponse.json({ error: "cloneUrl is required" }, { status: 400 });
  }

  const result = await registerSingleRepo(db, userId, token, cloneUrl, branch);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ message: "Repository registered. Cloning in progress." }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json();
  const { id, gitAuthor } = body as { id: number; gitAuthor?: string };

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  const updated = updateGitAuthor(db, id, userId, gitAuthor?.trim() || null);
  if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  return NextResponse.json({ message: "Updated" });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
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
}
