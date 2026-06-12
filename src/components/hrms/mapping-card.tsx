"use client";

import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";

interface MappingCardProps {
  mapping: any;
  projectStatus?: string;
  statusLabel?: string;
  onRegister: (mappingId: number, targetDate?: string) => Promise<void>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
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

// 캐러셀과 동일한 프로젝트 상태 기반 테마
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

export function MappingCard({ mapping, projectStatus, statusLabel, onRegister, onEdit, onDelete }: MappingCardProps) {
  const [registering, setRegistering] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  const theme = getStatusTheme(projectStatus ?? "");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLoadingTasks(true);
    fetch(`/api/hrms/tasks?projectId=${mapping.hrms_project_id}`)
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

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    const repoCount = mapping.repos?.length ?? 1;

    // 시뮬레이션 프로그레스: 동기화 → 생성 → 등록
    const steps: string[] = [];
    for (let i = 1; i <= repoCount; i++) {
      steps.push(`저장소 동기화 중... (${i}/${repoCount})`);
    }
    steps.push("업무 내용 생성 중...");
    steps.push("HRMS 등록 중...");

    let stepIndex = 0;
    setProgressStep(steps[0]);
    intervalRef.current = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setProgressStep(steps[stepIndex]);
        if (stepIndex === steps.length - 1 && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, 2000);

    try {
      await onRegister(mapping.id, targetDate);
      setProgressStep(null);
    } catch {
      setProgressStep(null);
    } finally {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setRegistering(false);
      setShowDatePicker(false);
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
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
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
