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
  trySyncStart,
} from "@/infra/db/repository";
import { sql } from "@/infra/db/connection";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { parseGitUrl } from "@/infra/git/parse-git-url";
import { createGitProvider, inferProviderMeta } from "@/infra/git-provider";
import type { GitProviderMeta } from "@/core/types";
import { auth } from "@/lib/auth";
import { fetchUncachedCommits, maxCommitsPerBackfill } from "@/scheduler/polling-manager";

async function initialSync(
  repoId: number,
  owner: string,
  repo: string,
  branch: string,
  meta: GitProviderMeta,
  token: string
): Promise<void> {
  if (!await trySyncStart(repoId)) {
    console.log(`[Repos] ${owner}/${repo}: already syncing, skipped initial sync`);
    return;
  }
  try {
    const provider = createGitProvider(meta, token);

    try {
      const language = await provider.getRepoLanguage(owner, repo);
      await updatePrimaryLanguage(repoId, language);
    } catch { /* non-critical */ }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { cacheCommits: allCommits } = await fetchUncachedCommits(
      provider, { id: repoId, owner, repo, branch },
      { since: sixMonthsAgo.toISOString(), maxCommits: maxCommitsPerBackfill },
    );

    if (allCommits.length > 0) {
      const inserted = await insertCommitCache(allCommits);
      console.log(`[Repos] ${owner}/${repo}: cached ${inserted} commits via API`);
    }

    await updateSyncStatus(repoId, "ready");
  } catch (err) {
    console.error(`[Repos] ${owner}/${repo}: initial sync failed -`, err);
    await updateSyncStatus(repoId, "error");
  }
}

async function registerSingleRepo(
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
    await insertRepositoryForUser({
      userId, owner: parsed.owner, repo: parsed.repo, branch, cloneUrl, credentialId,
    });

    const [repoRow] = await sql`
      SELECT id FROM repositories WHERE user_id = ${userId} AND clone_url = ${cloneUrl}
    `;

    initialSync(repoRow.id, parsed.owner, parsed.repo, branch, meta, token).catch(console.error);
    return { success: true, cloneUrl };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("repositories_user_id_clone_url_key")) {
      return { success: false, error: "이미 등록된 저장소입니다", cloneUrl };
    }
    return { success: false, error: msg, cloneUrl };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const repos = await getRepositoriesWithLastCommit(userId);
  return NextResponse.json(repos);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const userId = session.user.id;

  const credentialId = body.credentialId ? Number(body.credentialId) : undefined;

  let gitCred: any;
  if (credentialId) {
    gitCred = await getCredentialById(credentialId);
    if (!gitCred || gitCred.user_id !== userId) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
  } else {
    gitCred = await getCredentialByUserAndProvider(userId, "git");
  }

  if (!gitCred) {
    return NextResponse.json({ error: "Git PAT이 등록되지 않았습니다. 설정에서 먼저 등록하세요." }, { status: 400 });
  }
  const token = decrypt(gitCred.credential);
  const meta: GitProviderMeta = gitCred.metadata
    ? (typeof gitCred.metadata === "string" ? JSON.parse(gitCred.metadata) : gitCred.metadata)
    : inferProviderMeta();

  if (Array.isArray(body.repositories)) {
    const results = [];
    for (const item of body.repositories) {
      const result = await registerSingleRepo(userId, token, item.cloneUrl, item.branch || "main", credentialId ?? gitCred.id, meta);
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

  const result = await registerSingleRepo(userId, token, cloneUrl, branch, credentialId ?? gitCred.id, meta);
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

  if (autoReportEnabled !== undefined) {
    const updated = await updateAutoReportEnabled(id, userId, autoReportEnabled);
    if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    return NextResponse.json({ message: "Updated" });
  }

  if (isActive !== undefined) {
    const repo = await getRepositoryByIdAndUser(id, userId);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    await sql`
      UPDATE repositories SET is_active = ${isActive}, updated_at = NOW() WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ message: "Updated" });
  }

  if (label !== undefined) {
    const updated = await updateLabel(id, userId, label.trim() || null);
    if (!updated) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    return NextResponse.json({ message: "Updated" });
  }

  const updated = await updateGitAuthor(id, userId, gitAuthor?.trim() || null);
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

  const repo = await getRepositoryByIdAndUser(Number(id), userId);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const deleted = await deleteRepositoryForUser(Number(id), userId);
  if (!deleted) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ message: "Deleted" });
}
