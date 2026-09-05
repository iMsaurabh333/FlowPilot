import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  HttpMcpServerProbe,
  type McpAuthProfileResolver,
} from "../src/mcp/probe.js";
import type { McpServerRecord } from "../src/mcp/registry.js";

const serverRecord: McpServerRecord = {
  serverId: "cloud-integration",
  profileId: "cloud-integration-monitoring",
  displayName: "Cloud Integration monitoring",
  endpointUrl: "http://127.0.0.1",
  mcpPath: "/mcp",
  externalPort: null,
  authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_MPL",
  allowedToolNames: ["search_message_processing_logs"],
  requiredScopes: ["McpInvoke"],
  enabled: false,
  healthState: "never_checked",
  lastCheckedAt: null,
  latencyMs: null,
  protocolVersion: null,
  discoveredToolCount: null,
  lastErrorCategory: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

const authResolver: McpAuthProfileResolver = {
  async resolve() {
    return { Authorization: "Bearer test-token" };
  },
};

const active: Server[] = [];

async function listen(
  handler: (method: string, body: Record<string, unknown>) => unknown,
) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    const payload = handler(String(body.method), body);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: payload }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  active.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    active.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("MCP server protocol probe", () => {
  it("discovers the current protocol and verifies the allowlisted tool", async () => {
    const endpoint = await listen((method) => {
      if (method === "server/discover") {
        return { supportedVersions: ["2026-07-28"], capabilities: {} };
      }
      if (method === "tools/list") {
        return {
          tools: [
            { name: "search_message_processing_logs" },
            { name: "extra" },
          ],
        };
      }
      return {};
    });

    const probe = new HttpMcpServerProbe({ authResolver });
    const result = await probe.ping({ ...serverRecord, endpointUrl: endpoint });
    expect(result).toMatchObject({
      healthState: "healthy",
      protocolVersion: "2026-07-28",
      discoveredToolCount: 1,
      errorCategory: null,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("falls back to initialize and ping for the pinned legacy protocol", async () => {
    const endpoint = await listen((method) => {
      if (method === "server/discover") return {};
      if (method === "initialize") return { protocolVersion: "2025-11-25" };
      if (method === "tools/list") {
        return { tools: [{ name: "search_message_processing_logs" }] };
      }
      return {};
    });

    const probe = new HttpMcpServerProbe({ authResolver });
    await expect(
      probe.ping({ ...serverRecord, endpointUrl: endpoint }),
    ).resolves.toMatchObject({
      healthState: "healthy",
      protocolVersion: "2025-11-25",
      discoveredToolCount: 1,
      errorCategory: null,
    });
  });

  it("fails closed when the authentication profile cannot resolve", async () => {
    const probe = new HttpMcpServerProbe({
      authResolver: {
        async resolve() {
          return undefined;
        },
      },
    });
    await expect(probe.ping(serverRecord)).resolves.toMatchObject({
      healthState: "unhealthy",
      errorCategory: "auth_profile_unavailable",
      latencyMs: null,
    });
  });
});
