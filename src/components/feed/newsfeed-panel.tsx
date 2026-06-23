"use client";

import { useState } from "react";
import { FeedCard } from "@/components/feed/feed-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Target, Loader2 } from "lucide-react";
import type { FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";

interface NewsfeedPanelProps {
  entries: FeedEntry[];
  scopeNames: Map<string, string>; // "project:1" → "MyProject"
  isRefreshing: boolean;
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number) => void;
  onAcceptGroupSuggestion: (suggestion: GroupSuggestion) => void;
  onDismissGroupSuggestion: (entryId: number) => void;
}

export function NewsfeedPanel({
  entries,
  scopeNames,
  isRefreshing,
  onAddMilestone,
  onAcceptGroupSuggestion,
  onDismissGroupSuggestion,
}: NewsfeedPanelProps) {
  const [milestoneInput, setMilestoneInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const getScopeName = (entry: FeedEntry) =>
    scopeNames.get(`${entry.scopeType}:${entry.scopeId}`) ?? "Unknown";

  return (
    <div className="space-y-4">
      {/* 마일스톤 입력 바 */}
      <div
        className="rounded-lg border bg-card p-3 cursor-text"
        onClick={() => setIsExpanded(true)}
      >
        {isExpanded ? (
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="목표를 자유롭게 입력하세요..."
              value={milestoneInput}
              onChange={(e) => setMilestoneInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsExpanded(false);
                  setMilestoneInput("");
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                  setMilestoneInput("");
                }}
              >
                취소
              </Button>
              <Button
                size="sm"
                disabled={!milestoneInput.trim()}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddMilestone("project", -1);
                }}
              >
                설정하기
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Target className="h-4 w-4" />
            <span>목표를 자유롭게 입력하세요...</span>
          </div>
        )}
      </div>

      {/* 로딩 표시 */}
      {isRefreshing && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>최신 활동을 확인하고 있어요...</span>
        </div>
      )}

      {/* 피드 카드 목록 */}
      {entries.map((entry) => (
        <div key={entry.id}>
          <FeedCard
            entry={entry}
            scopeName={getScopeName(entry)}
            onAddMilestone={onAddMilestone}
          />
          {/* 프로젝트 그룹핑 제안 배너 */}
          {entry.groupSuggestion && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
              <p className="text-sm font-medium">
                {entry.groupSuggestion.suggestion}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {entry.groupSuggestion.repositories
                  .map((r) => r.name)
                  .join(", ")}
                을(를) 하나의 프로젝트로 묶을까요?
              </p>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() =>
                    onAcceptGroupSuggestion(entry.groupSuggestion!)
                  }
                >
                  묶기
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDismissGroupSuggestion(entry.id)}
                >
                  무시
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* 빈 상태 */}
      {!isRefreshing && entries.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">아직 뉴스피드가 없어요.</p>
          <p className="text-xs mt-1">
            저장소를 등록하면 활동 브리핑이 여기에 표시됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
