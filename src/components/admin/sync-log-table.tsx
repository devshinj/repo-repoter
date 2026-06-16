"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface SyncLogRow {
  id: number;
  completed_at: string | null;
  repo_name: string;
  user_name: string;
  status: string;
  commits_processed: number;
  tasks_created: number;
  error_message: string | null;
}

interface FilterUser {
  id: number;
  name: string;
}

interface FilterRepo {
  id: number;
  repo: string;
  user_id: string;
}

interface SyncLogsResponse {
  logs: SyncLogRow[];
  filters: {
    users: FilterUser[];
    repos: FilterRepo[];
  };
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MM}-${DD} ${HH}:${mm}`;
}

export function SyncLogTable() {
  const [data, setData] = useState<SyncLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("all");
  const [repoId, setRepoId] = useState("all");
  const [status, setStatus] = useState("all");

  async function load(uid: string, rid: string, st: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (uid !== "all") params.set("userId", uid);
      if (rid !== "all") params.set("repoId", rid);
      if (st !== "all") params.set("status", st);

      const res = await fetch(`${basePath}/api/admin/sync-logs?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(userId, repoId, status);
  }, [userId, repoId, status]);

  const logs = data?.logs ?? [];
  const filterUsers = data?.filters.users ?? [];
  const filterRepos = data?.filters.repos ?? [];

  return (
    <div className="space-y-5">
      {/* 필터 */}
      <div className="flex items-center gap-3">
        <Select value={userId} onValueChange={(v) => setUserId(v ?? "all")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="전체 사용자" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 사용자</SelectItem>
            {filterUsers.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={repoId} onValueChange={(v) => setRepoId(v ?? "all")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="전체 저장소" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 저장소</SelectItem>
            {filterRepos.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.repo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="전체 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="success">성공</SelectItem>
            <SelectItem value="error">오류</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 테이블 */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>저장소</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">커밋</TableHead>
              <TableHead className="text-right">태스크</TableHead>
              <TableHead>에러</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  동기화 로그가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTime(log.completed_at)}
                  </TableCell>
                  <TableCell className="font-medium">{log.repo_name}</TableCell>
                  <TableCell className="text-muted-foreground">{log.user_name}</TableCell>
                  <TableCell>
                    {log.status === "success" ? (
                      <Badge variant="default">성공</Badge>
                    ) : (
                      <Badge variant="destructive">오류</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{log.commits_processed}</TableCell>
                  <TableCell className="text-right">{log.tasks_created}</TableCell>
                  <TableCell className="max-w-[240px]">
                    {log.error_message ? (
                      <span
                        className="text-destructive text-xs truncate block"
                        title={log.error_message}
                      >
                        {log.error_message}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
