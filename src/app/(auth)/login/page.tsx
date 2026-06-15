"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/layout/logo";
import { GitBranch, FileText, Send } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다");
      setLoading(false);
    } else {
      window.location.href = `${basePath}/`;
    }
  };

  const handleHrmsLogin = () => {
    signIn("hrms", { callbackUrl: `${basePath}/` });
  };

  const features = [
    { icon: GitBranch, label: "커밋 자동 수집" },
    { icon: FileText, label: "AI 보고서 생성" },
    { icon: Send, label: "HRMS 자동 등록" },
  ];

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      {/* 도트 그리드 배경 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* 중앙 집중 radial fade */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, transparent 0%, var(--background) 100%)",
        }}
      />

      {/* 콘텐츠 */}
      <div className="relative z-10 w-full max-w-md px-4 flex flex-col items-center gap-6">
        {/* 로고 + 태그라인 */}
        <div
          className="flex flex-col items-center gap-3"
          style={{ animation: "login-enter 0.6s ease-out 0.05s backwards" }}
        >
          <Logo asLink={false} />
          <p className="font-mono text-xs text-muted-foreground/70 tracking-wide text-center">
            작업 이력 수집부터 업무보고까지, 자동으로
          </p>
        </div>

        {/* 로그인 카드 */}
        <Card
          className="w-full backdrop-blur-sm bg-card/80"
          style={{ animation: "login-enter 0.6s ease-out 0.2s backwards" }}
        >
          <CardContent className="pt-6">
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium">이메일</label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">비밀번호</label>
                <Input
                  type="password"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "로그인 중..." : "이메일로 로그인"}
              </Button>
            </form>

            <div className="relative my-6">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card/80 px-3 text-xs text-muted-foreground">
                또는
              </span>
            </div>

            <Button variant="outline" className="w-full" onClick={handleHrmsLogin}>
              HRMS로 로그인
            </Button>

            <p className="text-center text-sm text-muted-foreground mt-4">
              계정이 없으신가요?{" "}
              <Link href="/register" className="text-primary underline">
                회원가입
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* 기능 요약 */}
        <div
          className="flex items-center gap-4 text-muted-foreground/60"
          style={{ animation: "login-enter 0.6s ease-out 0.4s backwards" }}
        >
          {features.map((f, i) => (
            <div key={f.label} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-border mr-3 select-none">/</span>}
              <f.icon className="h-3.5 w-3.5" />
              <span className="text-xs font-mono whitespace-nowrap">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes login-enter {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
