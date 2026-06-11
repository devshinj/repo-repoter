"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface MappingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editing?: any;
}

export function MappingModal({ open, onClose, onSave, editing }: MappingModalProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [autoRegister, setAutoRegister] = useState(false);
  const [cronTime, setCronTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/hrms/projects").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
    ])
      .then(([p, r]) => {
        setProjects(Array.isArray(p) ? p : []);
        setRepos(Array.isArray(r) ? r : []);
      })
      .catch(() => setError("데이터를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (editing) {
      setSelectedProjectId(String(editing.hrms_project_id));
      setSelectedRepoIds(editing.repos.map((r: any) => r.id));
      setAutoRegister(!!editing.auto_register);
      const timeParts = (editing.cron_time || "0 9 * * 1-5").split(" ");
      setCronTime(`${timeParts[1]?.padStart(2, "0")}:${timeParts[0]?.padStart(2, "0")}`);
    } else {
      setSelectedProjectId("");
      setSelectedRepoIds([]);
      setAutoRegister(false);
      setCronTime("09:00");
    }
  }, [editing, open]);

  function toggleRepo(repoId: number) {
    setSelectedRepoIds((prev) =>
      prev.includes(repoId) ? prev.filter((id) => id !== repoId) : [...prev, repoId]
    );
  }

  async function handleSave() {
    if (!selectedProjectId || selectedRepoIds.length === 0) {
      setError("프로젝트와 저장소를 선택해주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const [hour, minute] = cronTime.split(":").map(Number);
    const cronExpr = `${minute} ${hour} * * 1-5`;

    const payload = {
      hrmsProjectId: parseInt(selectedProjectId, 10),
      repositoryIds: selectedRepoIds,
      autoRegister,
      cronTime: cronExpr,
    };

    try {
      const url = editing ? `/api/hrms/mappings/${editing.id}` : "/api/hrms/mappings";
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "프로젝트 매핑 수정" : "프로젝트 매핑 추가"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>HRMS 프로젝트</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>연결할 저장소</Label>
              <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
                {repos.map((r: any) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedRepoIds.includes(r.id)}
                      onCheckedChange={() => toggleRepo(r.id)}
                    />
                    {r.label || `${r.owner}/${r.repo}`}
                  </label>
                ))}
              </div>
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
