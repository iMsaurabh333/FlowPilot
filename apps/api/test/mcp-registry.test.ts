import type { ChatAgent, ChatMessage } from "@flowpilot/agent-core";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ConversationService } from "../src/conversations/service.js";
import {
  McpRegistryService,
  MemoryMcpRegistryRepository,
  type McpProbeResult,
  type McpServerProbe,
  type McpServerRecord,
} from "../src/mcp/registry.js";

const baseInput = {
  profileId: "cloud-integration-monitoring" as const,
  displayName: "Cloud Integration monitoring",
  endpointUrl: "http://127.0.0.1:4100",
  mcpPath: "/mcp",
  externalPort: null,
  authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_MPL",
  allowedToolNames: ["search_message_processing_logs"],
  requiredScopes: ["McpInvoke"],
};

class FakeProbe implements McpServerProbe {
  healthy = true;
  calls = 0;

  async ping(_server: McpServerRecord): Promise<McpProbeResult> {
    this.calls += 1;
    return {
      healthState: this.healthy ? "healthy" : "unhealthy",
      checkedAt: "2026-09-05T12:00:00.000Z",
      latencyMs: 4,
      protocolVersion: this.healthy ? "2026-07-28" : null,
      discoveredToolCount: this.healthy ? 1 : null,
      errorCategory: this.healthy ? null : "upstream_unavailable",
    };
  }
}

class EmptyAgent implements ChatAgent {
  async getMessages(_threadId: string): Promise<ChatMessage[]> {
    return [];
  }

  async sendMessage(
    _threadId: string,
    _content: string,
  ): Promise<ChatMessage[]> {
    return [];
  }
}

const conversations = new ConversationService(
  {
    create: async () => {
      throw new Error("not used");
    },
    list: async () => [],
    findOwned: async () => undefined,
    acquireRun: async () => ({ status: "not_found" as const }),
    completeRun: async () => undefined,
    releaseRun: async () => undefined,
  },
  new EmptyAgent(),
);

function appFor(registry: McpRegistryService) {
  const authentication: RequestHandler = (incoming, _response, next) => {
    incoming.flowpilotUser =
      incoming.header("x-test-role") === "admin"
        ? {
            subject: "admin",
            tenantId: "tenant",
            displayName: "Admin",
            scopes: ["ChatUser", "ChatAdmin"],
          }
        : {
            subject: "operator",
            tenantId: "tenant",
            displayName: "Operator",
            scopes: ["ChatUser"],
          };
    next();
  };
  return createApp({ authentication, conversations, registry });
}

describe("MCP registry administration", () => {
  it("keeps registry access admin-only and supports multiple records", async () => {
    const repository = new MemoryMcpRegistryRepository();
    const probe = new FakeProbe();
    const registry = new McpRegistryService(
      repository,
      probe,
      () => "2026-09-05T11:00:00.000Z",
    );
    const app = appFor(registry);

    await request(app)
      .get("/api/admin/mcp-servers")
      .expect(403)
      .expect({ error: "forbidden" });

    await request(app)
      .put("/api/admin/mcp-servers/cloud-integration-a")
      .set("x-test-role", "admin")
      .send({ ...baseInput, displayName: "Monitoring A" })
      .expect(200);
    await request(app)
      .put("/api/admin/mcp-servers/cloud-integration-b")
      .set("x-test-role", "admin")
      .send({ ...baseInput, displayName: "Monitoring B" })
      .expect(200);

    const listed = await request(app)
      .get("/api/admin/mcp-servers")
      .set("x-test-role", "admin")
      .expect(200);
    expect(listed.body.servers).toHaveLength(2);
    expect(
      listed.body.servers.map((server: McpServerRecord) => server.serverId),
    ).toEqual(["cloud-integration-a", "cloud-integration-b"]);
  });

  it("requires a healthy Ping before enabling and records safe health metadata", async () => {
    const repository = new MemoryMcpRegistryRepository();
    const probe = new FakeProbe();
    const registry = new McpRegistryService(repository, probe);
    const app = appFor(registry);

    await request(app)
      .put("/api/admin/mcp-servers/cloud-integration")
      .set("x-test-role", "admin")
      .send({ ...baseInput, enabled: false })
      .expect(200);

    probe.healthy = false;
    const rejected = await request(app)
      .put("/api/admin/mcp-servers/cloud-integration")
      .set("x-test-role", "admin")
      .send({ ...baseInput, enabled: true })
      .expect(409);
    expect(rejected.body).toEqual({ error: "server_unhealthy" });

    const afterFailure = await request(app)
      .get("/api/admin/mcp-servers")
      .set("x-test-role", "admin")
      .expect(200);
    expect(afterFailure.body.servers[0]).toMatchObject({
      enabled: false,
      healthState: "unhealthy",
      lastErrorCategory: "upstream_unavailable",
    });

    probe.healthy = true;
    const pinged = await request(app)
      .post("/api/admin/mcp-servers/cloud-integration/ping")
      .set("x-test-role", "admin")
      .expect(200);
    expect(pinged.body).toMatchObject({
      enabled: false,
      healthState: "healthy",
      protocolVersion: "2026-07-28",
      discoveredToolCount: 1,
      lastErrorCategory: null,
    });

    await request(app)
      .put("/api/admin/mcp-servers/cloud-integration")
      .set("x-test-role", "admin")
      .send({ ...baseInput, enabled: true })
      .expect(200);
    expect(probe.calls).toBe(3);
  });

  it("rejects unapproved endpoints and external ports", async () => {
    const registry = new McpRegistryService(
      new MemoryMcpRegistryRepository(),
      new FakeProbe(),
    );
    const app = appFor(registry);

    const privateEndpoint = await request(app)
      .put("/api/admin/mcp-servers/private-target")
      .set("x-test-role", "admin")
      .send({ ...baseInput, endpointUrl: "http://10.0.0.2:4100" })
      .expect(400);
    expect(privateEndpoint.body).toEqual({ error: "invalid_request" });

    const cloudFoundryPort = await request(app)
      .put("/api/admin/mcp-servers/cloud-port")
      .set("x-test-role", "admin")
      .send({ ...baseInput, externalPort: 4100 })
      .expect(400);
    expect(cloudFoundryPort.body).toEqual({ error: "invalid_request" });
  });

  it("prevents two approved external servers from claiming one port", async () => {
    const registry = new McpRegistryService(
      new MemoryMcpRegistryRepository(),
      new FakeProbe(),
    );
    const app = appFor(registry);
    const input = {
      profileId: "cloud-integration-content" as const,
      displayName: "Integration Content",
      endpointUrl: "http://127.0.0.1:4200",
      mcpPath: "/mcp",
      externalPort: 4_200,
      authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_CONTENT",
      allowedToolNames: [],
      requiredScopes: ["McpInvoke"],
      enabled: false,
    };
    await request(app)
      .put("/api/admin/mcp-servers/content-a")
      .set("x-test-role", "admin")
      .send(input)
      .expect(200);

    const conflict = await request(app)
      .put("/api/admin/mcp-servers/content-b")
      .set("x-test-role", "admin")
      .send({ ...input, displayName: "Integration Content B" })
      .expect(400);
    expect(conflict.body).toEqual({ error: "invalid_request" });
  });
});
