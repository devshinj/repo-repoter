// src/scheduler/report-scheduler.ts
import cron, { type ScheduledTask } from "node-cron";
import { getKstYesterday, kstCronOptions } from "@/core/date-utils";
import { getAutoReportEnabledRepos } from "@/infra/db/repository";
import { insertReport } from "@/infra/db/report";
import { generateReportContent } from "@/scheduler/report-generator";

let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRunAt: string | null = null;

function getYesterdayDate(): string {
  return getKstYesterday();
}

function formatAutoReportTitle(baseTitle: string): string {
  return `[자동 생성] ${baseTitle}`;
}

export function getReportSchedulerStatus() {
  return {
    isRunning,
    lastRunAt,
    scheduled: cronTask !== null,
    cronExpression: "0 9 * * *",
  };
}

export async function runDailyReportCycle(targetDate?: string): Promise<void> {
  if (isRunning) {
    console.log("[ReportScheduler] Already running, skipping");
    return;
  }

  isRunning = true;
  const date = targetDate ?? getYesterdayDate();

  try {
    const repos = await getAutoReportEnabledRepos();
    console.log(`[ReportScheduler] Generating daily reports for ${date} — ${repos.length} repos enabled`);

    for (const repo of repos) {
      try {
        const generated = await generateReportContent(repo, date);

        if (!generated) {
          console.log(`[ReportScheduler] ${repo.owner}/${repo.repo}: no commits on ${date}, skipped`);
          continue;
        }

        const displayName = repo.label || `${repo.owner}/${repo.repo}`;
        await insertReport({
          userId: repo.user_id,
          repositoryId: repo.id,
          project: displayName,
          date,
          title: formatAutoReportTitle(generated.title),
          content: generated.content,
          status: "completed",
        });

        console.log(`[ReportScheduler] ${repo.owner}/${repo.repo}: report created (${generated.commitCount} commits)`);
      } catch (err) {
        console.error(`[ReportScheduler] ${repo.owner}/${repo.repo}: failed -`, err);
      }
    }

    lastRunAt = new Date().toISOString();
  } finally {
    isRunning = false;
  }
}

export function startReportScheduler(): void {
  if (cronTask) {
    console.log("[ReportScheduler] Already scheduled");
    return;
  }

  cronTask = cron.schedule("0 9 * * *", () => {
    runDailyReportCycle().catch(console.error);
  }, kstCronOptions);

  console.log("[ReportScheduler] Started — runs daily at 09:00");
}

export function stopReportScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[ReportScheduler] Stopped");
  }
}
