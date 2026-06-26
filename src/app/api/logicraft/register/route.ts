import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHrmsApiKey } from "@/infra/db/hrms";
import {
  getLogicraftApiKey,
  getLogicraftMappingById,
  hasLogicraftSuccessLog,
  getLastLogicraftSuccessLog,
  insertLogicraftTaskLog,
} from "@/infra/db/logicraft";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { listItems, listProposals, activityItemTypes } from "@/infra/logicraft/logicraft-client";
import { generateLogicraftTaskContent } from "@/infra/llm/llm-client";
import type { LogicraftItemSummary, LogicraftProposal } from "@/core/types";
import { getKstYesterday } from "@/core/date-utils";

function isOnDate(isoTimestamp: string, targetDate: string): boolean {
  return isoTimestamp.startsWith(targetDate);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { mappingId, targetDate, force } = body;

  if (!mappingId) {
    return NextResponse.json({ error: "mappingId is required" }, { status: 400 });
  }

  const mapping = await getLogicraftMappingById(mappingId);
  if (!mapping || mapping.user_id !== session.user.id) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const hrmsKeyRow = await getHrmsApiKey(session.user.id);
  if (!hrmsKeyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const logicraftKeyRow = await getLogicraftApiKey(session.user.id);
  if (!logicraftKeyRow) {
    return NextResponse.json({ error: "LogiCraft API key not registered" }, { status: 400 });
  }

  const date = targetDate ?? getKstYesterday();
  const hrmsApiKey = decrypt(hrmsKeyRow.encrypted_key);
  const logicraftApiKey = decrypt(logicraftKeyRow.encrypted_key);

  // 중복 체크
  if (await hasLogicraftSuccessLog(mappingId, date) && !force) {
    let existsInHrms = false;
    try {
      const tasks = await listTasks(hrmsApiKey, {
        projectId: mapping.hrms_project_id,
        dueFrom: date,
        dueTo: date,
      });
      existsInHrms = tasks.length > 0;
    } catch { /* HRMS 조회 실패 시 로컬 기록 기준 */ }

    if (existsInHrms) {
      return NextResponse.json({ duplicate: true, date }, { status: 200 });
    }
  }

  // LogiCraft 활동 수집
  const modifiedItems: LogicraftItemSummary[] = [];
  for (const type of activityItemTypes) {
    try {
      const items = await listItems(logicraftApiKey, mapping.logicraft_project_id, type, { limit: 200 });
      const filtered = items.filter((item) => isOnDate(item.last_updated_at, date));
      modifiedItems.push(...filtered);
    } catch { /* 타입별 조회 실패 무시 */ }
  }

  let proposals: LogicraftProposal[] = [];
  try {
    const allProposals = await listProposals(logicraftApiKey, mapping.logicraft_project_id);
    proposals = allProposals.filter(
      (p) => isOnDate(p.createdAt, date) || (p.resolvedAt && isOnDate(p.resolvedAt, date)),
    );
  } catch { /* 제안 조회 실패 무시 */ }

  if (modifiedItems.length === 0 && proposals.length === 0) {
    await insertLogicraftTaskLog({
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "skip",
      description: "활동 없음",
      status: "error",
      errorMessage: "No LogiCraft activity found for target date",
    });
    return NextResponse.json({ message: "No activity found", skipped: true });
  }

  try {
    const generated = await generateLogicraftTaskContent(
      mapping.hrms_project_name,
      mapping.logicraft_project_name,
      date,
      modifiedItems,
      proposals,
    );
    const { title, description } = generated;
    const estimatedMinutes = Math.max(60, Math.min(480, (modifiedItems.length + proposals.length) * 30));

    let hrmsTaskId: number;
    let action: "created" | "updated";

    if (force) {
      let existingTaskId: number | null = null;
      try {
        const tasks = await listTasks(hrmsApiKey, {
          projectId: mapping.hrms_project_id,
          dueFrom: date,
          dueTo: date,
        });
        if (tasks.length > 0) existingTaskId = tasks[0].id;
      } catch {
        const prevLog = await getLastLogicraftSuccessLog(mappingId, date);
        existingTaskId = prevLog?.hrms_task_id ?? null;
      }

      if (existingTaskId) {
        await updateTask(hrmsApiKey, { id: existingTaskId, title, description, status: "done", timeSpentMinutes: estimatedMinutes });
        hrmsTaskId = existingTaskId;
        action = "updated";
      } else {
        const created = await createTask(hrmsApiKey, {
          title, description, projectId: mapping.hrms_project_id,
          assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
          status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
        });
        hrmsTaskId = created.id;
        action = "created";
      }
    } else {
      const created = await createTask(hrmsApiKey, {
        title, description, projectId: mapping.hrms_project_id,
        assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
        status: "done", priority: "medium", dueDate: date, timeSpentMinutes: estimatedMinutes,
      });
      hrmsTaskId = created.id;
      action = "created";
    }

    await insertLogicraftTaskLog({
      mappingId, hrmsTaskId, targetDate: date, title, description, status: "success", errorMessage: null,
    });

    return NextResponse.json({ message: action === "updated" ? "Task updated" : "Task registered", hrmsTaskId, title, estimatedMinutes, action }, { status: 201 });
  } catch (err: any) {
    await insertLogicraftTaskLog({
      mappingId, hrmsTaskId: null, targetDate: date, title: "등록 실패", description: "", status: "error", errorMessage: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
