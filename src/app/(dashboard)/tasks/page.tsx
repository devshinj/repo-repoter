"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/data-display/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api-url";

function extractProperty(page: any, name: string): string {
  const prop = page.properties[name];
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.[0]?.plain_text || "";
  if (prop.type === "rich_text") return prop.rich_text?.[0]?.plain_text || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [dateFilter, setDateFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFilter) params.set("date", dateFilter);

    fetch(api(`/tasks?${params}`))
      .then((r) => r.json())
      .then(setTasks)
      .finally(() => setLoading(false));
  }, [dateFilter]);

  return (
    <div>
      <Header title="일일 태스크" description="Gemini가 분석한 프로젝트별 일일 업무 기록" />

      <div className="mb-4 max-w-xs">
        <label className="text-sm font-medium">날짜 필터</label>
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          title="태스크가 없습니다"
          description="동기화를 실행하면 커밋 분석 결과가 여기에 표시됩니다"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>작업일</TableHead>
              <TableHead>복잡도</TableHead>
              <TableHead>작업 설명</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((page: any) => (
              <TableRow key={page.id}>
                <TableCell className="font-medium">{extractProperty(page, "제목")}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{extractProperty(page, "프로젝트")}</Badge>
                </TableCell>
                <TableCell>{extractProperty(page, "작업일")}</TableCell>
                <TableCell>
                  <Badge>{extractProperty(page, "작업 복잡도")}</Badge>
                </TableCell>
                <TableCell className="max-w-md truncate">{extractProperty(page, "작업 설명")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
