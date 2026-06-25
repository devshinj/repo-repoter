"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { StatusPanel } from "@/components/feed/status-panel";
import { NewsfeedPanel } from "@/components/feed/newsfeed-panel";
import { MilestoneDialog } from "@/components/feed/milestone-dialog";
import { api } from "@/lib/api-url";
import { calcStreak, calcInactiveDays } from "@/components/growth-tree/hooks/use-tree-metrics";
import type { TreeMetrics, DashboardStats } from "@/core/types";
import type { FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";
import type { Project, Milestone } from "@/core/project/project-types";

// ---------------------------------------------------------------------------
// Utility helpers (KST-aware date/time formatting)
// ---------------------------------------------------------------------------

function parseUTC(value: string): Date {
  // SQLite datetime('now') returns "2026-04-10 06:30:00" (UTC, no Z suffix)
  const normalized =
    value.includes("T") || value.endsWith("Z")
      ? value
      : value.replace(" ", "T") + "Z";
  return new Date(normalized);
}

function formatRelativeDate(isoString: string): { relative: string; detail: string } {
  const date = parseUTC(isoString);
  const now = new Date();

  const kstOptions = { timeZone: "Asia/Seoul" } as const;
  const todayKST = new Date(now.toLocaleDateString("en-CA", kstOptions));
  const targetKST = new Date(date.toLocaleDateString("en-CA", kstOptions));
  const diffDays = Math.floor(
    (todayKST.getTime() - targetKST.getTime()) / (1000 * 60 * 60 * 24)
  );

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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "🌙 늦은 밤이에요";
  if (hour < 12) return "☀️ 좋은 아침이에요";
  if (hour < 18) return "🌤️ 좋은 오후에요";
  return "👋 수고하셨어요";
}

// Keep formatRelativeDate/formatTimeAgo in scope to avoid TS unused-var errors
void formatRelativeDate;
void formatTimeAgo;

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { data: session } = useSession();
  const userName = session?.user?.name;

  // Stats & heatmap (60-second polling)
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});
  const [repos, setRepos] = useState<Array<{ id: number; owner: string; repo: string; primary_language: string | null; label?: string }>>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Feed state (refresh-on-mount, not polling)
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Milestone dialog state
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [milestoneInitialInput, setMilestoneInitialInput] = useState("");
  const [milestonePreselectedScope, setMilestonePreselectedScope] = useState<{
    type: "project" | "repository";
    id: number;
    name: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Stats / heatmap polling
  // ---------------------------------------------------------------------------
  const refreshStats = useCallback(async () => {
    try {
      await Promise.all([
        fetch(api("/repos"))
          .then((r) => r.json())
          .then(setRepos),
        fetch(api("/commits/heatmap?months=6"))
          .then((r) => r.json())
          .then((d) => setHeatmapData(d.data ?? {})),
        fetch(api("/dashboard/stats"))
          .then((r) => r.json())
          .then(setStats),
      ]);
      setSyncError(null);
    } catch {
      setSyncError("데이터를 불러오는 데 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  useEffect(() => {
    refreshStats().finally(() => setInitialLoading(false));

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(refreshStats, 60_000);
    };
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshStats();
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshStats]);

  // ---------------------------------------------------------------------------
  // Feed: refresh-on-mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const loadFeed = async () => {
      try {
        // 1. 캐시된 데이터 즉시 표시
        const [feedRes, projectsRes, milestonesRes] = await Promise.all([
          fetch(api("/feed")),
          fetch(api("/projects")),
          fetch(api("/milestones")),
        ]);
        const [feedData, projectsData, milestonesData] = await Promise.all([
          feedRes.json(),
          projectsRes.json(),
          milestonesRes.json(),
        ]);
        setFeedEntries(Array.isArray(feedData) ? feedData : feedData.entries ?? []);
        setProjects(Array.isArray(projectsData) ? projectsData : projectsData.projects ?? []);
        setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
      } catch {
        // Feed errors are non-critical — don't set syncError
      } finally {
        setInitialLoading(false);
      }

      // 2. 백그라운드에서 새 브리핑 수집 후 갱신
      setIsRefreshing(true);
      try {
        await fetch(api("/feed/refresh"), { method: "POST" });
        const freshRes = await fetch(api("/feed"));
        const freshData = await freshRes.json();
        setFeedEntries(Array.isArray(freshData) ? freshData : freshData.entries ?? []);
      } catch {
        // 백그라운드 갱신 실패는 무시
      } finally {
        setIsRefreshing(false);
      }
    };

    loadFeed();
  }, []);

  // ---------------------------------------------------------------------------
  // Scope names map: "project:1" → project name, "repository:3" → "owner/repo"
  // ---------------------------------------------------------------------------
  const scopeNames = new Map<string, string>();
  for (const project of projects) {
    scopeNames.set(`project:${project.id}`, project.name);
  }
  for (const repo of repos) {
    scopeNames.set(`repository:${repo.id}`, repo.label || `${repo.owner}/${repo.repo}`);
  }

  // ---------------------------------------------------------------------------
  // Tree metrics
  // ---------------------------------------------------------------------------
  const treeMetrics: TreeMetrics | null =
    stats
      ? {
          totalCommits: stats.totalCommits,
          currentStreak: calcStreak(heatmapData),
          inactiveDays: calcInactiveDays(heatmapData),
          todayCommitted: stats.todayCommits > 0,
          maxDailyCommits: stats.maxDailyCommits,
          repos: repos.map((r) => ({ id: r.id, language: r.primary_language })),
        }
      : null;

  // ---------------------------------------------------------------------------
  // Feed refresh helper (used by milestone/project creation callbacks)
  // ---------------------------------------------------------------------------
  const refreshFeed = useCallback(async () => {
    try {
      const [feedRes, projectsRes, milestonesRes] = await Promise.all([
        fetch(api("/feed")),
        fetch(api("/projects")),
        fetch(api("/milestones")),
      ]);
      const [feedData, projectsData, milestonesData] = await Promise.all([
        feedRes.json(),
        projectsRes.json(),
        milestonesRes.json(),
      ]);
      setFeedEntries(Array.isArray(feedData) ? feedData : feedData.entries ?? []);
      setProjects(Array.isArray(projectsData) ? projectsData : projectsData.projects ?? []);
      setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
    } catch {
      // Feed errors are non-critical
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  const handleAddMilestone = useCallback(
    (scopeType: "project" | "repository", scopeId: number | null, rawInput?: string) => {
      if (scopeId === null) {
        // Opened from top input bar — use raw text as initial input, no preselected scope
        setMilestoneInitialInput(rawInput ?? "");
        setMilestonePreselectedScope(null);
      } else {
        // Opened from feed card — preselect the card's scope
        const scopeName = scopeNames.get(`${scopeType}:${scopeId}`) ?? "";
        setMilestoneInitialInput("");
        setMilestonePreselectedScope({ type: scopeType, id: scopeId, name: scopeName });
      }
      setMilestoneDialogOpen(true);
    },
    [scopeNames]
  );

  const handleAcceptGroupSuggestion = useCallback(
    async (suggestion: GroupSuggestion) => {
      try {
        const repositoryIds = suggestion.repositories.map((r) => r.id);
        const name = suggestion.repositories.map((r) => r.name).join(" + ");
        await fetch(api("/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, repositoryIds }),
        });
        await refreshFeed();
      } catch {
        // Non-critical
      }
    },
    [refreshFeed]
  );

  const handleDismissGroupSuggestion = useCallback((entryId: number) => {
    setFeedEntries((prev) => prev.filter((e) => e.id !== entryId));
  }, []);

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (initialLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg" />
          ))}
        </div>
        <div className="h-32 bg-muted rounded-lg" />
        <div className="h-48 bg-muted rounded-lg" />
      </div>
    );
  }

  const greeting = userName ? `${getGreeting()}, ${userName}님` : getGreeting();

  // ---------------------------------------------------------------------------
  // Render: left/right split layout
  // ---------------------------------------------------------------------------
  return (
    <div>
      <Header title="대시보드" />

      <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6 items-start">
        {/* Left: Status panel */}
        <div className="lg:sticky lg:top-6">
          <StatusPanel
            greeting={greeting}
            stats={stats}
            heatmapData={heatmapData}
            treeMetrics={treeMetrics}
            syncError={syncError}
            onRetrySync={() => {
              setIsSyncing(true);
              refreshStats().finally(() => setIsSyncing(false));
            }}
            isSyncing={isSyncing}
          />
        </div>

        {/* Right: Newsfeed panel (scrollable) */}
        <div className="min-h-0">
          <NewsfeedPanel
            entries={feedEntries}
            scopeNames={scopeNames}
            milestones={milestones}
            isRefreshing={isRefreshing}
            onAddMilestone={handleAddMilestone}
            onMilestoneChanged={refreshFeed}
            onAcceptGroupSuggestion={handleAcceptGroupSuggestion}
            onDismissGroupSuggestion={handleDismissGroupSuggestion}
          />
        </div>
      </div>

      {/* Milestone dialog — rendered at root to avoid stacking context issues */}
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        initialRawInput={milestoneInitialInput}
        preselectedScope={milestonePreselectedScope}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        repositories={repos.map((r) => ({ id: r.id, name: `${r.owner}/${r.repo}` }))}
        existingMilestones={milestones}
        onCreated={refreshFeed}
      />
    </div>
  );
}
