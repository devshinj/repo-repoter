"use client";

import { useState } from "react";
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
import { Play, Pencil, Trash2, Loader2, CalendarDays } from "lucide-react";

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
