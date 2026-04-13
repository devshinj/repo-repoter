// src/app/api/repos/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { getRepositoryByIdAndUser, updateLastSyncedSha, insertSyncLogForUser, getLatestCacheDate, insertCommitCache, updatePrimaryLanguage, type CacheCommit } from "@/infra/db/repository";
import { fetchRepoLanguage } from "@/infra/github/github-client";
import { getCredentialByUserAndProvider, getCredentialById } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { pullRepository, getCommitsSince, getCommitDiff, cloneRepository, getBranches, getCommitsForCache, RepoNotFoundError } from "@/infra/git/git-client";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord } from "@/core/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }
    if (!repo.clone_path) {
      return NextResponse.json({ error: "Repository not yet cloned" }, { status: 400 });
    }

    // Git PAT 복호화 — repo에 연결된 credential 우선 사용
    const gitCred = repo.credential_id
      ? getCredentialById(db, repo.credential_id)
      : getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) {
      return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });
    }

    // 1. git fetch (bare repo 없으면 re-clone)
    try {
      await pullRepository(repo.clone_path);
    } catch (err) {
      if (err instanceof RepoNotFoundError) {
        const token = decrypt(gitCred.credential);
        await mkdir(dirname(repo.clone_path), { recursive: true });
        await cloneRepository(repo.clone_url, repo.clone_path, token);
      } else {
        throw err;
      }
    }

    // 2. 언어 정보 갱신
    try {
      const token = decrypt(gitCred.credential);
      const language = await fetchRepoLanguage(repo.owner, repo.repo, token);
      updatePrimaryLanguage(db, repo.id, language);
    } catch { /* non-critical */ }

    // 3. 캐시 빌드 (증분) — 히트맵 데이터 소스
    try {
      const branches = await getBranches(repo.clone_path);
      const latestDate = getLatestCacheDate(db, repo.id);
      const cacheCommits = await getCommitsForCache(repo.clone_path, branches, latestDate ?? undefined);
      if (cacheCommits.length > 0) {
        const rows: CacheCommit[] = cacheCommits.map(c => ({
          sha: c.sha,
          repositoryId: repo.id,
          branch: c.branch,
          author: c.author,
          message: c.message,
          committedDate: c.committedDate,
          committedAt: c.committedAt,
        }));
        insertCommitCache(db, rows);
      }
    } catch { /* non-critical */ }

    // 4. 새 커밋 수집
    const commits = await getCommitsSince(repo.clone_path, repo.branch, repo.clone_url, repo.last_synced_sha);
    if (commits.length === 0) {
      insertSyncLogForUser(db, {
        repositoryId: repo.id,
        userId: session.user.id,
        status: "success",
        commitsProcessed: 0,
        tasksCreated: 0,
        errorMessage: null,
      });
      return NextResponse.json({ message: "No new commits", commitsProcessed: 0, tasksCreated: 0 });
    }

    // 5. 모호한 커밋 보강
    const enrichedCommits: CommitRecord[] = [];
    for (const commit of commits) {
      if (isAmbiguousCommitMessage(commit.message)) {
        const diff = await getCommitDiff(repo.clone_path, commit.sha);
        const summary = await analyzeCommitWithDiff(commit, diff);
        enrichedCommits.push({ ...commit, message: summary });
      } else {
        enrichedCommits.push(commit);
      }
    }

    // 6. 그룹핑 + Gemini 분석
    const groups = groupCommitsByDateAndProject(enrichedCommits);
    let tasksCreated = 0;
    for (const group of groups) {
      const tasks = await analyzeCommits(group.commits, group.project, group.date);
      tasksCreated += tasks.length;
    }

    // 7. SHA 업데이트 + 로그
    updateLastSyncedSha(db, repo.id, commits[0].sha);
    insertSyncLogForUser(db, {
      repositoryId: repo.id,
      userId: session.user.id,
      status: "success",
      commitsProcessed: commits.length,
      tasksCreated,
      errorMessage: null,
    });

    return NextResponse.json({ message: "Sync complete", commitsProcessed: commits.length, tasksCreated });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    insertSyncLogForUser(db, {
      repositoryId: Number(id),
      userId: session.user.id,
      status: "error",
      commitsProcessed: 0,
      tasksCreated: 0,
      errorMessage: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
