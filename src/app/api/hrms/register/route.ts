import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/infra/db/connection";
import {
  getHrmsApiKey,
  getMappingById,
  hasSuccessLog,
  insertTaskLog,
  getLastSuccessLog,
} from "@/infra/db/hrms";
import { getCommitsByDateRange } from "@/infra/db/repository";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskContent } from "@/infra/gemini/gemini-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";
import { syncOneRepo } from "@/scheduler/polling-manager";

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

  const keyRow = getHrmsApiKey(db, session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const date = targetDate ?? getYesterdayDate();
  const apiKey = decrypt(keyRow.encrypted_key);

  // 중복 체크: 로컬 로그 + HRMS 서버 실제 존재 여부 확인
  if (hasSuccessLog(db, mappingId, date) && !force) {
    // HRMS에서 해당 날짜 태스크가 실제로 존재하는지 확인
    let existsInHrms = false;
    try {
      const tasks = await listTasks(apiKey, {
        projectId: mapping.hrms_project_id,
        dueFrom: date,
        dueTo: date,
      });
      existsInHrms = tasks.length > 0;
    } catch { /* HRMS 조회 실패 시 로컬 기록 기준으로 판단 */ }

    if (existsInHrms) {
      return NextResponse.json({ duplicate: true, date }, { status: 200 });
    }
    // HRMS에서 삭제된 경우 → 신규 등록으로 진행
  }

  // 등록 전 자동 동기화: 매핑된 저장소를 순차 동기화
  const syncResults: { repo: string; commitsProcessed: number }[] = [];
  for (const repo of mapping.repos) {
    const repoLabel = repo.label || `${repo.owner}/${repo.repo}`;
    try {
      const result = await syncOneRepo(db, session.user.id, repo);
      if (result === null) {
        return NextResponse.json(
          { error: `동기화 실패: ${repoLabel}이(가) 이미 동기화 중입니다. 잠시 후 다시 시도해주세요.`, failedRepo: repoLabel },
          { status: 409 },
        );
      }
      syncResults.push({ repo: repoLabel, commitsProcessed: result.commitsProcessed });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { error: `동기화 실패: ${repoLabel}`, failedRepo: repoLabel, detail },
        { status: 500 },
      );
    }
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];

  if (cacheCommits.length === 0) {
    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "skip",
      description: "커밋 없음",
      status: "error",
      errorMessage: "No commits found for target date",
    });
    return NextResponse.json({ message: "No commits found", skipped: true });
  }

  // 저장소별 커밋 그룹핑
  const repoMap = new Map<number, { repoName: string; commits: CommitRecord[] }>();
  for (const repo of mapping.repos) {
    repoMap.set(repo.id, {
      repoName: repo.label || `${repo.owner}/${repo.repo}`,
      commits: [],
    });
  }
  for (const c of cacheCommits) {
    const entry = repoMap.get(c.repositoryId);
    if (entry) {
      entry.commits.push({
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: c.committed_at,
        repoOwner: "",
        repoName: "",
        branch: c.branch,
        filesChanged: [],
        additions: 0,
        deletions: 0,
      });
    }
  }

  const repoCommits = Array.from(repoMap.values()).filter((r) => r.commits.length > 0);
  const allCommits = repoCommits.flatMap((r) => r.commits);
  const estimatedMinutes = estimateWorkMinutes(allCommits);

  try {
    const generated = await generateHrmsTaskContent(
      mapping.hrms_project_name,
      date,
      repoCommits,
      estimatedMinutes,
    );
    const title = generated.title;
    const description = generated.description;

    // force 모드: 기존 태스크 찾아서 update, 없으면 create
    let hrmsTaskId: number;
    let action: "created" | "updated";

    if (force) {
      // HRMS 서버에서 해당 날짜 태스크 검색 (로컬 로그보다 서버 우선)
      let existingTaskId: number | null = null;
      try {
        const tasks = await listTasks(apiKey, {
          projectId: mapping.hrms_project_id,
          dueFrom: date,
          dueTo: date,
        });
        if (tasks.length > 0) {
          existingTaskId = tasks[0].id;
        }
      } catch {
        // 검색 실패 시 로컬 로그 fallback
        const prevLog = getLastSuccessLog(db, mappingId, date);
        existingTaskId = prevLog?.hrms_task_id ?? null;
      }

      if (existingTaskId) {
        await updateTask(apiKey, {
          id: existingTaskId,
          title,
          description,
          status: "done",
          timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = existingTaskId;
        action = "updated";
      } else {
        const created = await createTask(apiKey, {
          title,
          description,
          projectId: mapping.hrms_project_id,
          assigneeId: keyRow.hrms_user_id ?? undefined,
          status: "done",
          priority: "medium",
          dueDate: date,
          timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = created.id;
        action = "created";
      }
    } else {
      const created = await createTask(apiKey, {
        title,
        description,
        projectId: mapping.hrms_project_id,
        assigneeId: keyRow.hrms_user_id ?? undefined,
        status: "done",
        priority: "medium",
        dueDate: date,
        timeSpentMinutes: estimatedMinutes,
      });
      hrmsTaskId = created.id;
      action = "created";
    }

    insertTaskLog(db, {
      mappingId,
      hrmsTaskId,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
    });

    return NextResponse.json({
      message: action === "updated" ? "Task updated" : "Task registered",
      hrmsTaskId,
      title,
      estimatedMinutes,
      action,
      syncResults,
    }, { status: 201 });
  } catch (err: any) {
    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "등록 실패",
      description: "",
      status: "error",
      errorMessage: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
