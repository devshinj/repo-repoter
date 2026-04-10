"use client";

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/data-display/stat-card";
import { StatusIndicator } from "@/components/data-display/status-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { repoColor, oklch } from "@/lib/color-hash";
import { ContributionHeatmap } from "@/components/data-display/contribution-heatmap";
import { LanguageBadge } from "@/components/data-display/language-badge";

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

export default function DashboardPage() {
  const [repos, setRepos] = useState<any[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});

  const refreshData = useCallback(() => {
    fetch("/api/repos").then((r) => r.json()).then(setRepos);
    fetch("/api/cron").then((r) => r.json()).then(setSchedulerStatus);
    fetch("/api/commits/heatmap?months=6").then((r) => r.json()).then((d) => setHeatmapData(d.data || {}));
  }, []);

  useEffect(() => {
    refreshData();
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

  const lastSync = schedulerStatus?.lastRunAt
    ? formatRelativeDate(schedulerStatus.lastRunAt)
    : null;

  const scheduler = getSchedulerState(schedulerStatus);
  const styles = schedulerStateStyles[scheduler.state];

  return (
    <div>
      <Header
        title="대시보드"
        description="Git 커밋 모니터링 현황"
        actions={
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? "동기화 중..." : "지금 동기화"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="등록된 저장소" value={repos.length} />
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground">스케줄러</p>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${styles.dot}`} />
              <p className={`text-lg font-semibold ${styles.text}`}>{scheduler.label}</p>
            </div>
            {scheduler.description && (
              <p className="text-sm text-muted-foreground mt-1">{scheduler.description}</p>
            )}
          </CardContent>
        </Card>
        <StatCard
          label="마지막 동기화"
          value={lastSync?.relative ?? "없음"}
          description={lastSync?.detail}
        />
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
                const color = repoColor(repo.clone_url);
                return (
                  <div key={repo.id} className="flex items-center justify-between py-2 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: oklch(color.solid) }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{repo.owner}/{repo.repo}</p>
                          <LanguageBadge language={repo.primary_language} />
                        </div>
                        <p className="text-sm text-muted-foreground">브랜치: {repo.branch}</p>
                      </div>
                    </div>
                    <StatusIndicator status={repo.is_active ? "success" : "idle"} label={repo.is_active ? "활성" : "비활성"} />
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
