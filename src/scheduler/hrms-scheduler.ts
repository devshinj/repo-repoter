import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/infra/db/connection";
import {
  getAutoRegisterMappings,
  getMappingById,
  hasSuccessLog,
  getLastSuccessLog,
  insertTaskLog,
} from "@/infra/db/hrms";
import { getCommitsByDateRange } from "@/infra/db/repository";
import { decrypt } from "@/infra/crypto/token-encryption";
import { createTask, updateTask, listTasks } from "@/infra/hrms/hrms-client";
import { generateHrmsTaskContent } from "@/infra/gemini/gemini-client";
import { estimateWorkMinutes } from "@/core/analyzer/time-estimator";
import type { CommitRecord } from "@/core/types";

const jobs = new Map<number, ScheduledTask>();

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function executeRegistration(mappingId: number): Promise<void> {
  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping) return;

  const date = getYesterdayDate();

  if (hasSuccessLog(db, mappingId, date)) {
    console.log(`[HrmsScheduler] mapping=${mappingId}: already registered for ${date}, skipping`);
    return;
  }

  const keyRow = db.prepare("SELECT encrypted_key, hrms_user_id FROM hrms_api_keys WHERE user_id = ?").get(mapping.user_id) as any;
  if (!keyRow) {
    console.error(`[HrmsScheduler] mapping=${mappingId}: no API key for user`);
    return;
  }

  const repoIds = mapping.repos.map((r: any) => r.id);
  const cacheCommits = getCommitsByDateRange(db, repoIds, date, date) as any[];

  if (cacheCommits.length === 0) {
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

    insertTaskLog(db, {
      mappingId,
      hrmsTaskId: created.id,
      targetDate: date,
      title,
      description,
      status: "success",
      errorMessage: null,
    });

    console.log(`[HrmsScheduler] mapping=${mappingId}: registered task #${created.id} for ${date}`);
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
    console.error(`[HrmsScheduler] mapping=${mappingId}: failed -`, err.message);
  }
}

export function refreshJob(mappingId: number): void {
  const existing = jobs.get(mappingId);
  if (existing) {
    existing.stop();
    jobs.delete(mappingId);
  }

  const db = getDb();
  const mapping = getMappingById(db, mappingId);
  if (!mapping || !mapping.auto_register) return;

  const cronExpr = mapping.cron_time || "0 9 * * 1-5";
  const task = cron.schedule(cronExpr, () => {
    executeRegistration(mappingId).catch(console.error);
  });
  jobs.set(mappingId, task);
  console.log(`[HrmsScheduler] Job registered for mapping=${mappingId} (${cronExpr})`);
}

export function startHrmsScheduler(): void {
  const db = getDb();
  const mappings = getAutoRegisterMappings(db);

  for (const m of mappings) {
    const cronExpr = m.cron_time || "0 9 * * 1-5";
    const task = cron.schedule(cronExpr, () => {
      executeRegistration(m.id).catch(console.error);
    });
    jobs.set(m.id, task);
  }

  console.log(`[HrmsScheduler] Started — ${mappings.length} auto-register jobs`);
}

export function stopHrmsScheduler(): void {
  for (const [id, task] of jobs) {
    task.stop();
  }
  jobs.clear();
  console.log("[HrmsScheduler] Stopped");
}

export function refreshLogicraftJob(_mappingId: number): void {
  // Task 10에서 구현
}
