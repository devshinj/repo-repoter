// src/instrumentation.ts — src/app 구조에서는 반드시 src/ 아래에 있어야 빌드에 포함된다
export async function register() {
  // 서버 사이드에서만 스케줄러 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { waitForDb, initDb } = await import("@/infra/db/connection");
      // 서버 재부팅 시 DB 컨테이너가 늦게 뜨는 경우 대비 — 연결될 때까지 대기
      await waitForDb();
      await initDb();

      const { startScheduler } = await import("@/scheduler/polling-manager");
      const { startReportScheduler } = await import("@/scheduler/report-scheduler");
      const { startHrmsScheduler } = await import("@/scheduler/hrms-scheduler");
      const { startFeedScheduler } = await import("@/scheduler/feed-scheduler");
      startScheduler(15);
      startReportScheduler();
      await startHrmsScheduler().catch((err) => {
        console.error("[Instrumentation] HRMS scheduler failed:", err instanceof Error ? err.message : err);
      });
      startFeedScheduler();
      console.log("[Instrumentation] All schedulers started");
    } catch (err) {
      // 실패를 반드시 로그로 남긴다 (이전에는 재부팅 후 스케줄러 미기동이 무로그로 지나감)
      console.error("[Instrumentation] Startup failed — schedulers NOT running:", err);
      throw err;
    }
  }
}
