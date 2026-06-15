"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";

interface LogicraftMappingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editing?: any;
}

export function LogicraftMappingModal({ open, onClose, onSave, editing }: LogicraftMappingModalProps) {
  const [step, setStep] = useState<"key" | "select">("key");
  const [apiKey, setApiKey] = useState("");
  const [keyRegistered, setKeyRegistered] = useState(false);
  const [logicraftProjects, setLogicraftProjects] = useState<any[]>([]);
  const [hrmsProjects, setHrmsProjects] = useState<any[]>([]);

  const [selectedLogicraftId, setSelectedLogicraftId] = useState("");
  const [selectedHrmsId, setSelectedHrmsId] = useState("");
  const [autoRegister, setAutoRegister] = useState(false);
  const [cronTime, setCronTime] = useState("09:00");

  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    fetch(api("/logicraft/key"))
      .then((r) => r.json())
      .then((data) => {
        if (data.registered) {
          setKeyRegistered(true);
          setStep("select");
          loadProjects();
        } else {
          setStep("key");
        }
      });
  }, [open]);

  useEffect(() => {
    if (editing && step === "select") {
      setSelectedHrmsId(String(editing.hrms_project_id));
      setSelectedLogicraftId(editing.logicraft_project_id);
      setAutoRegister(!!editing.auto_register);
      const timeParts = (editing.cron_time || "0 9 * * 1-5").split(" ");
      setCronTime(`${timeParts[1]?.padStart(2, "0")}:${timeParts[0]?.padStart(2, "0")}`);
    } else if (!editing) {
      setSelectedLogicraftId("");
      setSelectedHrmsId("");
      setAutoRegister(false);
      setCronTime("09:00");
    }
  }, [editing, step]);

  async function loadProjects() {
    setLoading(true);
    try {
      const [lcRes, hrmsRes] = await Promise.all([
        fetch(api("/logicraft/verify"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "__stored__" }),
        }).then((r) => r.json()).catch(() => ({ projects: [] })),
        fetch(api("/hrms/projects")).then((r) => r.json()),
      ]);

      setLogicraftProjects(Array.isArray(lcRes.projects) ? lcRes.projects : []);
      setHrmsProjects(Array.isArray(hrmsRes) ? hrmsRes : []);
    } catch {
      setError("프로젝트 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyKey() {
    if (!apiKey.trim()) {
      setError("API key를 입력해주세요.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const saveRes = await fetch(api("/logicraft/key"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json();
        setError(data.error);
        return;
      }

      const verifyRes = await fetch(api("/logicraft/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        setError(verifyData.error);
        return;
      }

      setLogicraftProjects(verifyData.projects ?? []);
      setKeyRegistered(true);

      const hrmsRes = await fetch(api("/hrms/projects")).then((r) => r.json());
      setHrmsProjects(Array.isArray(hrmsRes) ? hrmsRes : []);

      setStep("select");
    } catch {
      setError("검증 중 오류가 발생했습니다.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    if (!selectedLogicraftId || !selectedHrmsId) {
      setError("LogiCraft 프로젝트와 HRMS 프로젝트를 모두 선택해주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const lcProject = logicraftProjects.find((p: any) => p.id === selectedLogicraftId);
    const hrmsProject = hrmsProjects.find((p: any) => String(p.id) === selectedHrmsId);

    const [hour, minute] = cronTime.split(":").map(Number);
    const cronExpr = `${minute} ${hour} * * 1-5`;

    const payload = {
      hrmsProjectId: parseInt(selectedHrmsId, 10),
      hrmsProjectName: hrmsProject?.name ?? "",
      logicraftProjectId: selectedLogicraftId,
      logicraftProjectName: lcProject?.name ?? "",
      autoRegister,
      cronTime: cronExpr,
    };

    try {
      const url = editing ? api(`/logicraft/mappings/${editing.id}`) : api("/logicraft/mappings");
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        return;
      }

      onSave();
      onClose();
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl w-[90vw]">
        <DialogHeader>
          <DialogTitle>{editing ? "LogiCraft 매핑 수정" : "LogiCraft 매핑 추가"}</DialogTitle>
        </DialogHeader>

        {step === "key" && !keyRegistered ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4" />
              LogiCraft API Key를 입력해주세요
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="LogiCraft API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button onClick={handleVerifyKey} disabled={verifying}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span className="ml-1.5">검증 및 등록</span>
              </Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>LogiCraft 프로젝트</Label>
              <Select value={selectedLogicraftId} onValueChange={(v) => v && setSelectedLogicraftId(v)} disabled={!!editing}>
                <SelectTrigger className="w-full"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent className="w-[var(--anchor-width)] min-w-80" alignItemWithTrigger={false}>
                  {logicraftProjects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>HRMS 프로젝트</Label>
              <Select value={selectedHrmsId} onValueChange={(v) => v && setSelectedHrmsId(v)} disabled={!!editing}>
                <SelectTrigger className="w-full"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent className="w-[var(--anchor-width)] min-w-80" alignItemWithTrigger={false}>
                  {hrmsProjects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label>자동 등록</Label>
              <Switch checked={autoRegister} onCheckedChange={setAutoRegister} />
            </div>

            {autoRegister && (
              <div className="space-y-2">
                <Label>등록 시각</Label>
                <Input type="time" value={cronTime} onChange={(e) => setCronTime(e.target.value)} />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
