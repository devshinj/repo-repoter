"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { stringColor } from "@/lib/color-hash";
import { LayoutDashboard, GitFork, CalendarDays, FileText, Settings, LogOut, ExternalLink } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/layout/logo";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { DotIdenticon } from "@/components/data-display/dot-identicon";

const navItems = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/repos", label: "저장소 관리", icon: GitFork },
  { href: "/task-calendar", label: "태스크 캘린더", icon: CalendarDays },
  { href: "/reports", label: "업무 보고서", icon: FileText },
  { href: "/settings", label: "설정", icon: Settings },
];

interface SidebarProps {
  user: { name: string; email: string };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const userName = user.name;
  const userEmail = user.email;
  const userColorSet = stringColor(userEmail || userName);

  return (
    <aside className="fixed left-0 top-0 h-full w-60 border-r bg-card flex flex-col">
      <div className="p-5">
        <Logo />
      </div>
      <Separator />
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              variant={isActive ? "secondary" : "ghost"}
              className={cn("w-full justify-start gap-3", isActive && "bg-accent")}
              nativeButton={false}
              render={<Link href={item.href} />}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
        <Separator className="my-2" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          nativeButton={false}
          render={<a href="https://hrms.cudo.co.kr:9700/tasks" target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="h-4 w-4" />
          HRMS 태스크
        </Button>
      </nav>
      <Separator />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <DotIdenticon value={userEmail || userName} size={28} colorSet={userColorSet} className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{userName}</p>
            {userEmail && <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>}
          </div>
          <ThemeSwitch />
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </Button>
      </div>
    </aside>
  );
}
