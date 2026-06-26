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

// ---------------------------------------------------------------------------
// Milestone summary parsing
// ---------------------------------------------------------------------------

const statusConfig: Record<string, { dot: string; badge: string }> = {
  "완료 근접": { dot: "bg-emerald-400", badge: "text-emerald-400 bg-emerald-400/10 ring-emerald-400/25" },
  "지연 위험": { dot: "bg-red-400", badge: "text-red-400 bg-red-400/10 ring-red-400/25" },
  "수정·보완": { dot: "bg-amber-400", badge: "text-amber-400 bg-amber-400/10 ring-amber-400/25" },
  "개발 중":   { dot: "bg-blue-400", badge: "text-blue-400 bg-blue-400/10 ring-blue-400/25" },
  "활동 없음": { dot: "bg-zinc-500", badge: "text-zinc-400 bg-zinc-400/10 ring-zinc-400/25" },
};

interface ParsedMilestoneLine {
  title: string;
  status: string | null;
  statusStyle: { dot: string; badge: string } | null;
  meta: string[]; // remaining, progress 등
  raw: string;
}

function parseMilestoneSummary(text: string): ParsedMilestoneLine[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // "마일스톤명 — 상태 · N일 남음 · 변화" 형식 파싱
      const dashIdx = line.indexOf("—");
      if (dashIdx > 0) {
        const title = line.substring(0, dashIdx).trim();
        const detailPart = line.substring(dashIdx + 1).trim();
        const parts = detailPart.split("·").map((p) => p.trim()).filter(Boolean);

        let status: string | null = null;
        let statusStyle: { dot: string; badge: string } | null = null;
        const meta: string[] = [];

        for (const part of parts) {
          let matched = false;
          for (const [key, style] of Object.entries(statusConfig)) {
            if (part.replace(/[‧.]/g, "·").includes(key)) {
              status = key;
              statusStyle = style;
              matched = true;
              break;
            }
          }
          if (!matched) {
            meta.push(part);
          }
        }

        return { title, status, statusStyle, meta, raw: line };
      }

      // Fallback: — 구분자 없는 경우 상태 키워드 감지
      let status: string | null = null;
      let statusStyle: { dot: string; badge: string } | null = null;
      for (const [key, style] of Object.entries(statusConfig)) {
        if (line.replace(/[‧.]/g, "·").includes(key)) {
          status = key;
          statusStyle = style;
          break;
        }
      }

      return { title: line, status, statusStyle, meta: [], raw: line };
    });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedCard({ entry, scopeName, milestones = [], onAddMilestone, onMilestoneChanged }: FeedCardProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null);

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
  const summaryLines = entry.milestoneSummary
    ? parseMilestoneSummary(entry.milestoneSummary)
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="font-semibold text-sm">{scopeName}</h3>
        {entry.scopeType !== "logicraft" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onAddMilestone(entry.scopeType as "project" | "repository", entry.scopeId)}
            title="마일스톤 추가"
          >
            <Target className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* ── 마일스톤 섹션 ── */}
        {hasMilestoneContent && (
          <div className="rounded-md bg-primary/5 border border-primary/15 overflow-hidden">
            {/* LLM 생성 마일스톤 요약 */}
            {summaryLines.length > 0 && (
              <div className="divide-y divide-primary/10">
                {summaryLines.map((line, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2.5">
                    {/* 상태 인디케이터 */}
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                        line.statusStyle?.dot ?? "bg-primary/40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      {/* 제목 + 상태 배지 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium leading-snug">
                          {line.title !== line.raw ? line.title : line.raw}
                        </span>
                        {line.status && (
                          <span
                            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ring-inset ${
                              line.statusStyle?.badge ?? "text-muted-foreground ring-muted bg-muted/50"
                            }`}
                          >
                            {line.status}
                          </span>
                        )}
                      </div>
                      {/* 남은 일수, 변화 등 메타 정보 */}
                      {line.meta.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {line.meta.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 활성 마일스톤 목록 */}
            {scopedMilestones.length > 0 && (
              <div
                className={`px-3 py-2 space-y-1 ${
                  summaryLines.length > 0 ? "border-t border-primary/10" : ""
                }`}
              >
                {scopedMilestones.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Target className="h-3 w-3 text-primary/50 shrink-0" />
                      <span className="text-xs truncate">{m.title}</span>
                      {m.deadline && (
                        <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
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

        {/* ── 브리핑 본문 ── */}
        <div className="briefing-prose">
          <ReactMarkdown>{entry.briefing ?? ""}</ReactMarkdown>
        </div>

        {/* ── 기간 ── */}
        <p className="text-[11px] text-muted-foreground/50 tabular-nums">
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
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(s)} ~ ${fmt(e)}`;
}
