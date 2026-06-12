import type { LogicraftProject, LogicraftItemSummary, LogicraftProposal } from "@/core/types";

const logicraftEndpoint = "https://logicraft.cudo.co.kr:10000/api/mcp";

let requestId = 0;

export class LogicraftMcpError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LogicraftMcpError";
  }
}

function buildJsonRpcPayload(toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: ++requestId,
    method: "tools/call" as const,
    params: { name: toolName, arguments: args },
  };
}

function parseToolResult(response: any): any {
  if (response.error) {
    throw new LogicraftMcpError(
      response.error.code?.toString() ?? "UNKNOWN",
      response.error.message ?? "Unknown MCP error",
    );
  }

  const textContent = response.result?.content?.find((c: any) => c.type === "text");
  if (!textContent?.text) {
    throw new LogicraftMcpError("EMPTY_RESPONSE", "No text content in MCP response");
  }

  return JSON.parse(textContent.text);
}

async function callMcpTool(apiKey: string, toolName: string, args: Record<string, unknown>): Promise<any> {
  const payload = buildJsonRpcPayload(toolName, args);

  const res = await fetch(logicraftEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new LogicraftMcpError("HTTP_ERROR", `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return parseToolResult(json);
}

// ── Business functions ──

export async function verifyApiKey(apiKey: string): Promise<LogicraftProject[]> {
  return listProjects(apiKey);
}

export async function listProjects(apiKey: string): Promise<LogicraftProject[]> {
  const result = await callMcpTool(apiKey, "list_projects", {});
  return result.projects ?? result.data?.projects ?? [];
}

export async function listItems(
  apiKey: string,
  projectId: string,
  type: string,
  options?: { limit?: number; offset?: number },
): Promise<LogicraftItemSummary[]> {
  const args: Record<string, unknown> = { project_id: projectId, type };
  if (options?.limit) args.limit = options.limit;
  if (options?.offset) args.offset = options.offset;
  const result = await callMcpTool(apiKey, "list_items", args);
  return result.items ?? result.data?.items ?? [];
}

export async function listProposals(
  apiKey: string,
  projectId: string,
  status?: string,
): Promise<LogicraftProposal[]> {
  const args: Record<string, unknown> = { project_id: projectId };
  if (status) args.status = status;
  const result = await callMcpTool(apiKey, "list_proposals", args);
  return result.proposals ?? result.data?.proposals ?? [];
}

export async function getItem(
  apiKey: string,
  projectId: string,
  id: string,
): Promise<any> {
  const result = await callMcpTool(apiKey, "get_item", { project_id: projectId, id });
  return result.item ?? result.data?.item ?? result;
}

export async function listNotes(
  apiKey: string,
  projectId: string,
  search?: string,
): Promise<any[]> {
  const args: Record<string, unknown> = { project_id: projectId };
  if (search) args.search = search;
  const result = await callMcpTool(apiKey, "list_notes", args);
  return result.notes ?? result.data?.notes ?? [];
}

/** 주요 ITEM 타입 목록 — 일일 활동 수집 시 순회 대상 */
export const activityItemTypes = [
  "requirement",
  "feature",
  "adr",
  "domain_feature",
  "api_endpoint",
  "screen_spec",
  "domain",
  "use_case",
  "erd",
  "diagram_sequence",
  "test_scenario",
] as const;
