"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/data-display/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { repoColor } from "@/lib/color-hash";
import { ContributionHeatmap } from "@/components/data-display/contribution-heatmap";
import { DotIdenticon } from "@/components/data-display/dot-identicon";
import { LanguageBadge } from "@/components/data-display/language-badge";
import { RefreshCw } from "lucide-react";

function parseUTC(value: string): Date {
  // SQLite datetime('now')는 "2026-04-10 06:30:00" 형식(UTC, Z 없음)
  const normalized = value.includes("T") || value.endsWith("Z") ? value : value.replace(" ", "T") + "Z";
  return new Date(normalized);
}

function formatRelativeDate(isoString: string): { relative: string; detail: string } {
  const date = parseUTC(isoString);
  const now = new Date();

  const kstOptions = { timeZone: "Asia/Seoul" } as const;
  const todayKST = new Date(now.toLocaleDateString("en-CA", kstOptions));
  const targetKST = new Date(date.toLocaleDateString("en-CA", kstOptions));
  const diffDays = Math.floor((todayKST.getTime() - targetKST.getTime()) / (1000 * 60 * 60 * 24));

  const detail = date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffDays === 0) return { relative: "오늘", detail };
  if (diffDays === 1) return { relative: "어제", detail };
  return { relative: `${diffDays}일 전`, detail };
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - parseUTC(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 전`;
}

type SchedulerState = "running" | "healthy" | "error" | "stopped" | "idle";

function getSchedulerState(status: any): {
  state: SchedulerState;
  label: string;
  description: string;
} {
  if (!status) return { state: "idle", label: "로딩 중", description: "" };

  const summary = status.syncSummary;

  // 동기화 진행 중
  if (status.isRunning) {
    const desc = status.syncStartedAt ? `시작: ${formatTimeAgo(status.syncStartedAt)}` : "";
    return { state: "running", label: "동기화 중...", description: desc };
  }

  // 최근 에러가 있고, 마지막 성공보다 최신인 경우
  if (summary?.lastErrorAt) {
    const lastError = parseUTC(summary.lastErrorAt).getTime();
    const lastSuccess = summary.lastSuccessAt ? parseUTC(summary.lastSuccessAt).getTime() : 0;
    if (lastError > lastSuccess) {
      return {
        state: "error",
        label: "오류 발생",
        description: summary.lastErrorMessage
          ? `${summary.lastErrorMessage.slice(0, 40)}`
          : `마지막 실패: ${formatTimeAgo(summary.lastErrorAt)}`,
      };
    }
  }

  // 정상
  if (summary?.lastSuccessAt) {
    const commitsInfo = summary.totalCommitsProcessed > 0
      ? `최근 24시간: ${summary.totalCommitsProcessed}커밋 처리`
      : "최근 24시간: 새 커밋 없음";
    return {
      state: "healthy",
      label: `정상 · ${status.intervalMin}분 간격`,
      description: commitsInfo,
    };
  }

  // 동기화 기록 없음
  return { state: "idle", label: "대기", description: "아직 동기화 기록 없음" };
}

const schedulerStateStyles: Record<SchedulerState, { dot: string; text: string }> = {
  running: { dot: "bg-blue-500 animate-pulse", text: "text-blue-600 dark:text-blue-400" },
  healthy: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  stopped: { dot: "bg-gray-400", text: "text-gray-500 dark:text-gray-400" },
  idle: { dot: "bg-gray-400", text: "text-muted-foreground" },
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "🌙 늦은 밤이에요";
  if (hour < 12) return "☀️ 좋은 아침이에요";
  if (hour < 18) return "🌤️ 좋은 오후에요";
  return "👋 수고하셨어요";
}

interface DashboardStats {
  todayCommits: number;
  weekCommits: number;
  totalReports: number;
  repoCount: number;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const userName = session?.user?.name;
  const [repos, setRepos] = useState<any[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [stats, setStats] = useState<DashboardStats>({ todayCommits: 0, weekCommits: 0, totalReports: 0, repoCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [syncingRepoId, setSyncingRepoId] = useState<number | null>(null);
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});
  const [initialLoading, setInitialLoading] = useState(true);

  const refreshData = useCallback(() => {
    return Promise.all([
      fetch("/api/repos").then((r) => r.json()).then(setRepos),
      fetch("/api/cron").then((r) => r.json()).then(setSchedulerStatus),
      fetch("/api/commits/heatmap?months=6").then((r) => r.json()).then((d) => setHeatmapData(d.data || {})),
      fetch("/api/dashboard/stats").then((r) => r.json()).then(setStats),
    ]);
  }, []);

  useEffect(() => {
    refreshData().finally(() => setInitialLoading(false));
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        toast.success("동기화 완료");
        refreshData();
      } else {
        const data = await res.json();
        toast.error(data.error || "동기화 실패");
      }
    } catch {
      toast.error("동기화 중 오류 발생");
    } finally {
      setSyncing(false);
    }
  };

  const handleRepoSync = async (repoId: number) => {
    setSyncingRepoId(repoId);
    try {
      const res = await fetch(`/api/repos/${repoId}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`동기화 완료 — ${data.commitsProcessed}건 처리`);
        refreshData();
      } else {
        toast.error(data.error || "동기화 실패");
      }
    } catch {
      toast.error("동기화 중 오류 발생");
    } finally {
      setSyncingRepoId(null);
    }
  };

  const lastSync = schedulerStatus?.lastRunAt
    ? formatRelativeDate(schedulerStatus.lastRunAt)
    : null;

  const scheduler = getSchedulerState(schedulerStatus);
  const styles = schedulerStateStyles[scheduler.state];

  if (initialLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-4 w-48 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg" />
          ))}
        </div>
        <div className="h-32 bg-muted rounded-lg" />
        <div className="h-48 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div>
      <Header
        title={userName ? `${getGreeting()}, ${userName}님` : "대시보드"}
        description="Git 커밋 모니터링 현황"
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border" title={scheduler.description || undefined}>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
              <span className={`text-sm font-medium ${styles.text}`}>{scheduler.label}</span>
              {lastSync && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground" title={lastSync.detail}>
                    {lastSync.relative}
                  </span>
                </>
              )}
            </div>
            <Button onClick={handleSync} disabled={syncing} size="sm">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "지금 동기화"}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="오늘 커밋" value={stats.todayCommits} />
        <StatCard label="이번 주 커밋" value={stats.weekCommits} description="최근 7일" />
        <StatCard label="생성된 리포트" value={stats.totalReports} />
        <StatCard label="등록 저장소" value={stats.repoCount} />
      </div>

      <div className="mb-6">
        <ContributionHeatmap data={heatmapData} months={6} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold mb-4">등록된 저장소</h2>
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 저장소가 없습니다. 저장소 관리에서 추가하세요.</p>
          ) : (
            <div className="space-y-3">
              {repos.map((repo: any) => {
                const isSyncing = syncingRepoId === repo.id;
                const lastCommitTime = repo.last_commit_at
                  ? formatRelativeDate(repo.last_commit_at)
                  : null;
                const lastSyncTime = repo.last_sync_at
                  ? { relative: formatTimeAgo(repo.last_sync_at), detail: formatRelativeDate(repo.last_sync_at).detail }
                  : null;
                return (
                  <div key={repo.id} className="flex items-center justify-between py-3 border-b border-border">
                    <div className="flex items-center gap-3 min-w-0">
                      <DotIdenticon value={`${repo.owner}/${repo.repo}`} size={32} colorSet={repoColor(repo.clone_url)} className="flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{repo.label || `${repo.owner}/${repo.repo}`}</p>
                          <LanguageBadge language={repo.primary_language} />
                        </div>
                        {repo.label && (
                          <p className="text-xs text-muted-foreground">{repo.owner}/{repo.repo}</p>
                        )}
                        {repo.last_commit_message ? (
                          <p className="text-sm text-muted-foreground truncate max-w-md" title={repo.last_commit_message}>
                            {repo.last_commit_message}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">커밋 없음</p>
                        )}
                        {lastCommitTime && (
                          <p className="text-xs text-muted-foreground mt-0.5" title={lastCommitTime.detail}>
                            마지막 커밋: {lastCommitTime.relative}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRepoSync(repo.id)}
                        disabled={isSyncing}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                        {isSyncing ? "동기화 중..." : "동기화"}
                      </Button>
                      {lastSyncTime && (
                        <span className="text-xs text-muted-foreground" title={lastSyncTime.detail}>
                          {lastSyncTime.relative}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
