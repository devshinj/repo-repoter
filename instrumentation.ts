// instrumentation.ts (프로젝트 루트)
export async function register() {
  // 서버 사이드에서만 스케줄러 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initDb } = await import("@/infra/db/connection");
    await initDb();

    const { startScheduler } = await import("@/scheduler/polling-manager");
    const { startReportScheduler } = await import("@/scheduler/report-scheduler");
    const { startHrmsScheduler } = await import("@/scheduler/hrms-scheduler");
    const { startFeedScheduler } = await import("@/scheduler/feed-scheduler");
    startScheduler(15);
    startReportScheduler();
    await startHrmsScheduler();
    startFeedScheduler();
  }
}
