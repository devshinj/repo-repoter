"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pencil, Trash2, Loader2 } from "lucide-react";

interface MappingCardProps {
  mapping: any;
  onRegister: (mappingId: number) => Promise<void>;
  onEdit: (mapping: any) => void;
  onDelete: (mappingId: number) => Promise<void>;
}

export function MappingCard({ mapping, onRegister, onEdit, onDelete }: MappingCardProps) {
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleRegister() {
    setRegistering(true);
    try {
      await onRegister(mapping.id);
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete() {
    if (!confirm("이 매핑을 삭제하시겠습니까?")) return;
    setDeleting(true);
    try {
      await onDelete(mapping.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{mapping.hrms_project_name}</CardTitle>
          <Badge variant={mapping.auto_register ? "default" : "secondary"}>
            {mapping.auto_register ? `자동 ${mapping.cron_time}` : "수동"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          저장소: {mapping.repos.map((r: any) => r.label || `${r.owner}/${r.repo}`).join(", ")}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRegister} disabled={registering}>
            {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span className="ml-1">수동 등록</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEdit(mapping)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
