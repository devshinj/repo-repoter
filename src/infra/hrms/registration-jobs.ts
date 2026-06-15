/**
 * HRMS 등록 작업의 in-memory 레지스트리.
 * SSE 스트림을 통해 클라이언트에 실시간 진행 상태를 전달한다.
 * 단일 인스턴스(SQLite) 환경 전제.
 */

export type JobStep =
  | "pending"
  | "syncing"
  | "generating"
  | "registering"
  | "done"
  | "error";

export interface JobEvent {
  step: JobStep;
  message: string;
  detail?: string;
  /** syncing 단계에서 현재/전체 저장소 인덱스 */
  repoIndex?: number;
  repoTotal?: number;
  /** 최종 결과 (done 단계) */
  result?: {
    hrmsTaskId: number;
    title: string;
    estimatedMinutes: number;
    action: "created" | "updated";
  };
  /** 에러 메시지 (error 단계) */
  error?: string;
}

type Listener = (event: JobEvent) => void;

interface Job {
  mappingId: number;
  targetDate: string;
  logId: number;
  events: JobEvent[];
  listeners: Set<Listener>;
  finished: boolean;
}

const jobs = new Map<number, Job>();

/** 작업 시작. logId = hrms_task_logs.id (in_progress 상태로 미리 삽입한 행) */
export function createJob(logId: number, mappingId: number, targetDate: string): void {
  jobs.set(logId, {
    mappingId,
    targetDate,
    logId,
    events: [],
    listeners: new Set(),
    finished: false,
  });
}

/** 진행 이벤트 발행 */
export function emitJobEvent(logId: number, event: JobEvent): void {
  const job = jobs.get(logId);
  if (!job) return;
  job.events.push(event);
  if (event.step === "done" || event.step === "error") {
    job.finished = true;
  }
  for (const listener of job.listeners) {
    try { listener(event); } catch { /* 끊어진 연결 무시 */ }
  }
  // 완료 후 5분 뒤 정리
  if (job.finished) {
    setTimeout(() => jobs.delete(logId), 5 * 60 * 1000);
  }
}

/** SSE 구독 등록. 이미 발생한 이벤트도 즉시 재생(replay) */
export function subscribeJob(logId: number, listener: Listener): (() => void) | null {
  const job = jobs.get(logId);
  if (!job) return null;
  // 과거 이벤트 재생
  for (const event of job.events) {
    try { listener(event); } catch { /* ignore */ }
  }
  if (job.finished) return () => {};
  job.listeners.add(listener);
  return () => { job.listeners.delete(listener); };
}

/** 특정 매핑의 진행 중인 작업 조회 */
export function getActiveJobForMapping(mappingId: number): { logId: number; events: JobEvent[] } | null {
  for (const [logId, job] of jobs) {
    if (job.mappingId === mappingId && !job.finished) {
      return { logId, events: job.events };
    }
  }
  return null;
}

/** 사용자의 모든 활성 작업 조회 (mappingIds 기준) */
export function getActiveJobs(mappingIds: number[]): { logId: number; mappingId: number; events: JobEvent[] }[] {
  const idSet = new Set(mappingIds);
  const result: { logId: number; mappingId: number; events: JobEvent[] }[] = [];
  for (const [logId, job] of jobs) {
    if (idSet.has(job.mappingId) && !job.finished) {
      result.push({ logId, mappingId: job.mappingId, events: job.events });
    }
  }
  return result;
}
