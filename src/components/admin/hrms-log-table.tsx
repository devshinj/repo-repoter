"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/data-display/stat-card";
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

interface HrmsLogRow {
  id: number;
  created_at: string;
  user_name: string;
  hrms_project_name: string;
  target_date: string;
  title: string;
  status: string;
  error_message: string | null;
}

interface HrmsLogStats {
  total: number;
  success: number;
  error: number;
  skipped: number;
}

interface FilterUser {
  id: number;
  name: string;
}

interface FilterProject {
  hrms_project_id: number;
  hrms_project_name: string;
}

interface HrmsLogsResponse {
  logs: HrmsLogRow[];
  stats: HrmsLogStats;
  filters: {
    users: FilterUser[];
    projects: FilterProject[];
  };
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MM}-${DD} ${HH}:${mm}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "success":
      return <Badge variant="default">성공</Badge>;
    case "error":
      return <Badge variant="destructive">오류</Badge>;
    case "skipped":
      return <Badge variant="secondary">건너뜀</Badge>;
    case "in_progress":
      return <Badge variant="outline">진행중</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function HrmsLogTable() {
  const [data, setData] = useState<HrmsLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("");

  async function load(uid: string, pid: string, st: string, dt: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (uid !== "all") params.set("userId", uid);
      if (pid !== "all") params.set("projectId", pid);
      if (st !== "all") params.set("status", st);
      if (dt) params.set("date", dt);

      const res = await fetch(`${basePath}/api/admin/hrms-logs?${params}`, {
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
    load(userId, projectId, status, date);
  }, [userId, projectId, status, date]);

  const logs = data?.logs ?? [];
  const stats = data?.stats ?? { total: 0, success: 0, error: 0, skipped: 0 };
  const filterUsers = data?.filters.users ?? [];
  const filterProjects = data?.filters.projects ?? [];

  return (
    <div className="space-y-5">
      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="오늘 등록" value={stats.total} />
        <StatCard label="성공" value={stats.success} />
        <StatCard label="실패" value={stats.error} />
        <StatCard label="건너뜀" value={stats.skipped} />
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
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

        <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "all")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="전체 프로젝트" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 프로젝트</SelectItem>
            {filterProjects.map((p) => (
              <SelectItem key={p.hrms_project_id} value={String(p.hrms_project_id)}>
                {p.hrms_project_name}
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
            <SelectItem value="skipped">건너뜀</SelectItem>
            <SelectItem value="in_progress">진행중</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          className="w-[160px]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* 테이블 */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>HRMS 프로젝트</TableHead>
              <TableHead>대상일</TableHead>
              <TableHead>업무 제목</TableHead>
              <TableHead>상태</TableHead>
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
                  HRMS 로그가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTime(log.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{log.user_name}</TableCell>
                  <TableCell className="font-medium">{log.hrms_project_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {log.target_date}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={log.title}>
                    {log.title}
                  </TableCell>
                  <TableCell>{statusBadge(log.status)}</TableCell>
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
