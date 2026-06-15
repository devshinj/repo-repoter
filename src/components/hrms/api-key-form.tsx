"use client";

import { useState } from "react";
import { api } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";

interface ApiKeyFormProps {
  onRegistered: () => void;
}

export function ApiKeyForm({ onRegistered }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(api("/hrms/key"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      onRegistered();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-lg mx-auto mt-12">
      <CardHeader className="text-center">
        <KeyRound className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
        <CardTitle>HRMS MCP API Key 등록</CardTitle>
        <CardDescription>
          HRMS 업무 자동 등록을 사용하려면 MCP API Key를 먼저 등록해주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <a
          href="https://mc1024.notion.site/HRMS-MCP-37b60ffc8ee08012bc4af8cbd6d00e73"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          사용 가이드 보기
        </a>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="password"
            placeholder="sk_xxxxxxxx_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !apiKey}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "등록"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
