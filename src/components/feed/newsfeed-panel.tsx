"use client";

import { useState } from "react";
import { FeedCard } from "@/components/feed/feed-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Target, Loader2, Rss, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { FeedEntry, GroupSuggestion } from "@/core/feed/feed-types";

interface NewsfeedPanelProps {
  entries: FeedEntry[];
  scopeNames: Map<string, string>; // "project:1" → "MyProject"
  isRefreshing: boolean;
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number, rawInput?: string) => void;
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

  const isEmpty = !isRefreshing && entries.length === 0;

  return (
    <div className="space-y-4">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">활동 브리핑</h2>
          <p className="text-xs text-muted-foreground mt-0.5">저장소 커밋 활동을 AI가 요약합니다</p>
        </div>
      </div>

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
                  onAddMilestone("project", -1, milestoneInput);
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

      {/* 빈 상태: 기능 소개 + 모의 카드 미리보기 */}
      {isEmpty && (
        <div className="space-y-5">
          {/* 기능 소개 3포인트 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col items-center text-center gap-1.5 rounded-lg border border-dashed p-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10">
                <Rss className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-xs font-medium">커밋 수집</p>
              <p className="text-[10px] text-muted-foreground leading-tight">RSS로 자동 감지</p>
            </div>
            <div className="flex flex-col items-center text-center gap-1.5 rounded-lg border border-dashed p-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-500/10">
                <Sparkles className="h-4 w-4 text-violet-500" />
              </div>
              <p className="text-xs font-medium">AI 요약</p>
              <p className="text-[10px] text-muted-foreground leading-tight">활동을 브리핑으로</p>
            </div>
            <div className="flex flex-col items-center text-center gap-1.5 rounded-lg border border-dashed p-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-500/10">
                <Target className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-xs font-medium">마일스톤</p>
              <p className="text-[10px] text-muted-foreground leading-tight">목표 진행 추적</p>
            </div>
          </div>

          {/* 모의 피드 카드 미리보기 */}
          <div className="relative">
            <div className="space-y-3 opacity-40 pointer-events-none select-none" aria-hidden>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 w-28 rounded bg-muted-foreground/20" />
                    <div className="h-5 w-5 rounded bg-muted-foreground/10" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="rounded-md bg-primary/5 border border-primary/10 p-2.5">
                    <div className="h-2.5 w-3/4 rounded bg-primary/15" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2.5 w-full rounded bg-muted-foreground/15" />
                    <div className="h-2.5 w-5/6 rounded bg-muted-foreground/15" />
                    <div className="h-2.5 w-2/3 rounded bg-muted-foreground/15" />
                  </div>
                  <div className="h-2 w-32 rounded bg-muted-foreground/10 mt-1" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 w-36 rounded bg-muted-foreground/20" />
                    <div className="h-5 w-5 rounded bg-muted-foreground/10" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="space-y-1.5">
                    <div className="h-2.5 w-full rounded bg-muted-foreground/15" />
                    <div className="h-2.5 w-4/5 rounded bg-muted-foreground/15" />
                  </div>
                  <div className="h-2 w-28 rounded bg-muted-foreground/10 mt-1" />
                </CardContent>
              </Card>
            </div>

            {/* 오버레이 안내 */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center bg-background/80 backdrop-blur-sm rounded-xl px-6 py-4 shadow-sm border">
                <p className="text-sm font-medium">저장소를 등록하면</p>
                <p className="text-sm font-medium">이런 브리핑이 표시됩니다</p>
                <a
                  href="/repos"
                  className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-primary hover:underline"
                >
                  저장소 등록하기
                  <ArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
