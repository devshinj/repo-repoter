"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/data-display/empty-state";
import { toast } from "sonner";
import { FileText, FolderGit2, CalendarDays, Trash2, ChevronRight } from "lucide-react";
import { projectColor, oklch } from "@/lib/color-hash";
import { ConfirmDialog } from "@/components/data-display/confirm-dialog";

interface Report {
  id: number;
  project: string;
  date: string;
  date_start: string | null;
  date_end: string | null;
  title: string;
  owner: string;
  repo: string;
  created_at: string;
}

/** 단일 날짜 or 기간을 포맷팅 */
function formatReportDate(report: Report): { label: string; isRange: boolean } {
  if (report.date_start && report.date_end && report.date_start !== report.date_end) {
    return { label: `${report.date_start} ~ ${report.date_end}`, isRange: true };
  }
  return { label: report.date, isRange: false };
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const fetchReports = () => {
    setLoading(true);
    fetch("/api/reports")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setReports(data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReports(); }, []);

  const handleDeleteClick = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget === null) return;
    const res = await fetch(`/api/reports/${deleteTarget}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("보고서가 삭제되었습니다");
      fetchReports();
    }
  };

  // 프로젝트별 그룹핑 (색상 키는 항상 owner/repo 기준)
  const grouped = useMemo(() => {
    const map = new Map<string, { displayName: string; colorKey: string; reports: Report[] }>();
    for (const r of reports) {
      const colorKey = r.owner && r.repo ? `${r.owner}/${r.repo}` : r.project;
      if (!map.has(colorKey)) {
        map.set(colorKey, { displayName: r.project, colorKey, reports: [] });
      }
      map.get(colorKey)!.reports.push(r);
    }
    return Array.from(map.values());
  }, [reports]);

  if (loading) {
    return (
      <div>
        <Header title="업무 보고서" description="프로젝트별 작성된 업무 보고서를 확인합니다" />
        <div className="py-16 text-center text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  return (
    <div>
      <Header title="업무 보고서" description="프로젝트별 작성된 업무 보고서를 확인합니다" />

      {reports.length === 0 ? (
        <EmptyState
          title="작성된 보고서가 없습니다"
          description="태스크 캘린더에서 저장소의 '보고서 작성' 버튼을 눌러 업무 보고서를 생성하세요."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
            const projColor = projectColor(group.colorKey);
            return (
            <div key={group.colorKey}>
              {/* 프로젝트 헤더 */}
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: oklch(projColor.bgLight) }}
                >
                  <FolderGit2 className="h-3 w-3" style={{ color: oklch(projColor.solid) }} />
                </div>
                <h2 className="text-sm font-semibold">{group.displayName}</h2>
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0"
                  style={{
                    backgroundColor: oklch(projColor.bgLight),
                    color: oklch(projColor.solid),
                  }}
                >
                  {group.reports.length}건
                </Badge>
              </div>

              {/* 보고서 목록 */}
              <div className="grid gap-2 ml-6">
                {group.reports.map((report) => {
                  const { label: dateLabel, isRange } = formatReportDate(report);
                  return (
                    <Link key={report.id} href={`/reports/${report.id}`}>
                      <Card className="transition-colors hover:bg-muted/40 cursor-pointer">
                        <CardContent className="flex items-center gap-3 py-3">
                          <FileText className="h-4 w-4 flex-shrink-0" style={{ color: oklch(projColor.solid) }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{report.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {dateLabel}
                                {isRange && (
                                  <span
                                    className="rounded px-1 py-px text-[10px] font-medium"
                                    style={{
                                      backgroundColor: oklch(projColor.bgLight),
                                      color: oklch(projColor.solid),
                                    }}
                                  >
                                    기간
                                  </span>
                                )}
                              </span>
                              <span>
                                작성: {new Date(report.created_at).toLocaleDateString("ko-KR")}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0"
                            onClick={(e) => handleDeleteClick(e, report.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="보고서 삭제"
        description="이 보고서를 삭제하시겠습니까? 삭제된 보고서는 복구할 수 없습니다."
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
