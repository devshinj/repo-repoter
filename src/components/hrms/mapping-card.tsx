"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  Pencil,
  Trash2,
  Loader2,
  CalendarDays,
  ClipboardList,
  GitBranch,
  Clock,
  Zap,
  Hand,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface MappingCardProps {
  mapping: any;
  projectStatus?: string;
  statusLabel?: string;
  /** 페이지 진입 시 이미 진행 중이던 작업의 jobId */
  activeJobId?: number;
  onRegister: (mappingId: number, targetDate?: string, force?: boolean) => Promise<any>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
  onComplete?: () => void;
}

function getDateString(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function getDateLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getStatusTheme(status: string) {
  switch (status) {
    case "PROJ_PROGRESS":
      return { gradient: "from-emerald-500/10 to-teal-500/5", border: "border-emerald-500/30", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", chipBg: "bg-emerald-500/10 dark:bg-emerald-500/20" };
    case "PROJ_CONTRACT":
      return { gradient: "from-cyan-500/10 to-blue-500/5", border: "border-cyan-500/30", dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400", chipBg: "bg-cyan-500/10 dark:bg-cyan-500/20" };
    case "PROJ_PROPOSAL":
      return { gradient: "from-violet-500/10 to-purple-500/5", border: "border-violet-500/30", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", chipBg: "bg-violet-500/10 dark:bg-violet-500/20" };
    case "PROJ_COMPLETE":
      return { gradient: "from-slate-500/10 to-gray-500/5", border: "border-slate-500/30", dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400", chipBg: "bg-slate-500/10 dark:bg-slate-500/20" };
    case "PROJ_HOLD":
      return { gradient: "from-amber-500/10 to-orange-500/5", border: "border-amber-500/30", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", chipBg: "bg-amber-500/10 dark:bg-amber-500/20" };
    default:
      return { gradient: "from-gray-500/10 to-gray-500/5", border: "border-gray-500/30", dot: "bg-gray-400", text: "text-gray-500", chipBg: "bg-gray-500/10 dark:bg-gray-500/20" };
  }
}

function useSSEStream(jobId: number | null, onEvent: (event: any) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!jobId) return;

    const es = new EventSource(api(`/hrms/register/stream?jobId=${jobId}`));
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEventRef.current(data);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [jobId]);
}

export function MappingCard({ mapping, projectStatus, statusLabel, activeJobId, onRegister, onEdit, onDelete, onComplete }: MappingCardProps) {
  const [registering, setRegistering] = useState(!!activeJobId);
  const [progressStep, setProgressStep] = useState<string | null>(activeJobId ? "진행 중인 작업에 재연결 중..." : null);
  const [progressIcon, setProgressIcon] = useState<"loading" | "done" | "error">("loading");
  const [deleting, setDeleting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [currentJobId, setCurrentJobId] = useState<number | null>(activeJobId ?? null);

  const theme = getStatusTheme(projectStatus ?? "");

  // activeJobId prop이 외부에서 변경되면 (예: 중복→force 등록) SSE 재연결
  useEffect(() => {
    if (activeJobId && activeJobId !== currentJobId) {
      setCurrentJobId(activeJobId);
      setRegistering(true);
      setProgressStep("등록 진행 중...");
      setProgressIcon("loading");
    }
  }, [activeJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoadingTasks(true);
    fetch(api(`/hrms/tasks?projectId=${mapping.hrms_project_id}`))
      .then(r => r.ok ? r.json() : [])
      .then(tasks => {
        const sorted = (Array.isArray(tasks) ? tasks : [])
          .sort((a: any, b: any) => (b.dueDate || "").localeCompare(a.dueDate || ""))
          .slice(0, 3);
        setRecentTasks(sorted);
      })
      .catch(() => setRecentTasks([]))
      .finally(() => setLoadingTasks(false));
  }, [mapping.hrms_project_id]);

  const handleSSEEvent = useCallback((event: any) => {
    setProgressStep(event.message);

    if (event.step === "done") {
      setProgressIcon("done");
      if (event.result) {
        const { hrmsTaskId, action } = event.result;
        toast.success(
          action === "updated"
            ? `기존 업무 업데이트 완료 (HRMS #${hrmsTaskId})`
            : `업무 등록 완료 (HRMS #${hrmsTaskId})`
        );
      }
      setTimeout(() => {
        setRegistering(false);
        setProgressStep(null);
        setProgressIcon("loading");
        setCurrentJobId(null);
        onComplete?.();
      }, 2000);
    } else if (event.step === "error") {
      setProgressIcon("error");
      toast.error(event.error || event.message);
      setTimeout(() => {
        setRegistering(false);
        setProgressStep(null);
        setProgressIcon("loading");
        setCurrentJobId(null);
        onComplete?.();
      }, 3000);
    }
  }, [onComplete]);

  useSSEStream(currentJobId, handleSSEEvent);

  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    setProgressStep("등록 준비 중...");
    setProgressIcon("loading");

    try {
      const data = await onRegister(mapping.id, targetDate);
      if (data?.duplicate || data?.skipped) {
        // 즉시 완료된 케이스 (중복 또는 스킵)
        setRegistering(false);
        setProgressStep(null);
        return;
      }
      if (data?.jobId) {
        setCurrentJobId(data.jobId);
      }
    } catch {
      setRegistering(false);
      setProgressStep(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(mapping.id);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  const repoNames = mapping.repos
    .map((r: any) => r.label || `${r.owner}/${r.repo}`)
    .join(", ");

  const ProgressIconComponent = progressIcon === "done"
    ? CheckCircle2
    : progressIcon === "error"
      ? XCircle
      : Loader2;

  return (
    <>
      <div
        className={`
          relative rounded-xl border ${theme.border}
          bg-gradient-to-br ${theme.gradient} backdrop-blur-sm
          p-5 transition-all duration-200
          hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20
        `}
      >
        {/* 헤더: 프로젝트명 + 모드 칩 + 편집/삭제 */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={`w-2 h-2 rounded-full ${theme.dot} mt-1.5 flex-shrink-0 ring-2 ring-white/50 dark:ring-black/30`} />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate leading-tight">{mapping.hrms_project_name}</h3>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {statusLabel && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${theme.text} ${theme.chipBg}`}>
                    {statusLabel}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-muted-foreground bg-white/40 dark:bg-white/5">
                  {mapping.auto_register ? <Zap className="h-2.5 w-2.5" /> : <Hand className="h-2.5 w-2.5" />}
                  {mapping.auto_register ? `자동 ${mapping.cron_time}` : "수동"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-muted-foreground bg-white/40 dark:bg-white/5">
                  <GitBranch className="h-2.5 w-2.5" />
                  {mapping.repos.length}개 저장소
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-0.5 flex-shrink-0">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-white/40 dark:hover:bg-white/10" onClick={() => onEdit(mapping)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-white/40 dark:hover:bg-white/10" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* 저장소 목록 */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3 pl-[18px]">
          <span className="truncate" title={repoNames}>{repoNames}</span>
        </div>

        {/* 최근 등록 업무 */}
        <div className="mb-4 pl-[18px]">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium mb-1.5">
            <ClipboardList className="h-3 w-3 opacity-60" />
            최근 등록 업무
          </div>
          {loadingTasks ? (
            <div className="text-[11px] text-muted-foreground animate-pulse pl-[18px]">불러오는 중...</div>
          ) : recentTasks.length === 0 ? (
            <div className="text-[11px] text-muted-foreground pl-[18px]">등록된 업무 없음</div>
          ) : (
            <div className="space-y-0.5 pl-[18px]">
              {recentTasks.map((task: any) => {
                const date = task.dueDate ? task.dueDate.slice(5, 10).replace("-", "/") : "";
                return (
                  <div key={task.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground font-mono w-10 flex-shrink-0">{date}</span>
                    <span className="truncate">{task.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 프로그레스 표시 */}
        {registering && progressStep && (
          <div className={`flex items-center gap-2 px-1 py-2 text-xs ${
            progressIcon === "done" ? "text-emerald-600 dark:text-emerald-400" :
            progressIcon === "error" ? "text-destructive" :
            "text-muted-foreground"
          }`}>
            <ProgressIconComponent className={`h-3.5 w-3.5 flex-shrink-0 ${progressIcon === "loading" ? "animate-spin" : ""}`} />
            <span>{progressStep}</span>
          </div>
        )}

        {/* 업무 등록 버튼 */}
        <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
            <Upload className="h-3 w-3 opacity-60" />
            업무 등록
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-9"
              onClick={() => handleRegister(getDateString(-1))}
              disabled={registering}
            >
              {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              <span className="ml-1.5">어제 {getDateLabel(-1)}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 bg-white/50 dark:bg-white/5"
              onClick={() => handleRegister(getDateString(0))}
              disabled={registering}
            >
              <Clock className="h-3.5 w-3.5" />
              <span className="ml-1.5">오늘 {getDateLabel(0)}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 w-9 p-0 hover:bg-white/40 dark:hover:bg-white/10"
              onClick={() => setShowDatePicker(!showDatePicker)}
              disabled={registering}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          {showDatePicker && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-auto bg-white/50 dark:bg-white/5"
              />
              <Button
                size="sm"
                className="h-9"
                onClick={() => customDate && handleRegister(customDate)}
                disabled={!customDate || registering}
              >
                {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                <span className="ml-1.5">지정일 등록</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>매핑 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{mapping.hrms_project_name}&quot; 매핑을 삭제하시겠습니까? 자동 등록도 중단됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
