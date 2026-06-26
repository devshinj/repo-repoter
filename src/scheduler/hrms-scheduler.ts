import cron, { type ScheduledTask } from "node-cron";
import { getKstYesterday, kstCronOptions } from "@/core/date-utils";
import {
  getAutoRegisterMappings,
  getMappingById,
  hasSuccessLog,
  getLastSuccessLog,
  insertTaskLog,
} from "@/infra/db/hrms";
import {
  getAutoRegisterLogicraftMappings,
  getLogicraftMappingById,
  getLogicraftApiKey,
  hasLogicraftSuccessLog,
  insertLogicraftTaskLog,
} from "@/infra/db/logicraft";
import { getCommitsByDateRange, getRepoLastSyncAt } from "@/infra/db/repository";
import { sql } from "@/infra/db/connection";
import { syncOneRepo } from "@/scheduler/polling-manager";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskContent, generateLogicraftTaskContent } from "@/infra/llm/llm-client";
import { listItems, listProposals, activityItemTypes } from "@/infra/logicraft/logicraft-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord, LogicraftItemSummary, LogicraftProposal } from "@/core/types";

const jobs = new Map<number, ScheduledTask>();
const logicraftJobs = new Map<number, ScheduledTask>();

function getYesterdayDate(): string {
  return getKstYesterday();
}

async function executeRegistration(mappingId: number): Promise<void> {
  const mapping = await getMappingById(mappingId);
  if (!mapping) return;

  const date = getYesterdayDate();

  const [keyRow] = await sql`SELECT encrypted_key, hrms_user_id FROM hrms_api_keys WHERE user_id = ${mapping.user_id}` as any[];
  if (!keyRow) {
    await insertTaskLog({
      mappingId, hrmsTaskId: null, targetDate: date,
      title: "등록 실패", description: "",
      status: "error", errorMessage: "HRMS API key not registered",
      triggerType: "auto",
    });
    console.error(`[HrmsScheduler] mapping=${mappingId}: no API key for user`);
    return;
  }

  // 중복 체크: 로컬 성공 로그 + HRMS 실제 존재 여부 모두 확인
  if (await hasSuccessLog(mappingId, date)) {
    try {
      const hrmsApiKey = decrypt(keyRow.encrypted_key);
      const tasks = await listTasks(hrmsApiKey, {
        projectId: mapping.hrms_project_id,
        dueFrom: date,
        dueTo: date,
      });
      if (tasks.length > 0) {
        console.log(`[HrmsScheduler] mapping=${mappingId}: already registered for ${date}, skipping`);
        return;
      }
      console.log(`[HrmsScheduler] mapping=${mappingId}: local log exists for ${date} but not in HRMS, re-registering`);
    } catch {
      console.log(`[HrmsScheduler] mapping=${mappingId}: already registered for ${date}, skipping (HRMS check failed)`);
      return;
    }
  }

  // ── 동기화 단계: 최근 5분 이내 동기화 안 된 저장소만 sync ──
  const syncThresholdMs = 5 * 60 * 1000;
  const failedRepos: string[] = [];
  for (const repo of mapping.repos) {
    const repoLabel = repo.label || `${repo.owner}/${repo.repo}`;
    const lastSync = await getRepoLastSyncAt(repo.id);
    if (lastSync && Date.now() - new Date(lastSync).getTime() < syncThresholdMs) {
      continue;
    }
    try {
      const result = await syncOneRepo(mapping.user_id, repo);
      if (result === null) {
        failedRepos.push(repoLabel);
        console.warn(`[HrmsScheduler] mapping=${mappingId}: sync conflict for ${repoLabel}, skipping repo`);
      }
    } catch (err) {
      failedRepos.push(repoLabel);
      console.error(`[HrmsScheduler] mapping=${mappingId}: sync failed for ${repoLabel} -`, err instanceof Error ? err.message : err);
    }
  }

  if (failedRepos.length === mapping.repos.length) {
    await insertTaskLog({
      mappingId, hrmsTaskId: null, targetDate: date,
      title: "등록 실패", description: "",
      status: "error", errorMessage: `All repos sync failed: ${failedRepos.join(", ")}`,
      triggerType: "auto",
    });
    console.error(`[HrmsScheduler] mapping=${mappingId}: all repos failed to sync, aborting`);
    return;
  }

  if (failedRepos.length > 0) {
    console.warn(`[HrmsScheduler] mapping=${mappingId}: ${failedRepos.length} repo(s) failed, continuing with remaining`);
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const allAuthors: string[] = [];
  for (const repo of mapping.repos) {
    if (repo.git_author) {
      const authors = repo.git_author.split(",").map((a: string) => a.trim()).filter(Boolean);
      allAuthors.push(...authors);
    }
  }
  const cacheCommits = await getCommitsByDateRange(
    repoIds, date, date,
    allAuthors.length > 0 ? allAuthors : undefined,
  ) as any[];

  if (cacheCommits.length === 0) {
    await insertTaskLog({
      mappingId, hrmsTaskId: null, targetDate: date,
      title: "건너뜀", description: "",
      status: "skipped", errorMessage: failedRepos.length > 0
        ? `No commits found (sync failed: ${failedRepos.join(", ")})`
        : null,
      triggerType: "auto",
    });
    console.log(`[HrmsScheduler] mapping=${mappingId}: no commits on ${date}, skipping`);
    return;
  }

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
        date: c.committedAt,
        repoOwner: "",
        repoName: "",
        branch: c.branch,
        filesChanged: c.filesChanged,
        additions: c.additions,
        deletions: c.deletions,
      });
    }
  }

  const repoCommits = Array.from(repoMap.values()).filter((r) => r.commits.length > 0);
  const allCommits = repoCommits.flatMap((r) => r.commits);
  const estimatedMinutes = estimateWorkMinutes(allCommits);

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const generated = await generateHrmsTaskContent(
      mapping.hrms_project_name,
      date,
      repoCommits,
      estimatedMinutes,
    );
    const title = generated.title;
    const description = generated.description;

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

    await insertTaskLog({
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
      triggerType: "auto",
    });

    console.log(`[HrmsScheduler] mapping=${mappingId}: registered task #${created.id} for ${date}`);
  } catch (err: any) {
    await insertTaskLog({
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "등록 실패",
      description: "",
      status: "error",
      errorMessage: err.message,
      triggerType: "auto",
    });
    console.error(`[HrmsScheduler] mapping=${mappingId}: failed -`, err.message);
  }
}

