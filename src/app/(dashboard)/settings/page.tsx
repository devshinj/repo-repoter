"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Credential {
  id: number;
  provider: string;
  label: string | null;
  metadata: Record<string, string> | null;
  maskedToken: string;
}

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [gitToken, setGitToken] = useState("");
  const [gitLabel, setGitLabel] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [notionCommitDbId, setNotionCommitDbId] = useState("");
  const [notionTaskDbId, setNotionTaskDbId] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchCredentials = () => {
    fetch("/api/credentials").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setCredentials(data);
    });
  };

  useEffect(() => { fetchCredentials(); }, []);

  const gitCred = credentials.find((c) => c.provider === "git");
  const notionCred = credentials.find((c) => c.provider === "notion");

  const handleSaveGit = async () => {
    if (!gitToken) { toast.error("토큰을 입력하세요"); return; }
    setLoading(true);
    try {
      const method = gitCred ? "PUT" : "POST";
      const res = await fetch("/api/credentials", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "git", token: gitToken, label: gitLabel || null }),
      });
      if (res.ok) {
        toast.success("Git PAT이 저장되었습니다");
        setGitToken("");
        setGitLabel("");
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "저장 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotion = async () => {
    if (!notionToken || !notionCommitDbId || !notionTaskDbId) {
      toast.error("모든 필드를 입력하세요");
      return;
    }
    setLoading(true);
    try {
      const method = notionCred ? "PUT" : "POST";
      const res = await fetch("/api/credentials", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "notion",
          token: notionToken,
          metadata: { notionCommitDbId, notionTaskDbId },
        }),
      });
      if (res.ok) {
        toast.success("Notion 설정이 저장되었습니다");
        setNotionToken("");
        setNotionCommitDbId("");
        setNotionTaskDbId("");
        fetchCredentials();
      } else {
        const data = await res.json();
        toast.error(data.error || "저장 실패");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (provider: string) => {
    const res = await fetch(`/api/credentials?provider=${provider}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("자격증명이 삭제되었습니다");
      fetchCredentials();
    }
  };

  return (
    <div>
      <Header title="설정" description="외부 서비스 자격증명을 관리합니다" />

      <div className="space-y-6 max-w-2xl">
        {/* Git PAT */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Git Personal Access Token</CardTitle>
                <CardDescription>GitHub, GitLab, Gitea 등의 PAT을 등록합니다</CardDescription>
              </div>
              {gitCred && <Badge variant="default">등록됨</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {gitCred && (
              <div className="mb-4 p-3 bg-muted rounded-md flex items-center justify-between">
                <div>
                  <span className="text-sm text-muted-foreground">현재 토큰: </span>
                  <code className="text-sm">{gitCred.maskedToken}</code>
                  {gitCred.label && <span className="text-sm text-muted-foreground ml-2">({gitCred.label})</span>}
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("git")}>삭제</Button>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">토큰</label>
                <Input
                  type="password"
                  placeholder="ghp_xxxx 또는 glpat-xxxx"
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">라벨 (선택)</label>
                <Input
                  placeholder="예: 회사 GitHub PAT"
                  value={gitLabel}
                  onChange={(e) => setGitLabel(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveGit} disabled={loading}>
                {gitCred ? "토큰 갱신" : "토큰 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notion API */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Notion 연동</CardTitle>
                <CardDescription>Notion API 키와 데이터베이스 ID를 설정합니다</CardDescription>
              </div>
              {notionCred && <Badge variant="default">등록됨</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {notionCred && (
              <div className="mb-4 p-3 bg-muted rounded-md flex items-center justify-between">
                <div>
                  <span className="text-sm text-muted-foreground">현재 토큰: </span>
                  <code className="text-sm">{notionCred.maskedToken}</code>
                  {notionCred.metadata && (
                    <div className="text-xs text-muted-foreground mt-1">
                      커밋 DB: {notionCred.metadata.notionCommitDbId?.slice(0, 8)}...
                      {" / "}태스크 DB: {notionCred.metadata.notionTaskDbId?.slice(0, 8)}...
                    </div>
                  )}
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("notion")}>삭제</Button>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Notion API 키</label>
                <Input
                  type="password"
                  placeholder="ntn_xxxx"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">커밋 로그 DB ID</label>
                <Input
                  placeholder="Notion 데이터베이스 ID"
                  value={notionCommitDbId}
                  onChange={(e) => setNotionCommitDbId(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">일일 태스크 DB ID</label>
                <Input
                  placeholder="Notion 데이터베이스 ID"
                  value={notionTaskDbId}
                  onChange={(e) => setNotionTaskDbId(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveNotion} disabled={loading}>
                {notionCred ? "설정 갱신" : "설정 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Gemini (글로벌) */}
        <Card>
          <CardHeader>
            <CardTitle>Gemini API</CardTitle>
            <CardDescription>서버 공통 설정으로 관리됩니다</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Gemini API 키는 서버 환경 변수(<code className="bg-muted px-1 rounded">GEMINI_API_KEY</code>)로 관리됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
