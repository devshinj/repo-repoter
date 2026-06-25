"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface SchedulerStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  syncStartedAt: string | null;
  scheduled: boolean;
  intervalMin: number;
}

interface SchedulerRepoRow {
  repo_id: number;
  owner: string;
  repo: string;
  branch: string;
  polling_interval_min: number;
  is_active: number;
  auto_report_enabled: number;
  sync_status: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

interface HrmsMappingRow {
  id: number;
  repo_ids: string;
  auto_register: number;
  cron_time: string;
  hrms_project_name: string;
  user_id: string;
}

interface LogicraftMappingRow {
  id: number;
  auto_register: number;
  cron_time: string;
  logicraft_project_name: string;
  user_id: string;
  hrms_project_id: number;
}

interface SchedulerResponse {
  scheduler: SchedulerStatus;
  repos: SchedulerRepoRow[];
  hrmsMappings: HrmsMappingRow[];
  logicraftMappings: LogicraftMappingRow[];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  // SQLite UTC datetime → 올바른 UTC Date 파싱
  const normalized = dateStr.includes("T") || dateStr.endsWith("Z")
    ? dateStr : dateStr.replace(" ", "T") + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function SchedulerTable() {
  const [data, setData] = useState<SchedulerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/admin/scheduler`, {
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
    load();
  }, []);

  async function toggleSync(repo: SchedulerRepoRow) {
    await fetch(`${basePath}/api/admin/scheduler/repos/${repo.repo_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: repo.is_active === 0 }),
    });
    load();
  }

  async function toggleAutoReport(repo: SchedulerRepoRow) {
    await fetch(`${basePath}/api/admin/scheduler/repos/${repo.repo_id}/auto-report`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: repo.auto_report_enabled === 0 }),
    });
    load();
  }

  async function toggleHrms(mapping: HrmsMappingRow) {
    await fetch(`${basePath}/api/admin/scheduler/hrms-mappings/${mapping.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: mapping.auto_register === 0 }),
    });
    load();
  }

  async function toggleLogicraft(mapping: LogicraftMappingRow) {
    await fetch(`${basePath}/api/admin/scheduler/logicraft-mappings/${mapping.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: mapping.auto_register === 0 }),
    });
    load();
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">불러오는 중...</p>;
  }

  if (!data) {
    return <p className="text-destructive text-sm">데이터를 불러올 수 없습니다.</p>;
  }

  const { scheduler, repos, hrmsMappings, logicraftMappings } = data;

  return (
    <div className="space-y-5">
      {/* 스케줄러 상태 카드 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">스케줄러 상태</p>
              <div className="flex items-center gap-2 mt-1">
                {scheduler.isRunning ? (
                  <Badge variant="default">Running</Badge>
                ) : (
                  <Badge variant="secondary">Stopped</Badge>
                )}
                {scheduler.scheduled && (
                  <span className="text-xs text-muted-foreground">
                    매 {scheduler.intervalMin}분
                  </span>
                )}
              </div>
            </div>
            <div className="ml-8">
              <p className="text-sm font-medium text-muted-foreground">마지막 실행</p>
              <p className="text-sm mt-1">{timeAgo(scheduler.lastRunAt)}</p>
            </div>
            {scheduler.syncStartedAt && (
              <div className="ml-8">
                <p className="text-sm font-medium text-muted-foreground">동기화 시작</p>
                <p className="text-sm mt-1">{timeAgo(scheduler.syncStartedAt)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 범례 */}
      <div className="flex items-center gap-5 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
          <span className="text-blue-400">동기화</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
          <span className="text-purple-400">HRMS 등록</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-pink-400 inline-block" />
          <span className="text-pink-400">LogiCraft</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          <span className="text-yellow-400">보고서</span>
        </span>
      </div>

      {/* 저장소 테이블 */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>사용자</TableHead>
              <TableHead>저장소</TableHead>
              <TableHead>마지막 동기화</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-center text-blue-400">동기화</TableHead>
              <TableHead className="text-center text-purple-400">HRMS 등록</TableHead>
              <TableHead className="text-center text-pink-400">LogiCraft</TableHead>
              <TableHead className="text-center text-yellow-400">보고서</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  등록된 저장소가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              repos.map((repo) => {
                const hrmsMapping = hrmsMappings.find((m) => {
                  if (!m.repo_ids) return false;
                  return m.repo_ids
                    .split(",")
                    .map((id) => id.trim())
                    .includes(String(repo.repo_id));
                });
                const lcMapping = logicraftMappings.find(
                  (m) => m.user_id === repo.user_id
                );

                return (
                  <TableRow key={repo.repo_id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{repo.user_name}</p>
                        <p className="text-xs text-muted-foreground">{repo.user_email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{repo.owner}/{repo.repo}</p>
                        <p className="text-xs text-muted-foreground">{repo.branch}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {timeAgo(repo.last_sync_at)}
                    </TableCell>
                    <TableCell>
                      {repo.last_sync_status === "success" ? (
                        <Badge variant="default">성공</Badge>
                      ) : repo.last_sync_status === "error" ? (
                        <Badge variant="destructive">오류</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        size="sm"
                        checked={repo.is_active === 1}
                        onCheckedChange={() => toggleSync(repo)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {hrmsMapping ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            size="sm"
                            checked={hrmsMapping.auto_register === 1}
                            onCheckedChange={() => toggleHrms(hrmsMapping)}
                          />
                          {hrmsMapping.auto_register === 1 && hrmsMapping.cron_time && (
                            <span className="text-xs text-muted-foreground">
                              {hrmsMapping.cron_time}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {lcMapping ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            size="sm"
                            checked={lcMapping.auto_register === 1}
                            onCheckedChange={() => toggleLogicraft(lcMapping)}
                          />
                          {lcMapping.auto_register === 1 && lcMapping.cron_time && (
                            <span className="text-xs text-muted-foreground">
                              {lcMapping.cron_time}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        size="sm"
                        checked={repo.auto_report_enabled === 1}
                        onCheckedChange={() => toggleAutoReport(repo)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
