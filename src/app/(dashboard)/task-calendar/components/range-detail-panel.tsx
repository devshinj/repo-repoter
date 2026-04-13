"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays, GitCommit, GitBranch, FolderGit2, FileText, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { projectColor, oklch } from "@/lib/color-hash";

interface BranchCommits {
  branch: string;
  commits: { sha: string; message: string; author: string; date: string }[];
}

interface RepoDetail {
  repoId: number;
  repoName: string;
  owner: string;
  label: string | null;
  branches: BranchCommits[];
}

interface DateRepoDetail {
  date: string;
  repos: RepoDetail[];
}

interface RangeDetailPanelProps {
  rangeStart: string;
  rangeEnd: string;
  repoIds: string;
}

export function RangeDetailPanel({ rangeStart, rangeEnd, repoIds }: RangeDetailPanelProps) {
  const [data, setData] = useState<DateRepoDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [generatingRepoId, setGeneratingRepoId] = useState<number | null>(null);

  useEffect(() => {
    setExpandedDates(new Set());
    setExpandedBranches(new Set());
    setLoading(true);
    const params = new URLSearchParams({ since: rangeStart, until: rangeEnd });
    if (repoIds) params.set("repoIds", repoIds);
    fetch(`/api/repos/commit-calendar/range?${params}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setData(d); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [rangeStart, rangeEnd, repoIds]);

  const summary = useMemo(() => {
    const repoCommitCounts: Record<string, { owner: string; repoName: string; repoId: number; label: string | null; count: number }> = {};
    let totalCommits = 0;

    for (const day of data) {
      for (const repo of day.repos) {
        const key = `${repo.owner}/${repo.repoName}`;
        if (!repoCommitCounts[key]) {
          repoCommitCounts[key] = { owner: repo.owner, repoName: repo.repoName, repoId: repo.repoId, label: repo.label, count: 0 };
        }
        for (const b of repo.branches) {
          repoCommitCounts[key].count += b.commits.length;
          totalCommits += b.commits.length;
        }
      }
    }

    return { totalCommits, activeDays: data.length, repos: Object.values(repoCommitCounts) };
  }, [data]);

  function toggleDate(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  function toggleBranch(key: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function generateRangeReport(repo: { owner: string; repoName: string; repoId: number; label?: string | null }) {
    const displayName = repo.label || `${repo.owner}/${repo.repoName}`;
    if (!confirm(`${rangeStart} ~ ${rangeEnd} — ${displayName}\n\n기간 보고서를 작성하시겠습니까?`)) return;

    setGeneratingRepoId(repo.repoId);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: repo.repoId,
          dateRange: { since: rangeStart, until: rangeEnd },
          async: true,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success("보고서 생성이 요청되었습니다. 보고서 목록에서 확인하세요.");
      } else {
        toast.error(result.error || "보고서 생성 요청 실패");
      }
    } catch {
      toast.error("보고서 생성 요청 중 오류가 발생했습니다");
    } finally {
      setGeneratingRepoId(null);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{rangeStart} ~ {rangeEnd}</span>
        <Badge variant="outline" className="text-xs">{summary.totalCommits}개 커밋</Badge>
        <Badge variant="outline" className="text-xs">{summary.activeDays}일 활동</Badge>
      </div>

      {summary.repos.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {summary.repos.map((repo) => {
            const color = projectColor(`${repo.owner}/${repo.repoName}`);
            return (
            <Card key={repo.repoId} className="flex-1 min-w-[200px]">
              <CardContent className="py-2 px-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: oklch(color.bgLight) }}
                  >
                    <FolderGit2 className="h-2.5 w-2.5" style={{ color: oklch(color.solid) }} />
                  </div>
                  <span className="text-xs font-medium">{repo.label || `${repo.owner}/${repo.repoName}`}</span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                    style={{ backgroundColor: oklch(color.bgLight), color: oklch(color.solid) }}
                  >{repo.count}</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  disabled={generatingRepoId === repo.repoId}
                  onClick={() => generateRangeReport(repo)}
                >
                  {generatingRepoId === repo.repoId ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />요청 중...</>
                  ) : (
                    <><FileText className="h-3.5 w-3.5" />기간 보고서 작성</>
                  )}
                </Button>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">기간 커밋 데이터 로딩 중...</div>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">선택한 기간에 커밋 활동이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {data.map((day) => {
            const dayCommitCount = day.repos.reduce(
              (sum, r) => sum + r.branches.reduce((s, b) => s + b.commits.length, 0), 0
            );
            const isDateOpen = expandedDates.has(day.date);

            return (
              <Card key={day.date}>
                <CardContent className="py-2">
                  <button
                    className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded-sm px-1 py-1 transition-colors"
                    onClick={() => toggleDate(day.date)}
                  >
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isDateOpen ? "rotate-90" : ""}`} />
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{day.date}</span>
                    <Badge variant="outline" className="text-[10px]">{dayCommitCount} 커밋</Badge>
                    <Badge variant="secondary" className="text-[10px]">{day.repos.length} 저장소</Badge>
                  </button>

                  {isDateOpen && (
                    <div className="ml-6 mt-2 space-y-2">
                      {day.repos.map((repo) => {
                        const rColor = projectColor(`${repo.owner}/${repo.repoName}`);
                        return (
                        <div key={repo.repoId} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: oklch(rColor.bgLight) }}
                            >
                              <FolderGit2 className="h-2.5 w-2.5" style={{ color: oklch(rColor.solid) }} />
                            </div>
                            <span className="text-xs font-medium">{repo.label || `${repo.owner}/${repo.repoName}`}</span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                              style={{ backgroundColor: oklch(rColor.bgLight), color: oklch(rColor.solid) }}
                            >
                              {repo.branches.reduce((s, b) => s + b.commits.length, 0)} 커밋
                            </Badge>
                          </div>

                          <div className="ml-3 space-y-1 border-l-2 border-muted pl-4">
                            {repo.branches.map((branch) => {
                              const branchKey = `${day.date}:${repo.repoId}:${branch.branch}`;
                              const isOpen = expandedBranches.has(branchKey);
                              return (
                                <div key={branch.branch}>
                                  <button
                                    className="flex items-center gap-1.5 py-1 w-full text-left hover:bg-muted/50 rounded-sm px-1 -ml-1 transition-colors"
                                    onClick={() => toggleBranch(branchKey)}
                                  >
                                    <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-medium text-muted-foreground">{branch.branch}</span>
                                    <span className="text-[10px] text-muted-foreground">({branch.commits.length})</span>
                                  </button>

                                  {isOpen && (
                                    <div className="ml-5 space-y-1 border-l border-dashed border-muted-foreground/30 pl-3 mt-1 mb-2">
                                      {branch.commits.map((commit) => (
                                        <div key={commit.sha} className="flex items-start gap-2">
                                          <GitCommit className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                              <code className="text-[10px] text-muted-foreground font-mono">{commit.sha.slice(0, 7)}</code>
                                              <span className="text-xs text-muted-foreground">{commit.author}</span>
                                              <span className="text-[10px] text-muted-foreground/60">
                                                {new Date(commit.date).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                            </div>
                                            <p className="text-xs truncate">{commit.message}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
