import { NextRequest, NextResponse } from "next/server";
import { createAdminToken, setAdminCookie, clearAdminCookie } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD가 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { password } = body;

  if (password !== adminPassword) {
    return NextResponse.json({ error: "암호가 일치하지 않습니다" }, { status: 401 });
  }

  const token = await createAdminToken();
  await setAdminCookie(token);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
}
