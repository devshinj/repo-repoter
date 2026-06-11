"use client";

import { Badge } from "@/components/ui/badge";

interface RegisterHistoryProps {
  logs: any[];
}

export function RegisterHistory({ logs }: RegisterHistoryProps) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">등록 이력이 없습니다.</p>;
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium">날짜</th>
            <th className="text-left px-3 py-2 font-medium">프로젝트</th>
            <th className="text-left px-3 py-2 font-medium">상태</th>
            <th className="text-left px-3 py-2 font-medium">제목</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <tr key={log.id} className="border-t">
              <td className="px-3 py-2">{log.target_date}</td>
              <td className="px-3 py-2">{log.hrms_project_name}</td>
              <td className="px-3 py-2">
                <Badge variant={log.status === "success" ? "default" : "destructive"}>
                  {log.status === "success" ? "성공" : "실패"}
                </Badge>
              </td>
              <td className="px-3 py-2 truncate max-w-xs">
                {log.status === "error" ? log.error_message : log.title}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
