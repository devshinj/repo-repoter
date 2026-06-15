"use client";

import { useEffect } from "react";
import { signIn } from "next-auth/react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function HrmsPopupPage() {
  useEffect(() => {
    signIn("hrms", { callbackUrl: `${basePath}/popup-close` });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">HRMS 인증 페이지로 이동 중...</p>
    </div>
  );
}
