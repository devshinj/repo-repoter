"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, Check, X, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api-url";
import type { FeedEntry } from "@/core/feed/feed-types";
import type { Milestone } from "@/core/project/project-types";

interface FeedCardProps {
  entry: FeedEntry;
  scopeName: string;
  milestones?: Milestone[];
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number) => void;
  onMilestoneChanged?: () => void;
}

export function FeedCard({ entry, scopeName, milestones = [], onAddMilestone, onMilestoneChanged }: FeedCardProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null);

  // 이 카드의 scope에 해당하는 active 마일스톤만 필터
  const scopedMilestones = milestones.filter(
    (m) =>
      m.status === "active" &&
      ((entry.scopeType === "project" && m.projectId === entry.scopeId) ||
       (entry.scopeType === "repository" && m.repositoryId === entry.scopeId))
  );

  async function handleStatusChange(id: number, status: "completed" | "cancelled") {
    setLoadingId(id);
    try {
      await fetch(api(`/milestones/${id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      onMilestoneChanged?.();
    } catch (err) {
      console.error("milestone status change error:", err);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: number) {
    setLoadingId(id);
    try {
      await fetch(api(`/milestones/${id}`), { method: "DELETE" });
      onMilestoneChanged?.();
    } catch (err) {
      console.error("milestone delete error:", err);
    } finally {
      setLoadingId(null);
    }
  }

  const hasMilestoneContent = entry.milestoneSummary || scopedMilestones.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="font-semibold text-sm">{scopeName}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onAddMilestone(entry.scopeType, entry.scopeId)}
          title="마일스톤 추가"
        >
          <Target className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {hasMilestoneContent && (
          <div className="mb-3 rounded-md bg-primary/5 border border-primary/20 p-3 space-y-2">
            {entry.milestoneSummary && (
              <p className="text-sm">{entry.milestoneSummary}</p>
            )}
            {scopedMilestones.length > 0 && (
              <div className="space-y-1.5">
                {entry.milestoneSummary && scopedMilestones.length > 0 && (
                  <hr className="border-primary/10" />
                )}
                {scopedMilestones.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Target className="h-3 w-3 text-primary/60 shrink-0" />
                      <span className="text-xs truncate">{m.title}</span>
                      {m.deadline && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          ~{m.deadline}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {loadingId === m.id ? (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                            onClick={() => handleStatusChange(m.id, "completed")}
                            title="완료"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            onClick={() => handleStatusChange(m.id, "cancelled")}
                            title="취소"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(m.id)}
                            title="삭제"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-headings:mt-3 prose-headings:mb-1.5">
          <ReactMarkdown>{entry.briefing ?? ""}</ReactMarkdown>
        </div>
        <p className="mt-3 text-xs text-muted-foreground/60">
          {formatPeriod(entry.periodStart, entry.periodEnd)}
        </p>
      </CardContent>
    </Card>
  );
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(s)} ~ ${fmt(e)}`;
}
