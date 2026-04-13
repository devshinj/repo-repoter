"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, ClipboardCopy, FolderGit2, Pencil, Save, X } from "lucide-react";
import { projectColor, oklch } from "@/lib/color-hash";
import { ConfirmDialog } from "@/components/data-display/confirm-dialog";

interface Report {
  id: number;
  project: string;
  date: string;
  date_start: string | null;
  date_end: string | null;
  title: string;
  content: string;
  owner: string;
  repo: string;
  created_at: string;
  updated_at: string;
}

export default function ReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = params.id as string;

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetch(`/api/reports/${reportId}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setReport)
      .catch(() => toast.error("보고서를 찾을 수 없습니다"))
      .finally(() => setLoading(false));
  }, [reportId]);

  function startEdit() {
    if (!report) return;
    setEditTitle(report.title);
    setEditContent(report.content);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditTitle("");
    setEditContent("");
  }

  async function handleSave() {
    if (!editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (res.ok) {
        setReport((prev) => prev ? { ...prev, title: editTitle, content: editContent } : prev);
        setEditing(false);
        toast.success("보고서가 수정되었습니다");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("보고서가 삭제되었습니다");
      router.push("/reports");
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">로딩 중...</div>;
  }

  if (!report) {
    return (
      <div>
        <Header title="보고서를 찾을 수 없습니다" />
        <Button variant="outline" onClick={() => router.push("/reports")}>
          <ArrowLeft className="h-4 w-4 mr-2" />목록으로
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Header
        title="업무 보고서"
        actions={
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={cancelEdit}><X className="h-4 w-4 mr-1" />취소</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-1" />{saving ? "저장 중..." : "저장"}</Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => router.push("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />목록</Button>
                <Button variant="outline" size="sm" onClick={startEdit}><Pencil className="h-4 w-4 mr-1" />수정</Button>
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>삭제</Button>
              </>
            )}
          </div>
        }
      />

      {/* 메타 정보 */}
      {(() => {
        const colorKey = report.owner && report.repo ? `${report.owner}/${report.repo}` : report.project;
        const projColor = projectColor(colorKey);
        const isRange = report.date_start && report.date_end && report.date_start !== report.date_end;
        const dateLabel = isRange ? `${report.date_start} ~ ${report.date_end}` : report.date;
        return (
          <div className="flex items-center gap-3 mb-6 text-sm text-muted-foreground">
            <Badge variant="outline" className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {dateLabel}
              {isRange && (
                <span
                  className="rounded px-1 py-px text-[10px] font-medium ml-1"
                  style={{
                    backgroundColor: oklch(projColor.bgLight),
                    color: oklch(projColor.solid),
                  }}
                >
                  기간
                </span>
              )}
            </Badge>
            <Badge
              variant="secondary"
              className="flex items-center gap-1"
              style={{
                backgroundColor: oklch(projColor.bgLight),
                color: oklch(projColor.solid),
              }}
            >
              <FolderGit2 className="h-3 w-3" />
              {report.project}
            </Badge>
            <span className="text-xs">
              작성: {new Date(report.created_at).toLocaleString("ko-KR")}
            </span>
          </div>
        );
      })()}

      {editing ? (
        <div className="space-y-4 max-w-3xl">
          <div>
            <label className="text-sm font-medium">제목</label>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">내용 (Markdown)</label>
            <textarea
              className="w-full mt-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[400px] resize-y focus:outline-none focus:ring-2 focus:ring-ring font-mono leading-relaxed"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{report.title}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(report.content);
                  toast.success("클립보드에 복사되었습니다");
                }}
              >
                <ClipboardCopy className="h-4 w-4 mr-1" />복사
              </Button>
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed">
              <ReactMarkdown>{report.content}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="보고서 삭제"
        description="이 보고서를 삭제하시겠습니까? 삭제된 보고서는 복구할 수 없습니다."
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
