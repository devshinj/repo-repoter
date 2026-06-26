import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHrmsApiKey } from "@/infra/db/hrms";
import { decrypt } from "@/infra/crypto/token-encryption";
import { listProjects, listCommonCodes } from "@/infra/hrms/hrms-client";

// org tree를 직접 호출하여 teamId/groupId → 이름 매핑
async function fetchOrgMap(apiKey: string): Promise<{ teams: Map<number, string>; orgs: Map<number, string> }> {
  const teams = new Map<number, string>();
  const orgs = new Map<number, string>();

  try {
    const endpoint = "https://hrms.cudo.co.kr:9700/api/mcp";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_org_tree", arguments: { includeMembers: false } },
      }),
    });
    if (!res.ok) return { teams, orgs };
    const json = await res.json();
    const text = json.result?.content?.find((c: any) => c.type === "text")?.text;
    if (!text) return { teams, orgs };
    const data = JSON.parse(text);

    for (const company of data.data?.companies ?? []) {
      for (const bu of company.businessUnits ?? []) {
        for (const org of bu.organizations ?? []) {
          orgs.set(org.id, org.name);
          for (const team of org.teams ?? []) {
            teams.set(team.id, team.name);
          }
        }
      }
    }
  } catch { /* non-critical */ }

  return { teams, orgs };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyRow = await getHrmsApiKey(session.user.id);
  if (!keyRow) return NextResponse.json({ error: "HRMS API key not registered" }, { status: 400 });

  try {
    const apiKey = decrypt(keyRow.encrypted_key);

    const [projects, orgMap, statusCodes, typeCodes] = await Promise.all([
      listProjects(apiKey),
      fetchOrgMap(apiKey),
      listCommonCodes(apiKey, "PROJECT_STATUS").catch(() => null),
      listCommonCodes(apiKey, "PROJECT_TYPE").catch(() => null),
    ]);

    // 공통코드 → 라벨 매핑
    const statusMap = new Map<string, { name: string; color: string }>();
    const typeMap = new Map<string, { name: string; color: string }>();

    for (const group of statusCodes?.groups ?? []) {
      for (const code of group.codes ?? []) {
        statusMap.set(code.code, { name: code.name, color: code.color });
      }
    }
    for (const group of typeCodes?.groups ?? []) {
      for (const code of group.codes ?? []) {
        typeMap.set(code.code, { name: code.name, color: code.color });
      }
    }

    const enriched = projects.map((p: any) => ({
      ...p,
      teamName: orgMap.teams.get(p.teamId) ?? null,
      groupName: orgMap.orgs.get(p.groupId) ?? null,
      statusLabel: statusMap.get(p.status)?.name ?? p.status,
      statusColor: statusMap.get(p.status)?.color ?? "bg-gray-500",
      typeLabel: typeMap.get(p.projectType)?.name ?? p.projectType ?? null,
      typeColor: typeMap.get(p.projectType)?.color ?? null,
    }));

    return NextResponse.json(enriched);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
