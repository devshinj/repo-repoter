"use client";

import { useEffect } from "react";

export default function PopupClosePage() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: "hrms-oauth-complete" }, window.location.origin);
    }
    window.close();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">로그인 완료! 창을 닫는 중...</p>
    </div>
  );
}
