"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target } from "lucide-react";
import { api } from "@/lib/api-url";
import type { MilestoneParseResult } from "@/core/feed/briefing-prompt";

interface MilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRawInput?: string;
  preselectedScope?: { type: "project" | "repository"; id: number; name: string } | null;
  projects: Array<{ id: number; name: string }>;
  repositories: Array<{ id: number; name: string }>;
  onCreated: () => void;
}

export function MilestoneDialog({
  open,
  onOpenChange,
  initialRawInput = "",
  preselectedScope,
  projects,
  repositories,
  onCreated,
}: MilestoneDialogProps) {
  const [rawInput, setRawInput] = useState(initialRawInput);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [parseResult, setParseResult] = useState<MilestoneParseResult | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDeadline, setEditedDeadline] = useState("");
  const [selectedScope, setSelectedScope] = useState<{
    type: string;
    id: number;
  } | null>(
    preselectedScope ? { type: preselectedScope.type, id: preselectedScope.id } : null
  );

  // Sync initialRawInput and preselectedScope when dialog opens
  useEffect(() => {
    if (open) {
      setRawInput(initialRawInput);
      setSelectedScope(
        preselectedScope ? { type: preselectedScope.type, id: preselectedScope.id } : null
      );
      setParseResult(null);
      setEditedTitle("");
      setEditedDeadline("");
    }
  }, [open, initialRawInput, preselectedScope]);

  function resetState() {
    setRawInput("");
    setParseResult(null);
    setEditedTitle("");
    setEditedDeadline("");
    setSelectedScope(
      preselectedScope ? { type: preselectedScope.type, id: preselectedScope.id } : null
    );
  }

  async function handleParse() {
    if (!rawInput.trim()) return;
    setIsParsing(true);
    try {
      const res = await fetch(api("/milestones/parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: rawInput.trim() }),
      });
      const data: MilestoneParseResult = await res.json();
      setParseResult(data);
      setEditedTitle(data.title || rawInput);
      setEditedDeadline(data.deadline || "");
      if (data.suggestedScope && !preselectedScope) {
        setSelectedScope({ type: data.suggestedScope.type, id: data.suggestedScope.id });
      }
    } catch (err) {
      console.error("milestone parse error:", err);
    } finally {
      setIsParsing(false);
    }
  }

  async function handleCreate() {
    if (!editedTitle.trim() || !selectedScope) return;
    setIsCreating(true);
    try {
      await fetch(api("/milestones"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editedTitle.trim(),
          rawInput: rawInput.trim(),
          deadline: editedDeadline || null,
          projectId: selectedScope.type === "project" ? selectedScope.id : null,
          repositoryId: selectedScope.type === "repository" ? selectedScope.id : null,
        }),
      });
      onCreated();
      onOpenChange(false);
      resetState();
    } catch (err) {
      console.error("milestone create error:", err);
    } finally {
      setIsCreating(false);
    }
  }

  const confidenceLabel = (confidence: "high" | "medium" | "low") => {
    if (confidence === "high") return "높은 확신";
    if (confidence === "medium") return "보통";
    return "낮은 확신";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetState();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            마일스톤 설정
          </DialogTitle>
        </DialogHeader>

        {!parseResult ? (
          <div className="space-y-4">
            <Input
              placeholder="목표를 자유롭게 입력하세요..."
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleParse();
              }}
              autoFocus
            />
            {preselectedScope && (
              <p className="text-xs text-muted-foreground">
                연결 대상:{" "}
                <span className="font-medium text-foreground">
                  {preselectedScope.name}
                </span>
              </p>
            )}
            <Button
              className="w-full"
              onClick={handleParse}
              disabled={isParsing || !rawInput.trim()}
            >
              {isParsing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isParsing ? "분석 중..." : "확인"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">제목</label>
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">마감일</label>
              <Input
                type="date"
                value={editedDeadline}
                onChange={(e) => setEditedDeadline(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">연결 대상</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {projects.map((p) => (
                  <Badge
                    key={`p-${p.id}`}
                    variant={
                      selectedScope?.type === "project" && selectedScope.id === p.id
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => setSelectedScope({ type: "project", id: p.id })}
                  >
                    {p.name}
                  </Badge>
                ))}
                {repositories.map((r) => (
                  <Badge
                    key={`r-${r.id}`}
                    variant={
                      selectedScope?.type === "repository" && selectedScope.id === r.id
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => setSelectedScope({ type: "repository", id: r.id })}
                  >
                    {r.name}
                  </Badge>
                ))}
              </div>
              {parseResult.suggestedScope && (
                <p className="text-xs text-muted-foreground mt-1">
                  AI 추천: {parseResult.suggestedScope.name} (
                  {confidenceLabel(parseResult.suggestedScope.confidence)})
                </p>
              )}
            </div>
          </div>
        )}

        {parseResult && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setParseResult(null)}>
              다시 입력
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !editedTitle.trim() || !selectedScope}
            >
              {isCreating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              설정 완료
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
