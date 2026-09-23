import { describe, expect, it, vi } from "vitest";

import {
  MemoryMcpRegistryRepository,
  type McpServerRecord,
} from "../src/mcp/registry.js";
import { McpToolResolver } from "../src/mcp/tool-resolver.js";

const fresh = "2026-09-06T10:00:00.000Z";

function server(overrides: Partial<McpServerRecord>): McpServerRecord {
  return {
    serverId: "monitoring",
    policyPresetId: "generic",
    displayName: "Monitoring",
    endpointUrl: "http://127.0.0.1:4100",
    mcpPath: "/mcp",
    externalPort: null,
    authProfileRef: "destination:MONITORING",
    allowedToolNames: ["search_logs"],
    requiredScopes: ["McpInvoke"],
    enabled: true,
    healthState: "healthy",
    lastCheckedAt: fresh,
    latencyMs: 1,
    protocolVersion: "2026-07-28",
    discoveredToolCount: 1,
    lastErrorCategory: null,
    createdAt: fresh,
    updatedAt: fresh,
    ...overrides,
  };
}

function response(payload: object) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MCP tool resolution", () => {
  it("keeps previously confirmed servers available after the health timestamp ages, while excluding disabled and unhealthy servers", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({ serverId: "monitoring" }));
    await repository.save(
      server({
        serverId: "events",
        endpointUrl: "http://127.0.0.1:4200",
        authProfileRef: "destination:EVENTS",
        allowedToolNames: ["inspect_events"],
      }),
    );
    await repository.save(server({ serverId: "disabled", enabled: false }));
    await repository.save(
      server({ serverId: "unhealthy", healthState: "unhealthy" }),
    );
    await repository.save(
      server({
        serverId: "stale",
        lastCheckedAt: "2026-09-06T09:54:59.999Z",
      }),
    );
    const fetchImpl = vi.fn(async (request: Request | URL) => {
      const url = String(request);
      if (url.includes("4100")) {
        return response({
          jsonrpc: "2.0",
          result: {
            tools: [
              {
                name: "search_logs",
                description: "Search logs",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
        });
      }
      throw new Error("second fake MCP server is unavailable");
    });
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({ Authorization: "Bearer test" }) },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const tools = await resolver.resolve({
      subject: "operator",
      tenantId: "tenant",
      scopes: ["ChatUser", "ToolOperator"],
    });

    expect(tools.map((tool) => tool.name)).toEqual(["monitoring__search_logs", "stale__search_logs"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not discover or invoke tools for a chat-only identity", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({}));
    const fetchImpl = vi.fn();
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({}) },
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      resolver.resolve({
        subject: "chat",
        tenantId: "tenant",
        scopes: ["ChatUser"],
      }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invokes the selected namespaced tool only through its owning server", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({}));
    const fetchImpl = vi.fn(
      async (_request: Request | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        return body.method === "tools/list"
          ? response({
              jsonrpc: "2.0",
              result: {
                tools: [
                  {
                    name: "search_logs",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              },
            })
          : response({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "one approved result" }],
              },
            });
      },
    );
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({}) },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const [tool] = await resolver.resolve({
      subject: "operator",
      tenantId: "tenant",
      scopes: ["ChatUser", "ToolOperator"],
    });
    await expect(tool.invoke({})).resolves.toBe("one approved result");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      method: "tools/call",
      params: { name: "search_logs", arguments: {} },
    });
  });

  it("normalizes copied Unicode dashes in identifier fields for every MCP tool", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({ allowedToolNames: ["get_record"] }));
    const fetchImpl = vi.fn(async (_request: Request | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return body.method === "tools/list"
        ? response({ jsonrpc: "2.0", result: { tools: [{ name: "get_record", inputSchema: { type: "object" } }] } })
        : response({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "record" }] } });
    });
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({}) },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const [tool] = await resolver.resolve({
      subject: "operator",
      tenantId: "tenant",
      scopes: ["ChatUser", "ToolOperator"],
    });
    await tool.invoke({ defectId: "CPI‑611889", query: "Keep‑this text unchanged" });

    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      params: {
        name: "get_record",
        arguments: {
          defectId: "CPI-611889",
          query: "Keep‑this text unchanged",
        },
      },
    });
  });

  it("uses the session negotiated by a stateful legacy MCP server", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({ protocolVersion: "2025-11-25" }));
    const fetchImpl = vi.fn(
      async (_request: Request | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        const headers = new Headers(init?.headers);
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", result: { protocolVersion: "2025-11-25" } }),
            { status: 200, headers: { "Mcp-Session-Id": "session-123" } },
          );
        }
        if (body.method === "tools/list" && !headers.has("Mcp-Session-Id")) {
          return response({ jsonrpc: "2.0", error: { code: -32_000 } });
        }
        expect(headers.get("Mcp-Session-Id")).toBe("session-123");
        expect(headers.get("MCP-Protocol-Version")).toBe("2025-11-25");
        if (body.method === "tools/list") {
          return response({
            jsonrpc: "2.0",
            result: {
              tools: [{ name: "search_logs", inputSchema: { type: "object", properties: {} } }],
            },
          });
        }
        return response({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "stateful result" }] } });
      },
    );
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({}) },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const [tool] = await resolver.resolve({ subject: "operator", tenantId: "tenant", scopes: ["ChatUser", "ToolOperator"] });
    await expect(tool.invoke({})).resolves.toBe("stateful result");
  });
});
