"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, ChevronDown, ChevronUp, GitBranch, Blocks, Zap, Hand } from "lucide-react";

interface RegisterHistoryProps {
  logs: any[];
}

const hrmsTaskUrl = "https://hrms.cudo.co.kr:9700/tasks";

export function RegisterHistory({ logs }: RegisterHistoryProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">등록 이력이 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log: any) => {
        const logKey = `${log.source ?? "git"}-${log.id}`;
        const isExpanded = expandedKey === logKey;
        const isSuccess = log.status === "success";
        const isSkipped = log.status === "skipped";
        const isLogicraft = log.source === "logicraft";
        const isAuto = log.trigger_type === "auto";

        return (
          <Card key={logKey} className="overflow-hidden">
            <CardContent className="p-0">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedKey(isExpanded ? null : logKey)}
              >
                <Badge
                  variant={isSuccess ? "default" : isSkipped ? "secondary" : "destructive"}
                  className="shrink-0"
                >
                  {isSuccess ? "성공" : isSkipped ? "건너뜀" : "실패"}
                </Badge>
                {isLogicraft
                  ? <Blocks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  : <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                }
                {isAuto ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                    <Zap className="h-2.5 w-2.5" />자동
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-500/10 text-muted-foreground shrink-0">
                    <Hand className="h-2.5 w-2.5" />수동
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">{log.target_date}</span>
                <span className="text-sm font-medium truncate flex-1">
                  {log.hrms_project_name} - {isSuccess ? log.title : isSkipped ? "커밋 없음" : log.error_message}
                </span>
                {isSuccess && log.hrms_task_id && (
                  <a
                    href={hrmsTaskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {isExpanded
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                }
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 border-t">
                  {isSuccess ? (
                    <div className="pt-3 space-y-2">
                      <p className="text-sm font-medium">{log.title}</p>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{log.description}</pre>
                    </div>
                  ) : isSkipped ? (
                    <p className="pt-3 text-sm text-muted-foreground">해당 날짜에 커밋이 없어 등록을 건너뛰었습니다.</p>
                  ) : (
                    <p className="pt-3 text-sm text-destructive">{log.error_message}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