export function refreshJob(mappingId: number): void {
  const existing = jobs.get(mappingId);
  if (existing) {
    existing.stop();
    jobs.delete(mappingId);
  }

  // Async job initialization — fetch mapping and schedule
  (async () => {
    const mapping = await getMappingById(mappingId);
    if (!mapping || !mapping.auto_register) return;

    const cronExpr = mapping.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeRegistration(mappingId).catch(console.error);
    }, kstCronOptions);
    jobs.set(mappingId, task);
    console.log(`[HrmsScheduler] Job registered for mapping=${mappingId} (${cronExpr})`);
  })().catch(console.error);
}

export async function startHrmsScheduler(): Promise<void> {
  const mappings = await getAutoRegisterMappings();

  for (const m of mappings) {
    const cronExpr = m.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeRegistration(m.id).catch(console.error);
    }, kstCronOptions);
    jobs.set(m.id, task);
  }

  // LogiCraft 자동 등록 매핑
  const lcMappings = await getAutoRegisterLogicraftMappings();
  for (const m of lcMappings) {
    const cronExpr = m.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeLogicraftRegistration(m.id).catch(console.error);
    }, kstCronOptions);
    logicraftJobs.set(m.id, task);
  }

  console.log(`[HrmsScheduler] Started — ${mappings.length} repo + ${lcMappings.length} LogiCraft auto-register jobs`);
}

export function stopHrmsScheduler(): void {
  for (const [, task] of jobs) {
    task.stop();
  }
  jobs.clear();
  for (const [, task] of logicraftJobs) {
    task.stop();
  }
  logicraftJobs.clear();
  console.log("[HrmsScheduler] Stopped");
}

