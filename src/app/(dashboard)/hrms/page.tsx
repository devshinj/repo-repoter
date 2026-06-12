"use client";

import { useCallback, useEffect, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Info, ExternalLink, Unlink, RefreshCw, Loader2, AlertTriangle, Blocks, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { ApiKeyForm } from "@/components/hrms/api-key-form";
import { MappingCard } from "@/components/hrms/mapping-card";
import { MappingModal } from "@/components/hrms/mapping-modal";
import { LogicraftMappingCard } from "@/components/hrms/logicraft-mapping-card";
import { LogicraftMappingModal } from "@/components/hrms/logicraft-mapping-modal";
import { RegisterHistory } from "@/components/hrms/register-history";
import { ProjectCarousel } from "@/components/hrms/project-carousel";

export default function HrmsPage() {
  const [keyInfo, setKeyInfo] = useState<any>(null);
  const [mappings, setMappings] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [changeKeyDialogOpen, setChangeKeyDialogOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [changingKey, setChangingKey] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState<{ mappingId: number; targetDate: string } | null>(null);
  const [lcMappings, setLcMappings] = useState<any[]>([]);
  const [lcModalOpen, setLcModalOpen] = useState(false);
  const [lcEditing, setLcEditing] = useState<any>(null);
  const [lcDuplicateDialog, setLcDuplicateDialog] = useState<{ mappingId: number; targetDate: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const keyRes = await fetch("/api/hrms/key");
      const keyData = await keyRes.json();
      setKeyInfo(keyData);

      if (keyData.registered) {
        const [mappingsRes, logsRes, projectsRes, lcMappingsRes] = await Promise.all([
          fetch("/api/hrms/mappings"),
          fetch("/api/hrms/register/history?limit=10"),
          fetch("/api/hrms/projects-enriched"),
          fetch("/api/logicraft/mappings"),
        ]);
        setMappings(await mappingsRes.json());
        setLogs(await logsRes.json());
        const projData = await projectsRes.json();
        setProjects(Array.isArray(projData) ? projData : []);
        setLcMappings(await lcMappingsRes.json().catch(() => []));
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

  async function handleLcRegister(mappingId: number, targetDate?: string, force?: boolean) {
    const res = await fetch("/api/logicraft/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingId, targetDate, force }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error);
    } else if (data.duplicate) {
      setLcDuplicateDialog({ mappingId, targetDate: data.date });
    } else if (data.skipped) {
      toast.info("해당 날짜에 LogiCraft 활동이 없어 등록을 건너뛰었습니다.");
    } else if (data.action === "updated") {
      toast.success(`기존 업무 업데이트 완료 (HRMS #${data.hrmsTaskId})`);
    } else {
      toast.success(`업무 등록 완료 (HRMS #${data.hrmsTaskId})`);
    }
    loadData();
  }

  async function handleLcDelete(mappingId: number) {
    const res = await fetch(`/api/logicraft/mappings/${mappingId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("LogiCraft 매핑이 삭제되었습니다.");
      loadData();
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/hrms/key", { method: "DELETE" });
      setKeyInfo(null);
      setMappings([]);
      setLogs([]);
      setProjects([]);
      setDisconnectDialogOpen(false);
      toast.success("HRMS 연결이 해제되었습니다.");
      loadData();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleChangeKey() {
    if (!newApiKey.trim()) return;
    setChangingKey(true);
    try {
      const res = await fetch("/api/hrms/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newApiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error);
      } else {
        toast.success(`Key 변경 완료 — ${data.hrmsUserName}`);
        setChangeKeyDialogOpen(false);
        setNewApiKey("");
        loadData();
      }
    } finally {
      setChangingKey(false);
    }
  }

  if (loading) return <div />;

  if (!keyInfo?.registered) {
    return <ApiKeyForm onRegistered={loadData} />;
  }

  const stats = keyInfo.stats ?? { mappingCount: 0, logCount: 0, autoCount: 0 };

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
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> 저장소 매핑 추가
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setLcEditing(null); setLcModalOpen(true); }}>
            <Blocks className="h-4 w-4 mr-1" /> LogiCraft 매핑 추가
          </Button>
        </div>
      </div>

      {/* 사용자 정보 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          연결: <span className="font-medium text-foreground">{keyInfo.hrmsUserName}</span>
          {" "}({keyInfo.maskedKey})
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setNewApiKey(""); setChangeKeyDialogOpen(true); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Key 변경
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDisconnectDialogOpen(true)}>
            <Unlink className="h-3.5 w-3.5 mr-1" />
            연결 해제
          </Button>
        </div>
      </div>

      {/* 참여 프로젝트 캐러셀 */}
      <ProjectCarousel />

      {/* 안내 문구 */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>자동 등록은 설정된 시각에 전일 업무를 HRMS에 등록합니다. 전일 하루 동안의 커밋을 분석하여 업무 내용을 작성합니다.</span>
      </div>

      {/* 매핑 카드 목록 */}
      <div className="space-y-6">
        {/* Repo 매핑 카드 */}
        {mappings.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Repo 매핑
            </h3>
            <div className="grid gap-4">
              {mappings.map((m: any) => {
                const proj = projects.find((p: any) => p.id === m.hrms_project_id);
                return (
                  <MappingCard
                    key={m.id}
                    mapping={m}
                    projectStatus={proj?.status}
                    statusLabel={proj?.statusLabel}
                    onRegister={handleRegister}
                    onEdit={(mapping) => { setEditing(mapping); setModalOpen(true); }}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* LogiCraft 매핑 카드 */}
        {lcMappings.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Blocks className="h-3.5 w-3.5" />
              LogiCraft 매핑
            </h3>
            <div className="grid gap-4">
              {lcMappings.map((m: any) => (
                <LogicraftMappingCard
                  key={m.id}
                  mapping={m}
                  onRegister={handleLcRegister}
                  onEdit={(mapping) => { setLcEditing(mapping); setLcModalOpen(true); }}
                  onDelete={handleLcDelete}
                />
              ))}
            </div>
          </div>
        )}

        {mappings.length === 0 && lcMappings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            프로젝트 매핑이 없습니다. 위 버튼으로 추가해주세요.
          </p>
        )}
      </div>

      {/* 등록 이력 */}
      <div>
        <h3 className="text-sm font-medium mb-3">등록 이력 <span className="text-muted-foreground font-normal">최근 10건</span></h3>
        <RegisterHistory logs={logs} />
      </div>

      <MappingModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={loadData}
        editing={editing}
      />

      <LogicraftMappingModal
        open={lcModalOpen}
        onClose={() => { setLcModalOpen(false); setLcEditing(null); }}
        onSave={loadData}
        editing={lcEditing}
      />

      {/* LogiCraft 중복 등록 확인 모달 */}
      <AlertDialog open={!!lcDuplicateDialog} onOpenChange={(open) => !open && setLcDuplicateDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>기존 업무 업데이트</AlertDialogTitle>
            <AlertDialogDescription>
              {lcDuplicateDialog?.targetDate}에 이미 등록된 업무가 있습니다. LogiCraft 활동을 기반으로 기존 업무를 업데이트합니다. 진행하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (lcDuplicateDialog) {
                handleLcRegister(lcDuplicateDialog.mappingId, lcDuplicateDialog.targetDate, true);
              }
              setLcDuplicateDialog(null);
            }}>등록</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 연결 해제 경고 모달 */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              HRMS 연결 해제
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              HRMS 연결 해제 확인
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{keyInfo.hrmsUserName}</span> 계정의 HRMS 연결을 해제합니다.
            </p>
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm space-y-1">
              <p className="font-medium text-destructive">다음 데이터가 모두 삭제됩니다:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>프로젝트 매핑 <span className="font-medium text-foreground">{stats.mappingCount}건</span></li>
                <li>등록 이력 <span className="font-medium text-foreground">{stats.logCount}건</span></li>
                {stats.autoCount > 0 && (
                  <li>자동 등록 스케줄 <span className="font-medium text-foreground">{stats.autoCount}건</span> 중단</li>
                )}
                <li>저장된 API Key</li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">이미 HRMS에 등록된 업무는 삭제되지 않습니다.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Unlink className="h-4 w-4 mr-1" />}
              연결 해제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Key 변경 모달 */}
      <Dialog open={changeKeyDialogOpen} onOpenChange={setChangeKeyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>API Key 변경</DialogTitle>
            <DialogDescription>
              새로운 HRMS API Key를 입력하세요. 기존 매핑과 이력은 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              현재: <span className="font-medium text-foreground">{keyInfo.hrmsUserName}</span> ({keyInfo.maskedKey})
            </div>
            <Input
              type="password"
              placeholder="sk_xxxxxxxx_..."
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              disabled={changingKey}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeKeyDialogOpen(false)} disabled={changingKey}>
              취소
            </Button>
            <Button onClick={handleChangeKey} disabled={!newApiKey.trim() || changingKey}>
              {changingKey ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              변경
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 중복 등록 확인 모달 */}
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
