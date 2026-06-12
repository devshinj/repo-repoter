"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Play, Pencil, Trash2, Loader2, CalendarDays, ClipboardList } from "lucide-react";

interface MappingCardProps {
  mapping: any;
  onRegister: (mappingId: number, targetDate?: string) => Promise<void>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
}

function getDateString(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function MappingCard({ mapping, onRegister, onEdit, onDelete }: MappingCardProps) {
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  useEffect(() => {
    setLoadingTasks(true);
    fetch(`/api/hrms/tasks?projectId=${mapping.hrms_project_id}`)
      .then(r => r.ok ? r.json() : [])
      .then(tasks => {
        // Sort by dueDate desc and take first 3
        const sorted = (Array.isArray(tasks) ? tasks : [])
          .sort((a: any, b: any) => (b.dueDate || "").localeCompare(a.dueDate || ""))
          .slice(0, 3);
        setRecentTasks(sorted);
      })
      .catch(() => setRecentTasks([]))
      .finally(() => setLoadingTasks(false));
  }, [mapping.hrms_project_id]);

  async function handleRegister(targetDate?: string) {
    setRegistering(true);
    try {
      await onRegister(mapping.id, targetDate);
    } finally {
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

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{mapping.hrms_project_name}</CardTitle>
            <Badge variant={mapping.auto_register ? "default" : "secondary"}>
              {mapping.auto_register ? `자동 ${mapping.cron_time}` : "수동"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            저장소: {mapping.repos.map((r: any) => r.label || `${r.owner}/${r.repo}`).join(", ")}
          </div>
          {/* 최근 등록 업무 */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <ClipboardList className="h-3 w-3" />
              최근 등록 업무
            </div>
            {loadingTasks ? (
              <div className="text-xs text-muted-foreground animate-pulse pl-4">불러오는 중...</div>
            ) : recentTasks.length === 0 ? (
              <div className="text-xs text-muted-foreground pl-4">등록된 업무 없음</div>
            ) : (
              <div className="space-y-0.5 pl-4">
                {recentTasks.map((task: any) => {
                  const date = task.dueDate ? task.dueDate.slice(5, 10).replace("-", "/") : "";
                  return (
                    <div key={task.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground font-mono w-10 flex-shrink-0">{date}</span>
                      <span className="truncate">{task.title}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => handleRegister(getDateString(-1))} disabled={registering}>
              {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              <span className="ml-1">전일 등록</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleRegister(getDateString(0))} disabled={registering}>
              당일 등록
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowDatePicker(!showDatePicker)} disabled={registering}>
              <CalendarDays className="h-3.5 w-3.5" />
            </Button>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(mapping)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          {showDatePicker && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-auto"
              />
              <Button
                size="sm"
                onClick={() => customDate && handleRegister(customDate)}
                disabled={!customDate || registering}
              >
                {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "지정일 등록"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
