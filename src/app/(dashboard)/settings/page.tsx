"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GitBranch, Plus, Pencil, RefreshCw, Trash2 } from "lucide-react";

interface Credential {
  id: number;
  provider: string;
  label: string | null;
  metadata: { type: string; host: string; apiBase: string } | null;
  maskedToken: string;
  createdAt: string;
  updatedAt: string;
}

const providerPresets: Record<string, {
  name: string;
  icon: typeof GitBranch;
  placeholder: string;
  description: string;
}> = {
  git: {
    name: "Git",
    icon: GitBranch,
    placeholder: "ghp_xxxx 또는 glpat-xxxx",
    description: "GitHub, GitLab, Gitea 등의 Personal Access Token",
  },
};

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newProvider] = useState("git");
  const [newLabel, setNewLabel] = useState("");
  const [newToken, setNewToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [newServiceType, setNewServiceType] = useState<"github" | "gitea">("github");
  const [newHost, setNewHost] = useState("");

  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  const [renewingTokenId, setRenewingTokenId] = useState<number | null>(null);
  const [renewTokenValue, setRenewTokenValue] = useState("");

  const fetchCredentials = () => {
    fetch("/api/credentials").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setCredentials(data);
    });
  };

  useEffect(() => { fetchCredentials(); }, []);

  const handleAdd = async () => {
    if (!newToken || !newLabel) {
      toast.error("라벨과 토큰을 모두 입력하세요");
      return;
    }
    if (newServiceType === "gitea" && !newHost) {
      toast.error("Gitea 호스트 URL을 입력하세요");
      return;
    }

    const metadata = newServiceType === "github"
      ? { type: "github", host: "github.com", apiBase: "https://api.github.com" }
      : { type: "gitea", host: newHost, apiBase: `https://${newHost}/api/v1` };

    setSaving(true);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: newProvider, token: newToken, label: newLabel, metadata }),
      });
      if (res.ok) {
        toast.success("자격증명이 등록되었습니다");
        setNewToken("");
        setNewLabel("");
        setNewHost("");
        setNewServiceType("github");
        setAddDialogOpen(false);
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "등록 실패");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLabel = async (id: number) => {
    const res = await fetch(`/api/credentials/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editingLabelValue }),
    });
    if (res.ok) {
      toast.success("라벨이 수정되었습니다");
      setEditingLabelId(null);
      fetchCredentials();
    } else {
      toast.error("라벨 수정 실패");
    }
  };

  const handleRenewToken = async (id: number) => {
    if (!renewTokenValue) {
      toast.error("새 토큰을 입력하세요");
      return;
    }
    const res = await fetch(`/api/credentials/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: renewTokenValue }),
    });
    if (res.ok) {
      toast.success("토큰이 갱신되었습니다");
      setRenewingTokenId(null);
      setRenewTokenValue("");
      fetchCredentials();
    } else {
      toast.error("토큰 갱신 실패");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 자격증명을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("자격증명이 삭제되었습니다");
      fetchCredentials();
    } else {
      toast.error("삭제 실패");
    }
  };

  const gitCredentials = credentials.filter((c) => c.provider === "git");

  return (
    <div>
      <Header title="설정" description="외부 서비스 자격증명을 관리합니다" />

      <div className="space-y-6 max-w-2xl">
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" />
            새 자격증명 등록
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 자격증명 등록</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">서비스 타입</label>
                <div className="flex gap-3 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="serviceType"
                      value="github"
                      checked={newServiceType === "github"}
                      onChange={() => { setNewServiceType("github"); setNewHost(""); }}
                      className="accent-primary"
                    />
                    <span className="text-sm">GitHub</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="serviceType"
                      value="gitea"
                      checked={newServiceType === "gitea"}
                      onChange={() => setNewServiceType("gitea")}
                      className="accent-primary"
                    />
                    <span className="text-sm">Gitea / 기타</span>
                  </label>
                </div>
              </div>
              {newServiceType === "gitea" && (
                <div>
                  <label className="text-sm font-medium">호스트 URL</label>
                  <Input
                    placeholder="gitea.example.com"
                    value={newHost}
                    onChange={(e) => setNewHost(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">프로토콜 없이 호스트명만 입력 (예: gitea.company.com)</p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">라벨</label>
                <Input
                  placeholder="예: 회사 GitHub PAT"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">토큰</label>
                <Input
                  type="password"
                  placeholder={providerPresets[newProvider].placeholder}
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                />
              </div>
              <Button onClick={handleAdd} disabled={saving} className="w-full">
                {saving ? "저장 중..." : "등록"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {gitCredentials.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Git Personal Access Tokens
            </h3>
            {gitCredentials.map((cred) => (
              <Card key={cred.id}>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-1">
                    {editingLabelId === cred.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editingLabelValue}
                          onChange={(e) => setEditingLabelValue(e.target.value)}
                          className="h-8 max-w-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdateLabel(cred.id);
                            if (e.key === "Escape") setEditingLabelId(null);
                          }}
                          autoFocus
                        />
                        <Button size="sm" onClick={() => handleUpdateLabel(cred.id)}>저장</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingLabelId(null)}>취소</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{cred.label || "(라벨 없음)"}</span>
                        <Badge variant="secondary" className="text-xs">
                          {cred.metadata?.type === "gitea" ? `Gitea — ${cred.metadata.host}` : "GitHub"}
                        </Badge>
                      </div>
                    )}

                    <div className="text-sm text-muted-foreground truncate">
                      토큰: <code className="bg-muted px-1 rounded">{cred.maskedToken}</code>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      등록: {new Date(cred.createdAt).toLocaleDateString("ko-KR")}
                      {cred.updatedAt !== cred.createdAt && (
                        <> · 갱신: {new Date(cred.updatedAt).toLocaleDateString("ko-KR")}</>
                      )}
                    </div>

                    {renewingTokenId === cred.id && (
                      <div className="flex items-center gap-2 mt-2">
                        <Input
                          type="password"
                          placeholder={providerPresets.git.placeholder}
                          value={renewTokenValue}
                          onChange={(e) => setRenewTokenValue(e.target.value)}
                          className="h-8 max-w-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenewToken(cred.id);
                            if (e.key === "Escape") { setRenewingTokenId(null); setRenewTokenValue(""); }
                          }}
                        />
                        <Button size="sm" onClick={() => handleRenewToken(cred.id)}>저장</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setRenewingTokenId(null); setRenewTokenValue(""); }}>취소</Button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingLabelId(cred.id);
                        setEditingLabelValue(cred.label || "");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      라벨 수정
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRenewingTokenId(renewingTokenId === cred.id ? null : cred.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      토큰 갱신
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(cred.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      삭제
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {credentials.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              등록된 자격증명이 없습니다. 위 버튼으로 새 자격증명을 추가하세요.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
