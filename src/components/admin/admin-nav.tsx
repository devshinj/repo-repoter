"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const tabs = [
  { label: "사용자 관리", href: "/admin" },
  { label: "스케줄러", href: "/admin/scheduler" },
  { label: "동기화 로그", href: "/admin/sync-logs" },
  { label: "HRMS 로그", href: "/admin/hrms-logs" },
];

export function AdminNav() {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch(`${basePath}/api/admin/auth`, { method: "DELETE", credentials: "include" });
    window.location.reload();
  }

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b bg-card">
      <div className="flex items-center gap-4">
        <span className="text-base font-bold">AutoBriify Admin</span>
        <nav className="flex gap-0.5">
          {tabs.map((tab) => {
            const isActive =
              tab.href === "/admin"
                ? pathname === "/admin" || pathname === `${basePath}/admin`
                : pathname.startsWith(tab.href) || pathname.startsWith(`${basePath}${tab.href}`);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-3.5 py-1.5 text-sm rounded-md transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <button
        onClick={handleLogout}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        로그아웃 ✕
      </button>
    </header>
  );
}