function isOnDate(isoTimestamp: string, targetDate: string): boolean {
  return isoTimestamp.startsWith(targetDate);
}

async function executeLogicraftRegistration(mappingId: number): Promise<void> {
  const mapping = await getLogicraftMappingById(mappingId);
  if (!mapping) return;

  const date = getYesterdayDate();

  const logicraftKeyRow = await getLogicraftApiKey(mapping.user_id);
  const [hrmsKeyRow] = await sql`SELECT encrypted_key, hrms_user_id FROM hrms_api_keys WHERE user_id = ${mapping.user_id}` as any[];

  if (!logicraftKeyRow || !hrmsKeyRow) {
    console.error(`[HrmsScheduler] logicraft mapping=${mappingId}: missing API keys`);
    return;
  }

  const logicraftApiKey = decrypt(logicraftKeyRow.encrypted_key);
  const hrmsApiKey = decrypt(hrmsKeyRow.encrypted_key);

  // 중복 체크: 로컬 성공 로그 + HRMS 실제 존재 여부 모두 확인
  if (await hasLogicraftSuccessLog(mappingId, date)) {
    try {
      const tasks = await listTasks(hrmsApiKey, {
        projectId: mapping.hrms_project_id,
        dueFrom: date,
        dueTo: date,
      });
      if (tasks.length > 0) {
        console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: already registered for ${date}, skipping`);
        return;
      }
      console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: local log exists for ${date} but not in HRMS, re-registering`);
    } catch {
      console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: already registered for ${date}, skipping (HRMS check failed)`);
      return;
    }
  }

  // LogiCraft 활동 수집
  const modifiedItems: LogicraftItemSummary[] = [];
  for (const type of activityItemTypes) {
    try {
      const items = await listItems(logicraftApiKey, mapping.logicraft_project_id, type, { limit: 200 });
      modifiedItems.push(...items.filter((item) => isOnDate(item.last_updated_at, date)));
    } catch { /* 타입별 조회 실패 무시 */ }
  }

  let proposals: LogicraftProposal[] = [];
  try {
    const allProposals = await listProposals(logicraftApiKey, mapping.logicraft_project_id);
    proposals = allProposals.filter(
      (p) => isOnDate(p.createdAt, date) || (p.resolvedAt && isOnDate(p.resolvedAt, date)),
    );
  } catch { /* 무시 */ }

  if (modifiedItems.length === 0 && proposals.length === 0) {
    console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: no activity on ${date}, skipping`);
    return;
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

    const created = await createTask(hrmsApiKey, {
      title,
      description,
      projectId: mapping.hrms_project_id,
      assigneeId: hrmsKeyRow.hrms_user_id ?? undefined,
      status: "done",
      priority: "medium",
      dueDate: date,
      timeSpentMinutes: estimatedMinutes,
    });

    await insertLogicraftTaskLog({
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
      triggerType: "auto",
    });

    console.log(`[HrmsScheduler] logicraft mapping=${mappingId}: registered task #${created.id} for ${date}`);
  } catch (err: any) {
    await insertLogicraftTaskLog({
      mappingId,
      hrmsTaskId: null,
      targetDate: date,
      title: "등록 실패",
      description: "",
      status: "error",
      errorMessage: err.message,
      triggerType: "auto",
    });
    console.error(`[HrmsScheduler] logicraft mapping=${mappingId}: failed -`, err.message);
  }
}

export function refreshLogicraftJob(mappingId: number): void {
  const existing = logicraftJobs.get(mappingId);
  if (existing) {
    existing.stop();
    logicraftJobs.delete(mappingId);
  }

  // Async job initialization
  (async () => {
    const mapping = await getLogicraftMappingById(mappingId);
    if (!mapping || !mapping.auto_register) return;

    const cronExpr = mapping.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeLogicraftRegistration(mappingId).catch(console.error);
    }, kstCronOptions);
    logicraftJobs.set(mappingId, task);
    console.log(`[HrmsScheduler] LogiCraft job registered for mapping=${mappingId} (${cronExpr})`);
  })().catch(console.error);
}
