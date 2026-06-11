const hrmsEndpoint = "https://hrms.cudo.co.kr:9700/api/mcp";

let requestId = 0;

export class HrmsMcpError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HrmsMcpError";
  }
}

export function buildJsonRpcPayload(toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: ++requestId,
    method: "tools/call" as const,
    params: { name: toolName, arguments: args },
  };
}

export function parseToolResult(response: any): any {
  if (response.error) {
    throw new HrmsMcpError(
      response.error.code?.toString() ?? "UNKNOWN",
      response.error.message ?? "Unknown MCP error",
    );
  }

  const textContent = response.result?.content?.find((c: any) => c.type === "text");
  if (!textContent?.text) {
    throw new HrmsMcpError("EMPTY_RESPONSE", "No text content in MCP response");
  }

  return JSON.parse(textContent.text);
}

async function callMcpTool(apiKey: string, toolName: string, args: Record<string, unknown>): Promise<any> {
  const payload = buildJsonRpcPayload(toolName, args);

  const res = await fetch(hrmsEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new HrmsMcpError("HTTP_ERROR", `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return parseToolResult(json);
}

// ── Business functions ──

export interface HrmsUserInfo {
  id: string;
  name: string;
  email: string;
  permissions: { can_read: boolean; can_write: boolean; can_create: boolean; can_delete: boolean };
}

export async function verifyApiKey(apiKey: string): Promise<HrmsUserInfo> {
  const result = await callMcpTool(apiKey, "whoami", {});
  return {
    id: result.data.user.id,
    name: result.data.user.name,
    email: result.data.user.email,
    permissions: result.my_permissions,
  };
}

export interface HrmsProject {
  id: number;
  name: string;
  description: string | null;
  status: string;
  projectType: string | null;
  teamId: number;
}

export async function listProjects(apiKey: string): Promise<HrmsProject[]> {
  const result = await callMcpTool(apiKey, "list_projects", {});
  return result.data.projects;
}

export async function getProject(apiKey: string, id: number): Promise<HrmsProject> {
  const result = await callMcpTool(apiKey, "get_project", { id });
  return result.data.project ?? result.data;
}

export interface CreateTaskParams {
  title: string;
  description: string;
  projectId: number;
  assigneeId?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  timeSpentMinutes?: number;
}

export interface CreatedTask {
  id: number;
  title: string;
}

export async function createTask(apiKey: string, params: CreateTaskParams): Promise<CreatedTask> {
  const args: Record<string, unknown> = {
    title: params.title,
    description: params.description,
    projectId: params.projectId,
    status: params.status ?? "done",
    priority: params.priority ?? "medium",
    dueDate: params.dueDate,
    timeSpentMinutes: params.timeSpentMinutes,
  };
  if (params.assigneeId) args.assigneeId = params.assigneeId;
  const result = await callMcpTool(apiKey, "create_task", args);
  return result.data?.task ?? result.data;
}

export async function listCommonCodes(apiKey: string, groupCode?: string) {
  const args: Record<string, unknown> = {};
  if (groupCode) args.groupCode = groupCode;
  const result = await callMcpTool(apiKey, "list_common_codes", args);
  return result.data;
}

export interface HrmsTask {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  projectId: number;
}

export async function listTasks(apiKey: string, params: { projectId?: number; dueFrom?: string; dueTo?: string }): Promise<HrmsTask[]> {
  const args: Record<string, unknown> = { scope: "createdByMe" };
  if (params.projectId) args.projectId = params.projectId;
  if (params.dueFrom) args.dueFrom = params.dueFrom;
  if (params.dueTo) args.dueTo = params.dueTo;
  const result = await callMcpTool(apiKey, "list_tasks", args);
  return result.data?.tasks ?? result.data ?? [];
}

export interface UpdateTaskParams {
  id: number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  timeSpentMinutes?: number;
}

export async function updateTask(apiKey: string, params: UpdateTaskParams): Promise<any> {
  const args: Record<string, unknown> = { id: params.id };
  if (params.title !== undefined) args.title = params.title;
  if (params.description !== undefined) args.description = params.description;
  if (params.status !== undefined) args.status = params.status;
  if (params.priority !== undefined) args.priority = params.priority;
  if (params.dueDate !== undefined) args.dueDate = params.dueDate;
  if (params.timeSpentMinutes !== undefined) args.timeSpentMinutes = params.timeSpentMinutes;
  const result = await callMcpTool(apiKey, "update_task", args);
  return result.data;
}
