// src/app/api/repos/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  insertRepositoryForUser,
  getRepositoriesWithLastCommit,
  deleteRepositoryForUser,
  getRepositoryByIdAndUser,
  updateGitAuthor,
  updateLabel,
  updateSyncStatus,
  updatePrimaryLanguage,
  updateAutoReportEnabled,
  insertCommitCache,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { createGitProvider } from "@/infra/git-provider";
import type { GitProviderMeta } from "@/core/types";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";

const detailConcurrency = 5;

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}

async function initialSync(
  db: ReturnType<typeof getDb>,
  repoId: number,
  owner: string,
  repo: string,
  branch: string,
  meta: GitProviderMeta,
  token: string
): Promise<void> {
  updateSyncStatus(db, repoId, "syncing");
  try {
    const provider = createGitProvider(meta, token);

    try {
      const language = await provider.getRepoLanguage(owner, repo);
      updatePrimaryLanguage(db, repoId, language);
    } catch { /* non-critical */ }

    const branches = await provider.listBranches(owner, repo);
    const branchNames = branches.map(b => b.name);
    const targetBranches = branchNames.length > 0 ? branchNames : [branch];

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sinceDate = sixMonthsAgo.toISOString();

    const seenShas = new Set<string>();
    const allCommits: CacheCommit[] = [];

    for (const br of targetBranches) {
      let page = 1;
      while (true) {
        const commits = await provider.listCommits(owner, repo, {
          branch: br, since: sinceDate, perPage: 100, page,
        });
        if (commits.length === 0) break;

        const detailed = await pMap(
          commits.filter(c => !seenShas.has(c.sha)),
          (c) => provider.getCommitDetail(owner, repo, c.sha),
          detailConcurrency
        );

        for (const c of detailed) {
          if (seenShas.has(c.sha)) continue;
          seenShas.add(c.sha);
          allCommits.push({
            sha: c.sha, repositoryId: repoId, branch: br,
            author: c.author, message: c.message,
            committedDate: c.date.slice(0, 10), committedAt: c.date,
            additions: c.additions, deletions: c.deletions, filesChanged: c.filesChanged,
          });
        }
        if (commits.length < 100) break;
        page++;
      }
    }

    if (allCommits.length > 0) {
      const inserted = insertCommitCache(db, allCommits);
      console.log(`[Repos] ${owner}/${repo}: cached ${inserted} commits via API`);
    }

    updateSyncStatus(db, repoId, "ready");
  } catch (err) {
    console.error(`[Repos] ${owner}/${repo}: initial sync failed -`, err);
    updateSyncStatus(db, repoId, "error");
  }
}

async function registerSingleRepo(
  db: ReturnType<typeof getDb>,
  userId: string,
  token: string,
  cloneUrl: string,
  branch: string,
  credentialId: number,
  meta: GitProviderMeta
): Promise<{ success: boolean; error?: string; cloneUrl: string }> {
  let parsed;
  try {
    parsed = parseGitUrl(cloneUrl);
  } catch {
    return { success: false, error: "Invalid Git URL", cloneUrl };
  }

  try {
    const repoRow = db.transaction(() => {
      insertRepositoryForUser(db, {
        userId, owner: parsed.owner, repo: parsed.repo, branch, cloneUrl, credentialId,
      });
      return db.prepare(
        "SELECT id FROM repositories WHERE user_id = ? AND clone_url = ?"
      ).get(userId, cloneUrl) as any;
    })();

    initialSync(db, repoRow.id, parsed.owner, parsed.repo, branch, meta, token).catch(console.error);
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

  const credentialId = body.credentialId ? Number(body.credentialId) : undefined;

  let gitCred: any;
  if (credentialId) {
    gitCred = getCredentialById(db, credentialId);
    if (!gitCred || gitCred.user_id !== userId) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
  } else {
    gitCred = getCredentialByUserAndProvider(db, userId, "git");
  }

  if (!gitCred) {
    return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
  }
  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata ? JSON.parse(gitCred.metadata) : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

  if (Array.isArray(body.repositories)) {
    const results = [];
    for (const item of body.repositories) {
      const result = await registerSingleRepo(db, userId, token, item.cloneUrl, item.branch || "main", credentialId ?? gitCred.id, meta);
      results.push(result);
    }
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    return NextResponse.json({
      message: `${succeeded}개 저장소 등록됨${failed.length > 0 ? `, ${failed.length}개 실패` : ""}`,
      results,
    }, { status: 201 });
  }

  const { cloneUrl, branch = "main" } = body;
  if (!cloneUrl) {
    return NextResponse.json({ error: "cloneUrl is required" }, { status: 400 });
  }

  const result = await registerSingleRepo(db, userId, token, cloneUrl, branch, credentialId ?? gitCred.id, meta);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ message: "Repository registered. Syncing in progress." }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json();
  const { id, gitAuthor, label, isActive, autoReportEnabled } = body as {
    id: number;
    gitAuthor?: string;
    label?: string;
    isActive?: boolean;
    autoReportEnabled?: boolean;
  };

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();

  if (autoReportEnabled !== undefined) {
    const updated = updateAutoReportEnabled(db, id, userId, autoReportEnabled);
    if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    return NextResponse.json({ message: "Updated" });
  }

  if (isActive !== undefined) {
    const repo = getRepositoryByIdAndUser(db, id, userId);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    db.prepare(
      "UPDATE repositories SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(isActive ? 1 : 0, id, userId);
    return NextResponse.json({ message: "Updated" });
  }

  if (label !== undefined) {
    const updated = updateLabel(db, id, userId, label.trim() || null);
    if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    return NextResponse.json({ message: "Updated" });
  }

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

  return NextResponse.json({ message: "Deleted" });
}
