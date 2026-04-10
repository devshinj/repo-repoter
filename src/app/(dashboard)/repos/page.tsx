"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/data-display/empty-state";
import { toast } from "sonner";
import { GitBranch, GitCommit, History, Trash2, RefreshCw, ChevronRight, User, Plus, X } from "lucide-react";
import { repoColor, stringColor, oklch } from "@/lib/color-hash";
import { LanguageBadge } from "@/components/data-display/language-badge";

function parseAuthors(gitAuthor: string | null | undefined): string[] {
  if (!gitAuthor) return [];
  return gitAuthor.split(",").map((a) => a.trim()).filter(Boolean);
}

function AuthorTags({ repo, onSave }: { repo: any; onSave: (id: number, authors: string[]) => void }) {
  const [tags, setTags] = useState<string[]>(parseAuthors(repo.git_author));
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTags(parseAuthors(repo.git_author));
  }, [repo.git_author]);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      toast.error("이미 등록된 이름입니다");
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    setInputValue("");
    onSave(repo.id, next);
  };

  const removeTag = (index: number) => {
    const next = tags.filter((_, i) => i !== index);
    setTags(next);
    onSave(repo.id, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(inputValue);
    }
    if (e.key === "Escape") {
      setIsAdding(false);
      setInputValue("");
    }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 mt-1.5 flex-wrap"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      {tags.map((tag, i) => {
        const tagColor = stringColor(tag);
        return (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors group/tag"
            style={{
              backgroundColor: oklch(tagColor.bgLight),
              color: oklch(tagColor.solid),
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: oklch(tagColor.solid) }}
            />
            {tag}
            <button
              className="ml-0.5 rounded-sm opacity-40 hover:opacity-100 transition-opacity"
              style={{ color: oklch(tagColor.solid) }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeTag(i); }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      {isAdding ? (
        <Input
          ref={inputRef}
          className="h-5 text-[11px] w-28 px-1.5 py-0 rounded-md border-dashed"
          placeholder="이름 입력 후 Enter"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) addTag(inputValue);
            setIsAdding(false);
            setInputValue("");
          }}
        />
      ) : (
        <button
          className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsAdding(true); }}
        >
          <Plus className="h-2.5 w-2.5" />
          {tags.length === 0 ? "Author 추가" : "추가"}
        </button>
      )}
    </div>
  );
}

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

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await fetch(`/api/repos?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("저장소가 삭제되었습니다");
      fetchRepos();
    }
  };

  const handleSync = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
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

  const handleSaveAuthors = async (id: number, authors: string[]) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, gitAuthor: authors.join(", ") }),
    });
    if (res.ok) {
      fetchRepos();
    } else {
      toast.error("Author 저장 실패");
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
        <div className="grid gap-3">
          {repos.map((repo: any) => {
            const color = repoColor(repo.clone_url);

            return (
            <Link key={repo.id} href={`/repos/${repo.id}`}>
              <Card className="group/card relative overflow-hidden transition-colors hover:bg-muted/40 cursor-pointer">
                {/* 상단 그라데이션 글로우 — 도메인 색상 시그니처 */}
                <div
                  className="absolute inset-x-0 top-0 h-[2px] opacity-70 group-hover/card:opacity-100 transition-opacity"
                  style={{ background: `linear-gradient(90deg, ${oklch(color.solid, 0.6)}, ${oklch(color.solid, 0.1)})` }}
                />
                <CardContent className="flex items-center gap-4 py-4">
                  {/* 아이콘 */}
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center dark:hidden"
                    style={{ backgroundColor: oklch(color.bgLight) }}
                  >
                    <History className="h-5 w-5" style={{ color: oklch(color.solid) }} />
                  </div>
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-lg items-center justify-center hidden dark:flex"
                    style={{ backgroundColor: oklch(color.bgDark) }}
                  >
                    <History className="h-5 w-5" style={{ color: oklch(color.solid) }} />
                  </div>

                  {/* 저장소 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{repo.owner}/{repo.repo}</span>
                      <LanguageBadge language={repo.primary_language} />
                      <div className="flex gap-1">
                        {repo.clone_path ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">클론됨</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">클론 중</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {repo.branch}
                      </span>
                      {repo.last_synced_sha && (
                        <span className="flex items-center gap-1">
                          <GitCommit className="h-3 w-3" />
                          <code>{repo.last_synced_sha.slice(0, 7)}</code>
                        </span>
                      )}
                      <span className="truncate max-w-xs">{repo.clone_url}</span>
                    </div>
                    <AuthorTags repo={repo} onSave={handleSaveAuthors} />
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={(e) => handleSync(e, repo.id)}
                      disabled={syncing === repo.id || !repo.clone_path}
                      title="지금 동기화"
                    >
                      <RefreshCw className={`h-4 w-4 ${syncing === repo.id ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(e, repo.id)}
                      title="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            );
          })}
        </div>
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
