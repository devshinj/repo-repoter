import { describe, it, expect } from "vitest";
import { buildJsonRpcPayload, parseToolResult, HrmsMcpError } from "@/infra/hrms/hrms-client";

describe("buildJsonRpcPayload", () => {
  it("builds valid JSON-RPC 2.0 payload", () => {
    const payload = buildJsonRpcPayload("whoami", {});
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.method).toBe("tools/call");
    expect(payload.params.name).toBe("whoami");
    expect(payload.params.arguments).toEqual({});
    expect(typeof payload.id).toBe("number");
  });
});

describe("parseToolResult", () => {
  it("extracts data from successful response", () => {
    const response = {
      result: {
        content: [{ type: "text", text: '{"data":{"user":{"name":"test"}},"warnings":[]}' }],
      },
      jsonrpc: "2.0",
      id: 1,
    };
    const data = parseToolResult(response);
    expect(data.data.user.name).toBe("test");
  });

  it("throws HrmsMcpError on JSON-RPC error", () => {
    const response = {
      error: { code: -32000, message: "Not found" },
      jsonrpc: "2.0",
      id: 1,
    };
    expect(() => parseToolResult(response)).toThrow(HrmsMcpError);
  });

  it("throws on empty response content", () => {
    const response = {
      result: { content: [] },
      jsonrpc: "2.0",
      id: 1,
    };
    expect(() => parseToolResult(response)).toThrow(HrmsMcpError);
  });
});
