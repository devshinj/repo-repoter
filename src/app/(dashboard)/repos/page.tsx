"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/data-display/empty-state";
import { toast } from "sonner";

export default function ReposPage() {
  const [repos, setRepos] = useState<any[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  const fetchRepos = () => {
    fetch("/api/repos").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setRepos(data);
    });
  };

  useEffect(() => { fetchRepos(); }, []);

  const handleAdd = async () => {
    if (!cloneUrl) {
      toast.error("Git 저장소 URL을 입력하세요");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloneUrl, branch }),
      });

      if (res.ok) {
        toast.success("저장소가 등록되었습니다. 클론 진행 중...");
        setShowDialog(false);
        setCloneUrl("");
        setBranch("main");
        fetchRepos();
      } else {
        const data = await res.json();
        toast.error(data.error || "등록 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/repos?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("저장소가 삭제되었습니다");
      fetchRepos();
    }
  };

  const handleSync = async (id: number) => {
    setSyncing(id);
    try {
      const res = await fetch(`/api/repos/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`동기화 완료: ${data.commitsProcessed}개 커밋, ${data.tasksCreated}개 태스크`);
        fetchRepos();
      } else {
        toast.error(data.error || "동기화 실패");
      }
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div>
      <Header
        title="저장소 관리"
        description="모니터링할 Git 저장소를 등록하고 관리합니다"
        actions={<Button onClick={() => setShowDialog(true)}>저장소 추가</Button>}
      />

      {repos.length === 0 ? (
        <EmptyState
          title="등록된 저장소가 없습니다"
          description="Git 저장소를 추가하여 커밋 모니터링을 시작하세요. 먼저 설정에서 Git PAT을 등록해주세요."
          action={<Button onClick={() => setShowDialog(true)}>첫 저장소 추가</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>저장소</TableHead>
              <TableHead>브랜치</TableHead>
              <TableHead>마지막 동기화 SHA</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.map((repo: any) => (
              <TableRow key={repo.id}>
                <TableCell>
                  <div>
                    <span className="font-medium">{repo.owner}/{repo.repo}</span>
                    <div className="text-xs text-muted-foreground truncate max-w-xs">{repo.clone_url}</div>
                  </div>
                </TableCell>
                <TableCell>{repo.branch}</TableCell>
                <TableCell className="font-mono text-xs">{repo.last_synced_sha?.slice(0, 7) || "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Badge variant={repo.is_active ? "default" : "secondary"}>
                      {repo.is_active ? "활성" : "비활성"}
                    </Badge>
                    {repo.clone_path ? (
                      <Badge variant="outline">클론됨</Badge>
                    ) : (
                      <Badge variant="secondary">클론 중</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(repo.id)}
                      disabled={syncing === repo.id || !repo.clone_path}
                    >
                      {syncing === repo.id ? "동기화 중..." : "지금 동기화"}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(repo.id)}>삭제</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장소 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Git 저장소 URL</label>
              <Input
                placeholder="https://github.com/owner/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">GitHub, GitLab, Gitea 등 HTTPS URL을 지원합니다</p>
            </div>
            <div>
              <label className="text-sm font-medium">브랜치</label>
              <Input
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>취소</Button>
            <Button onClick={handleAdd} disabled={loading}>
              {loading ? "등록 중..." : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
