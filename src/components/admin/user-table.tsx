"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/data-display/stat-card";
import { ConfirmDialog } from "@/components/data-display/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface AdminUser {
  id: number;
  name: string;
  email: string;
  provider: string;
  is_active: number;
  created_at: string;
  repo_count: number;
}

interface AdminUserStats {
  total: number;
  active: number;
  inactive: number;
}

interface UsersResponse {
  users: AdminUser[];
  stats: AdminUserStats;
}

export function UserTable() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/admin/users`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(user: AdminUser) {
    await fetch(`${basePath}/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: user.is_active === 0 }),
    });
    load();
  }

  async function handleDelete(id: number) {
    await fetch(`${basePath}/api/admin/users/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    load();
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">불러오는 중...</p>;
  }

  if (!data) {
    return <p className="text-destructive text-sm">데이터를 불러올 수 없습니다.</p>;
  }

  const { users, stats } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="전체 사용자" value={stats.total} />
        <StatCard label="활성 사용자" value={stats.active} />
        <StatCard label="비활성 사용자" value={stats.inactive} />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>로그인 방식</TableHead>
              <TableHead className="text-right">저장소 수</TableHead>
              <TableHead>가입일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  등록된 사용자가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow
                  key={user.id}
                  className={user.is_active === 0 ? "opacity-50" : undefined}
                >
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{user.provider}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{user.repo_count}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {user.created_at
                      ? new Date(
                          user.created_at.includes("T") || user.created_at.endsWith("Z")
                            ? user.created_at
                            : user.created_at.replace(" ", "T") + "Z"
                        ).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {user.is_active === 1 ? (
                      <Badge variant="default">활성</Badge>
                    ) : (
                      <Badge variant="secondary">비활성</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleActive(user)}
                      >
                        {user.is_active === 1 ? "비활성화" : "활성화"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteTarget(user)}
                      >
                        삭제
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="사용자 삭제"
        description={
          deleteTarget
            ? `${deleteTarget.name}(${deleteTarget.email}) 사용자와 관련 데이터를 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다.`
            : ""
        }
        confirmLabel="삭제"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}
