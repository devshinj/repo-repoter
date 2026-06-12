"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, ChevronDown, ChevronUp, GitBranch, Blocks } from "lucide-react";

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
        const isLogicraft = log.source === "logicraft";

        return (
          <Card key={logKey} className="overflow-hidden">
            <CardContent className="p-0">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedKey(isExpanded ? null : logKey)}
              >
                <Badge variant={isSuccess ? "default" : "destructive"} className="shrink-0">
                  {isSuccess ? "성공" : "실패"}
                </Badge>
                {isLogicraft
                  ? <Blocks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  : <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                }
                <span className="text-xs text-muted-foreground shrink-0">{log.target_date}</span>
                <span className="text-sm font-medium truncate flex-1">
                  {log.hrms_project_name} - {isSuccess ? log.title : log.error_message}
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
