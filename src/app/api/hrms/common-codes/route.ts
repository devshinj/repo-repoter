import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listCommonCodes } from "@/infra/hrms/hrms-client";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyRow = await getHrmsApiKey(session.user.id);
  if (!keyRow) {
    return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });
  }

  const groupCode = request.nextUrl.searchParams.get("groupCode") ?? undefined;

  try {
    const apiKey = decrypt(keyRow.encrypted_key);
    const codes = await listCommonCodes(apiKey, groupCode);
    return NextResponse.json(codes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
