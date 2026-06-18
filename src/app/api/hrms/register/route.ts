import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import {
  getHrmsApiKey,
  getMappingById,
  hasSuccessLog,
  insertTaskLog,
  updateTaskLog,
  getLastSuccessLog,
  getInProgressLog,
} from "@/infra/db/hrms";
import { getCommitsByDateRange, getRepoLastSyncAt } from "@/infra/db/repository";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskContent } from "@/infra/llm/llm-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";
import { syncOneRepo } from "@/scheduler/polling-manager";
import { createJob, emitJobEvent } from "@/infra/hrms/registration-jobs";

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 백그라운드에서 실행되는 등록 파이프라인 */
async function executeRegistration(
  logId: number,
  userId: string,
  mapping: any,
  apiKey: string,
  date: string,
  force: boolean,
  hrmsUserId: string | null,
): Promise<void> {
  const db = getDb();

  try {
    // ── 1단계: 저장소 동기화 ──
    const syncThresholdMs = 5 * 60 * 1000;
    const repoTotal = mapping.repos.length;

    for (let i = 0; i < repoTotal; i++) {
      const repo = mapping.repos[i];
      const repoLabel = repo.label || `${repo.owner}/${repo.repo}`;

      emitJobEvent(logId, {
        step: "syncing",
        message: `저장소 동기화 중... (${i + 1}/${repoTotal})`,
        detail: repoLabel,
        repoIndex: i + 1,
        repoTotal,
      });

      const lastSync = getRepoLastSyncAt(db, repo.id);
      if (lastSync && Date.now() - new Date(lastSync).getTime() < syncThresholdMs) {
        continue;
      }
      try {
        const result = await syncOneRepo(db, userId, repo);
        if (result === null) {
          emitJobEvent(logId, {
            step: "error",
            message: `동기화 실패`,
            error: `${repoLabel}이(가) 이미 동기화 중입니다. 잠시 후 다시 시도해주세요.`,
          });
          updateTaskLog(db, logId, { status: "error", errorMessage: `Sync conflict: ${repoLabel}` });
          return;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitJobEvent(logId, { step: "error", message: `동기화 실패: ${repoLabel}`, error: detail });
        updateTaskLog(db, logId, { status: "error", errorMessage: `Sync failed: ${repoLabel} - ${detail}` });
        return;
      }
    }

    // ── 2단계: 커밋 수집 (저장소별 git_author 필터 적용) ──
    const repoIds = mapping.repos.map((r: any) => r.id);
    const allAuthors: string[] = [];
    for (const repo of mapping.repos) {
      if (repo.git_author) {
        const authors = repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean);
        allAuthors.push(...authors);
      }
    }
    const cacheCommits = getCommitsByDateRange(
      db, repoIds, date, date,
      allAuthors.length > 0 ? allAuthors : undefined,
    ) as any[];

    if (cacheCommits.length === 0) {
      emitJobEvent(logId, { step: "done", message: "해당 날짜에 커밋이 없어 건너뛰었습니다." });
      updateTaskLog(db, logId, { status: "skipped", errorMessage: null });
      return;
    }

    // ── 3단계: AI 업무 내용 생성 ──
    emitJobEvent(logId, { step: "generating", message: "업무 내용 생성 중..." });

    const repoMap = new Map<number, { repoName: string; commits: CommitRecord[] }>();
    for (const repo of mapping.repos) {
      repoMap.set(repo.id, { repoName: repo.label || `${repo.owner}/${repo.repo}`, commits: [] });
    }
    for (const c of cacheCommits) {
      const entry = repoMap.get(c.repositoryId);
      if (entry) {
        entry.commits.push({
          sha: c.sha, message: c.message, author: c.author, date: c.committed_at,
          repoOwner: "", repoName: "", branch: c.branch,
          filesChanged: [], additions: 0, deletions: 0,
        });
      }
    }

    const repoCommits = Array.from(repoMap.values()).filter((r) => r.commits.length > 0);
    const allCommits = repoCommits.flatMap((r) => r.commits);
    const estimatedMinutes = estimateWorkMinutes(allCommits);

    const generated = await generateHrmsTaskContent(
      mapping.hrms_project_name, date, repoCommits, estimatedMinutes,
    );
    const title = generated.title;
    const description = generated.description;

    // ── 4단계: HRMS 등록 ──
    emitJobEvent(logId, { step: "registering", message: "HRMS 등록 중..." });

    let hrmsTaskId: number;
    let action: "created" | "updated";

    if (force) {
      let existingTaskId: number | null = null;
      try {
        const tasks = await listTasks(apiKey, {
          projectId: mapping.hrms_project_id, dueFrom: date, dueTo: date,
        });
        if (tasks.length > 0) existingTaskId = tasks[0].id;
      } catch {
        const prevLog = getLastSuccessLog(db, mapping.id, date);
        existingTaskId = prevLog?.hrms_task_id ?? null;
      }

      if (existingTaskId) {
        await updateTask(apiKey, {
          id: existingTaskId, title, description, status: "done", timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = existingTaskId;
        action = "updated";
      } else {
        const created = await createTask(apiKey, {
          title, description, projectId: mapping.hrms_project_id,
          assigneeId: hrmsUserId ?? undefined,
          status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = created.id;
        action = "created";
      }
    } else {
      const created = await createTask(apiKey, {
        title, description, projectId: mapping.hrms_project_id,
        assigneeId: hrmsUserId ?? undefined,
        status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
      });
      hrmsTaskId = created.id;
      action = "created";
    }

    // ── 완료 ──
    updateTaskLog(db, logId, { status: "success", hrmsTaskId, title, description });
    emitJobEvent(logId, {
      step: "done",
      message: action === "updated" ? "기존 업무 업데이트 완료" : "업무 등록 완료",
      result: { hrmsTaskId, title, estimatedMinutes, action },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateTaskLog(db, logId, { status: "error", errorMessage: errorMsg });
    emitJobEvent(logId, { step: "error", message: "등록 실패", error: errorMsg });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { mappingId, targetDate, force } = body;

  if (!mappingId) {
    return NextResponse.json({ error: "mappingId is required" }, { status: 400 });
  }

  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // 이미 진행 중인 작업이 있으면 해당 jobId 반환
  const existing = getInProgressLog(db, mappingId);
  if (existing) {
    return NextResponse.json({ jobId: existing.id, resuming: true });
  }

  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const date = targetDate ?? getYesterdayDate();
  const apiKey = decrypt(keyRow.encrypted_key);

  // 중복 체크 (동기, 빠르게 완료됨)
  if (hasSuccessLog(db, mappingId, date) && !force) {
    let existsInHrms = false;
    try {
      const tasks = await listTasks(apiKey, {
        projectId: mapping.hrms_project_id, dueFrom: date, dueTo: date,
      });
      existsInHrms = tasks.length > 0;
    } catch { /* 조회 실패 시 로컬 기록 기준 */ }

    if (existsInHrms) {
      return NextResponse.json({ duplicate: true, date });
    }
  }

  // in_progress 로그 삽입 + job 생성 → 즉시 응답
  const logId = insertTaskLog(db, {
    mappingId,
    hrmsTaskId: null,
    targetDate: date,
    title: "등록 진행 중",
    description: "",
    status: "in_progress",
    errorMessage: null,
  });

  createJob(logId, mappingId, date);
  emitJobEvent(logId, { step: "pending", message: "등록 준비 중..." });

  // 백그라운드 실행 (fire-and-forget)
  executeRegistration(logId, session.user.id, mapping, apiKey, date, !!force, keyRow.hrms_user_id)
    .catch((err) => console.error("[HRMS Register] Unhandled error:", err));

  return NextResponse.json({ jobId: logId });
}
