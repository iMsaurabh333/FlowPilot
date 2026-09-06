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
  it("exposes only approved healthy namespaced tools and isolates another server failure", async () => {
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
      now: () => new Date(fresh),
    });

    const tools = await resolver.resolve({
      subject: "operator",
      tenantId: "tenant",
      scopes: ["ChatUser", "ToolOperator"],
    });

    expect(tools.map((tool) => tool.name)).toEqual(["monitoring__search_logs"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not discover or invoke tools for a chat-only identity", async () => {
    const repository = new MemoryMcpRegistryRepository();
    await repository.save(server({}));
    const fetchImpl = vi.fn();
    const resolver = new McpToolResolver({
      repository,
      authResolver: { resolve: async () => ({}) },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date(fresh),
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
      now: () => new Date(fresh),
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
});
