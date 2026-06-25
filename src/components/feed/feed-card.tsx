"use client";

import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";
import type { FeedEntry } from "@/core/feed/feed-types";

interface FeedCardProps {
  entry: FeedEntry;
  scopeName: string;
  onAddMilestone: (scopeType: "project" | "repository", scopeId: number) => void;
}

export function FeedCard({ entry, scopeName, onAddMilestone }: FeedCardProps) {
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
        {entry.milestoneSummary && (
          <div className="mb-3 rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
            {entry.milestoneSummary}
          </div>
        )}
        <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
          <ReactMarkdown>{entry.briefing ?? ""}</ReactMarkdown>
        </div>
        <p className="mt-2 text-xs text-muted-foreground/60">
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
