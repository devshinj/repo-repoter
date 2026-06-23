"use client";

import { ContributionHeatmap } from "@/components/data-display/contribution-heatmap";
import { GrowthTree } from "@/components/growth-tree/growth-tree";
import type { DashboardStats, TreeMetrics } from "@/core/types";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusPanelProps {
  greeting: string;
  stats: DashboardStats | null;
  heatmapData: Record<string, number>;
  treeMetrics: TreeMetrics | null;
  syncError: string | null;
  onRetrySync: () => void;
  isSyncing: boolean;
}

export function StatusPanel({
  greeting,
  stats,
  heatmapData,
  treeMetrics,
  syncError,
  onRetrySync,
  isSyncing,
}: StatusPanelProps) {
  return (
    <div className="space-y-6">
      {/* 인사말 */}
      <div>
        <h1 className="text-2xl font-bold">{greeting}</h1>
        {syncError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{syncError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetrySync}
              disabled={isSyncing}
            >
              <RefreshCw
                className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        )}
      </div>

      {/* 히트맵 + 통계 통합 */}
      {Object.keys(heatmapData).length > 0 && (
        <ContributionHeatmap data={heatmapData} stats={stats} />
      )}

      {/* 성장 트리 */}
      {treeMetrics && <GrowthTree metrics={treeMetrics} />}
    </div>
  );
}
