// src/app/api/repos/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getRepositoryByIdAndUser, updateLastSyncedSha, insertSyncLogForUser,
  getLatestCacheDate, insertCommitCache, updatePrimaryLanguage,
  type CacheCommit,
} from "@/infra/db/repository";
import { getCredentialById, getCredentialByUserAndProvider } from "@/infra/db/credential";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createGitProvider } from "@/infra/git-provider";
import { groupCommitsByDateAndProject } from "@/core/analyzer/commit-grouper";
import { isAmbiguousCommitMessage } from "@/core/analyzer/task-extractor";
import { analyzeCommits, analyzeCommitWithDiff } from "@/infra/gemini/gemini-client";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import type { CommitRecord, GitProviderMeta } from "@/core/types";

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  try {
    const repo = getRepositoryByIdAndUser(db, Number(id), session.user.id);
    if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    if (repo.sync_status !== "ready" && repo.sync_status !== "error") {
      return NextResponse.json({ error: "Repository is still syncing" }, { status: 400 });
    }

    const gitCred = repo.credential_id
      ? getCredentialById(db, repo.credential_id)
      : getCredentialByUserAndProvider(db, session.user.id, "git");
    if (!gitCred) return NextResponse.json({ error: "Git PAT not configured" }, { status: 400 });

    const token = decrypt(gitCred.credential);
    const meta: GitProviderMeta = gitCred.metadata
      ? JSON.parse(gitCred.metadata)
      : { type: "github", host: "github.com", apiBase: "https://api.github.com" };

    const provider = createGitProvider(meta, token);

    // 1. Language
    try {
      const language = await provider.getRepoLanguage(repo.owner, repo.repo);
      updatePrimaryLanguage(db, repo.id, language);
    } catch { /* non-critical */ }

    // 2. Incremental commits
    const latestDate = getLatestCacheDate(db, repo.id);
    const sinceDate = latestDate
      ? new Date(new Date(latestDate).getTime() - 86400000).toISOString()
      : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString(); })();

    const branches = await provider.listBranches(repo.owner, repo.repo);
    const branchNames = branches.map(b => b.name);
    const targetBranches = branchNames.length > 0 ? branchNames : [repo.branch];

    const seenShas = new Set<string>();
    const newCacheCommits: CacheCommit[] = [];
    const newCommitRecords: CommitRecord[] = [];

    for (const br of targetBranches) {
      let page = 1;
      while (true) {
        const commits = await provider.listCommits(repo.owner, repo.repo, {
          branch: br, since: sinceDate, perPage: 100, page,
        });
        if (commits.length === 0) break;

        const newCommits = commits.filter(c => !seenShas.has(c.sha));
        const detailed = await pMap(
          newCommits,
          (c) => provider.getCommitDetail(repo.owner, repo.repo, c.sha),
          detailConcurrency
        );

        for (const c of detailed) {
          if (seenShas.has(c.sha)) continue;
          seenShas.add(c.sha);
          newCacheCommits.push({
            sha: c.sha, repositoryId: repo.id, branch: br,
            author: c.author, message: c.message,
            committedDate: c.date.slice(0, 10), committedAt: c.date,
            additions: c.additions, deletions: c.deletions, filesChanged: c.filesChanged,
          });
          newCommitRecords.push({
            sha: c.sha, message: c.message, author: c.author, date: c.date,
            repoOwner: repo.owner, repoName: repo.repo, branch: br,
            filesChanged: c.filesChanged, additions: c.additions, deletions: c.deletions,
          });
        }
        if (commits.length < 100) break;
        page++;
      }
    }

    // 3. Cache
    if (newCacheCommits.length > 0) insertCommitCache(db, newCacheCommits);

    if (newCommitRecords.length === 0) {
      insertSyncLogForUser(db, {
        repositoryId: repo.id, userId: session.user.id,
        status: "success", commitsProcessed: 0, tasksCreated: 0, errorMessage: null,
      });
      return NextResponse.json({ message: "No new commits", commitsProcessed: 0, tasksCreated: 0 });
    }

    // 4. Enrich ambiguous commits
    const enrichedCommits: CommitRecord[] = [];
    for (const commit of newCommitRecords) {
      if (isAmbiguousCommitMessage(commit.message)) {
        try {
          const diff = await provider.getCommitDiff(repo.owner, repo.repo, commit.sha);
          const summary = await analyzeCommitWithDiff(commit, diff);
          enrichedCommits.push({ ...commit, message: summary });
        } catch { enrichedCommits.push(commit); }
      } else {
        enrichedCommits.push(commit);
      }
    }

    // 5. Group + analyze
    const groups = groupCommitsByDateAndProject(enrichedCommits);
    let tasksCreated = 0;
    for (const group of groups) {
      const tasks = await analyzeCommits(group.commits, group.project, group.date);
      tasksCreated += tasks.length;
    }

    // 6. Update SHA + log
    updateLastSyncedSha(db, repo.id, newCommitRecords[0].sha);
    insertSyncLogForUser(db, {
      repositoryId: repo.id, userId: session.user.id,
      status: "success", commitsProcessed: newCommitRecords.length, tasksCreated, errorMessage: null,
    });

    return NextResponse.json({ message: "Sync complete", commitsProcessed: newCommitRecords.length, tasksCreated });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    insertSyncLogForUser(db, {
      repositoryId: Number(id), userId: session.user.id,
      status: "error", commitsProcessed: 0, tasksCreated: 0, errorMessage: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
