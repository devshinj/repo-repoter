"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/data-display/empty-state";
import { toast } from "sonner";
import { ArrowLeft, GitBranch, GitCommit } from "lucide-react";

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
}

export default function RepoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const repoId = params.id as string;

  const [repo, setRepo] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>("");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  // 저장소 정보 + 브랜치 목록 로드
  useEffect(() => {
    async function load() {
      try {
        const [reposRes, branchesRes] = await Promise.all([
          fetch("/api/repos"),
          fetch(`/api/repos/${repoId}/branches`),
        ]);

        const repos = await reposRes.json();
        const repoData = Array.isArray(repos) ? repos.find((r: any) => r.id === Number(repoId)) : null;
        setRepo(repoData);

        if (branchesRes.ok) {
          const branchList = await branchesRes.json();
          setBranches(Array.isArray(branchList) ? branchList : []);
          if (branchList.length > 0) {
            const defaultBranch = branchList.includes(repoData?.branch || "main")
              ? (repoData?.branch || "main")
              : branchList[0];
            setSelectedBranch(defaultBranch);
          }
        }
      } catch {
        toast.error("저장소 정보를 불러올 수 없습니다");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [repoId]);

  // 브랜치 변경 시 커밋 로드
  useEffect(() => {
    if (!selectedBranch) return;
    setCommitsLoading(true);
    fetch(`/api/repos/${repoId}/commits?branch=${encodeURIComponent(selectedBranch)}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        setCommits(Array.isArray(data) ? data : []);
      })
      .catch(() => toast.error("커밋 목록을 불러올 수 없습니다"))
      .finally(() => setCommitsLoading(false));
  }, [repoId, selectedBranch]);

  if (loading) {
    return <div className="p-8 text-muted-foreground">로딩 중...</div>;
  }

  if (!repo) {
    return (
      <div>
        <Header title="저장소를 찾을 수 없습니다" />
        <Button variant="outline" onClick={() => router.push("/repos")}>
          <ArrowLeft className="h-4 w-4 mr-2" />목록으로
        </Button>
      </div>
    );
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
      + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div>
      <Header
        title={repo.label || `${repo.owner}/${repo.repo}`}
        description={repo.label ? `${repo.owner}/${repo.repo} — ${repo.clone_url}` : repo.clone_url}
        actions={
          <Button variant="outline" onClick={() => router.push("/repos")}>
            <ArrowLeft className="h-4 w-4 mr-2" />목록으로
          </Button>
        }
      />

      {/* 브랜치 선택 + 통계 */}
      <div className="flex items-center gap-4 mb-6">
        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
          <SelectTrigger className="max-w-64">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <SelectValue placeholder="브랜치 선택" />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className="w-auto min-w-[var(--anchor-width)]">
            {branches.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <GitCommit className="h-3.5 w-3.5" />
          <span>{commits.length}개 커밋</span>
        </div>
      </div>

      {/* 커밋 목록 */}
      {commitsLoading ? (
        <div className="py-8 text-center text-muted-foreground">커밋 로딩 중...</div>
      ) : commits.length === 0 ? (
        <EmptyState
          title="커밋이 없습니다"
          description={`${selectedBranch} 브랜치에 커밋이 없거나 아직 클론이 완료되지 않았습니다.`}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">SHA</TableHead>
              <TableHead>메시지</TableHead>
              <TableHead className="w-24">작성자</TableHead>
              <TableHead className="w-40">날짜</TableHead>
              <TableHead className="w-28 text-right">변경</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commits.map((commit) => (
              <Fragment key={commit.sha}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedSha(expandedSha === commit.sha ? null : commit.sha)}
                >
                  <TableCell className="font-mono text-xs">{commit.sha.slice(0, 7)}</TableCell>
                  <TableCell>
                    <span className="line-clamp-1">{commit.message}</span>
                  </TableCell>
                  <TableCell className="text-sm">{commit.author}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(commit.date)}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-green-600 text-xs">+{commit.additions}</span>
                    {" "}
                    <span className="text-red-600 text-xs">-{commit.deletions}</span>
                  </TableCell>
                </TableRow>
                {expandedSha === commit.sha && commit.filesChanged.length > 0 && (
                  <TableRow key={`${commit.sha}-files`}>
                    <TableCell colSpan={5} className="bg-muted/30 p-0">
                      <div className="px-6 py-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          변경된 파일 ({commit.filesChanged.length}개)
                        </p>
                        <div className="space-y-0.5">
                          {commit.filesChanged.map((file) => (
                            <div key={file} className="text-xs font-mono text-muted-foreground">{file}</div>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
