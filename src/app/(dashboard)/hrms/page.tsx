"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Plus, Info, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ApiKeyForm } from "@/components/hrms/api-key-form";
import { MappingCard } from "@/components/hrms/mapping-card";
import { MappingModal } from "@/components/hrms/mapping-modal";
import { RegisterHistory } from "@/components/hrms/register-history";

export default function HrmsPage() {
  const [keyInfo, setKeyInfo] = useState<any>(null);
  const [mappings, setMappings] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteKeyDialogOpen, setDeleteKeyDialogOpen] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState<{ mappingId: number; targetDate: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const keyRes = await fetch("/api/hrms/key");
      const keyData = await keyRes.json();
      setKeyInfo(keyData);

      if (keyData.registered) {
        const [mappingsRes, logsRes] = await Promise.all([
          fetch("/api/hrms/mappings"),
          fetch("/api/hrms/register/history?limit=20"),
        ]);
        setMappings(await mappingsRes.json());
        setLogs(await logsRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRegister(mappingId: number, targetDate?: string, force?: boolean) {
    const res = await fetch("/api/hrms/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingId, targetDate, force }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error);
    } else if (data.duplicate) {
      setDuplicateDialog({ mappingId, targetDate: data.date });
    } else if (data.skipped) {
      toast.info("해당 날짜에 커밋이 없어 등록을 건너뛰었습니다.");
    } else if (data.action === "updated") {
      toast.success(`기존 업무 업데이트 완료 (HRMS #${data.hrmsTaskId})`);
    } else {
      toast.success(`업무 등록 완료 (HRMS #${data.hrmsTaskId})`);
    }
    loadData();
  }

  async function handleDelete(mappingId: number) {
    const res = await fetch(`/api/hrms/mappings/${mappingId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("매핑이 삭제되었습니다.");
      loadData();
    }
  }

  async function handleDeleteKey() {
    await fetch("/api/hrms/key", { method: "DELETE" });
    setKeyInfo(null);
    setMappings([]);
    setLogs([]);
    setDeleteKeyDialogOpen(false);
    toast.success("API Key가 삭제되었습니다.");
    loadData();
  }

  if (loading) return <div />;

  if (!keyInfo?.registered) {
    return <ApiKeyForm onRegistered={loadData} />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">HRMS 업무 관리</h1>
          <a href="https://hrms.cudo.co.kr:9700/" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              HRMS 열기
            </Button>
          </a>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 프로젝트 매핑 추가
        </Button>
      </div>

      {/* 사용자 정보 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          연결: <span className="font-medium text-foreground">{keyInfo.hrmsUserName}</span>
          {" "}({keyInfo.maskedKey})
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setDeleteKeyDialogOpen(true)}>Key 삭제</Button>
        </div>
      </div>

      {/* 안내 문구 */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>자동 등록은 설정된 시각에 전일 업무를 HRMS에 등록합니다. 전일 하루 동안의 커밋을 분석하여 업무 내용을 작성합니다.</span>
      </div>

      {/* 매핑 카드 목록 */}
      <div className="grid gap-4">
        {mappings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            프로젝트 매핑이 없습니다. 위 버튼으로 추가해주세요.
          </p>
        ) : (
          mappings.map((m: any) => (
            <MappingCard
              key={m.id}
              mapping={m}
              onRegister={handleRegister}
              onEdit={(mapping) => { setEditing(mapping); setModalOpen(true); }}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* 등록 이력 */}
      <div>
        <h3 className="text-sm font-medium mb-3">등록 이력</h3>
        <RegisterHistory logs={logs} />
      </div>

      <MappingModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={loadData}
        editing={editing}
      />

      <AlertDialog open={deleteKeyDialogOpen} onOpenChange={setDeleteKeyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              API Key를 삭제하시겠습니까? 모든 매핑의 자동 등록이 중단됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteKey}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!duplicateDialog} onOpenChange={(open) => !open && setDuplicateDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>기존 업무 업데이트</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateDialog?.targetDate}에 이미 등록된 업무가 있습니다. 당일 전체 커밋을 기반으로 기존 업무의 제목과 내용을 업데이트합니다. 진행하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (duplicateDialog) {
                handleRegister(duplicateDialog.mappingId, duplicateDialog.targetDate, true);
              }
              setDuplicateDialog(null);
            }}>등록</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
