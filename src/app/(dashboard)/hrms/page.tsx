"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Info } from "lucide-react";
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

  async function handleRegister(mappingId: number) {
    const res = await fetch("/api/hrms/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingId }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error);
    else alert(data.skipped ? "커밋 없음 — 등록 건너뜀" : `등록 완료 (HRMS #${data.hrmsTaskId})`);
    loadData();
  }

  async function handleDelete(mappingId: number) {
    const res = await fetch(`/api/hrms/mappings/${mappingId}`, { method: "DELETE" });
    if (res.ok) loadData();
  }

  async function handleDeleteKey() {
    if (!confirm("API Key를 삭제하시겠습니까? 모든 매핑의 자동 등록이 중단됩니다.")) return;
    await fetch("/api/hrms/key", { method: "DELETE" });
    setKeyInfo(null);
    setMappings([]);
    setLogs([]);
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
        <h1 className="text-2xl font-bold">HRMS 업무 관리</h1>
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
          <Button size="sm" variant="outline" onClick={handleDeleteKey}>Key 삭제</Button>
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
    </div>
  );
}
