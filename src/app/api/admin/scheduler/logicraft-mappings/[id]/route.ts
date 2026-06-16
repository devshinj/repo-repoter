import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/infra/db/connection";
import { toggleLogicraftAutoRegister } from "@/infra/db/admin-repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) 필수" }, { status: 400 });
  }

  const db = getDb();
  toggleLogicraftAutoRegister(db, Number(id), enabled);

  return NextResponse.json({ ok: true });
}
