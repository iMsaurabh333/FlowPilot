import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpApp, type McpAppRuntime } from "../src/app.js";
import {
  CURRENT_MCP_PROTOCOL_VERSION,
  LEGACY_MCP_PROTOCOL_VERSION,
  MCP_INVOKE_SCOPE,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "../src/constants.js";
import type {
  MessageProcessingLogsConnectorLike,
  SearchMessageProcessingLogsResponse,
} from "../src/mpl.js";

const OPERATOR_TOKEN = "operator-token";
const UNSCOPED_TOKEN = "unscoped-token";
const TEST_RESOURCE_URL = new URL("http://127.0.0.1:4100/mcp");
const TEST_AUTHORIZATION_SERVER_URL = new URL("https://auth.example.test");

function testVerifier(): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token !== OPERATOR_TOKEN && token !== UNSCOPED_TOKEN) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "The access token is invalid",
        );
      }
      return {
        token,
        clientId: "flowpilot-api-test-client",
        scopes: token === OPERATOR_TOKEN ? [MCP_INVOKE_SCOPE] : [],
        expiresAt: Math.floor(Date.now() / 1_000) + 60,
      };
    },
  };
}

function createTestRuntime(
  connector?: MessageProcessingLogsConnectorLike,
): McpAppRuntime {
  return createMcpApp({
    authorizationServerUrl: TEST_AUTHORIZATION_SERVER_URL,
    connector,
    resourceServerUrl: TEST_RESOURCE_URL,
    verifier: testVerifier(),
  });
}

interface RunningServer {
  runtime: McpAppRuntime;
  server: Server;
  url: URL;
}

async function listen(
  connector?: MessageProcessingLogsConnectorLike,
): Promise<RunningServer> {
  const runtime = createTestRuntime(connector);
  const server = createServer(runtime.app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    runtime,
    server,
    url: new URL(`http://127.0.0.1:${address.port}/mcp`),
  };
}

async function stop(running: RunningServer): Promise<void> {
  await running.runtime.close();
  await new Promise<void>((resolve, reject) => {
    running.server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("authenticated Streamable HTTP MCP server", () => {
  const active: RunningServer[] = [];

  afterEach(async () => {
    await Promise.all(active.splice(0).map(stop));
  });

  it("exposes only safe unauthenticated liveness metadata", async () => {
    const runtime = createTestRuntime();

    const response = await request(runtime.app).get("/health").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.body).toEqual({
      status: "ok",
      server: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      protocolVersions: [
        CURRENT_MCP_PROTOCOL_VERSION,
        LEGACY_MCP_PROTOCOL_VERSION,
      ],
      toolsEnabled: true,
    });
    await runtime.close();
  });

  it("publishes protected resource metadata for OAuth discovery", async () => {
    const runtime = createTestRuntime();

    const response = await request(runtime.app)
      .get("/.well-known/oauth-protected-resource/mcp")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.body).toEqual({
      resource: TEST_RESOURCE_URL.href,
      authorization_servers: [TEST_AUTHORIZATION_SERVER_URL.href],
      scopes_supported: [MCP_INVOKE_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "FlowPilot Cloud Integration MCP server",
    });
    await runtime.close();
  });

  it("rejects missing and invalid bearer tokens without protocol handling", async () => {
    const runtime = createTestRuntime();
    const message = { jsonrpc: "2.0", id: 1, method: "ping" };

    const missing = await request(runtime.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send(message)
      .expect(401);
    expect(missing.body).toMatchObject({ error: "invalid_token" });
    expect(missing.headers["www-authenticate"]).toContain("Bearer");
    expect(missing.headers["www-authenticate"]).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );

    const invalid = await request(runtime.app)
      .post("/mcp")
      .set("Authorization", "Bearer invalid-token")
      .set("Accept", "application/json, text/event-stream")
      .send(message)
      .expect(401);
    expect(invalid.body).toMatchObject({ error: "invalid_token" });
    expect(JSON.stringify(invalid.body)).not.toContain("invalid-token");
    await runtime.close();
  });

  it("returns safe JSON for malformed and oversized request bodies", async () => {
    const runtime = createTestRuntime();

    const malformed = await request(runtime.app)
      .post("/mcp")
      .set("Authorization", `Bearer ${OPERATOR_TOKEN}`)
      .set("Content-Type", "application/json")
      .send('{"jsonrpc":')
      .expect(400);
    expect(malformed.body).toEqual({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
      id: null,
    });
    expect(malformed.text).not.toContain("SyntaxError");
    expect(malformed.text).not.toContain(OPERATOR_TOKEN);

    const oversized = await request(runtime.app)
      .post("/mcp")
      .set("Authorization", `Bearer ${OPERATOR_TOKEN}`)
      .send({ value: "x".repeat(33 * 1024) })
      .expect(413);
    expect(oversized.body).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Request body too large" },
      id: null,
    });
    expect(oversized.text).not.toContain(OPERATOR_TOKEN);
    await runtime.close();
  });

  it("rejects a valid token without the dedicated invocation scope", async () => {
    const runtime = createTestRuntime();

    const response = await request(runtime.app)
      .post("/mcp")
      .set("Authorization", `Bearer ${UNSCOPED_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "ping" })
      .expect(403);

    expect(response.body).toMatchObject({ error: "insufficient_scope" });
    expect(response.headers["www-authenticate"]).toContain(MCP_INVOKE_SCOPE);
    expect(JSON.stringify(response.body)).not.toContain(UNSCOPED_TOKEN);
    await runtime.close();
  });

  it("rejects unapproved Host and Origin values", async () => {
    const runtime = createTestRuntime();
    const message = { jsonrpc: "2.0", id: 1, method: "ping" };

    await request(runtime.app)
      .post("/mcp")
      .set("Host", "evil.example")
      .set("Authorization", `Bearer ${OPERATOR_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send(message)
      .expect(403);

    await request(runtime.app)
      .post("/mcp")
      .set("Origin", "https://evil.example")
      .set("Authorization", `Bearer ${OPERATOR_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send(message)
      .expect(403);
    await runtime.close();
  });

  it("negotiates and performs capability discovery with the current protocol", async () => {
    const running = await listen();
    active.push(running);
    const client = new Client(
      { name: "flowpilot-current-protocol-test", version: "0.1.0" },
      {
        enforceStrictCapabilities: true,
        versionNegotiation: {
          mode: { pin: CURRENT_MCP_PROTOCOL_VERSION },
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(running.url, {
      authProvider: { token: async () => OPERATOR_TOKEN },
    });

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getNegotiatedProtocolVersion()).toBe(
      CURRENT_MCP_PROTOCOL_VERSION,
    );
    expect(client.getServerVersion()).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    });
    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
    });
    await expect(client.discover()).resolves.toMatchObject({
      supportedVersions: [CURRENT_MCP_PROTOCOL_VERSION],
      capabilities: {},
    });
    await client.close();
  });

  it("lists and invokes the bounded read-only Message Processing Logs tool", async () => {
    const expected: SearchMessageProcessingLogsResponse = {
      items: [
        {
          messageId: "message-1",
          correlationId: "corr-1",
          integrationFlowId: "iflow-1",
          integrationFlowName: "Orders",
          status: "FAILED",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
          durationMilliseconds: 1_000,
        },
      ],
      count: 1,
      hasMore: false,
    };
    let received: unknown;
    const connector: MessageProcessingLogsConnectorLike = {
      async search(value) {
        received = value;
        return expected;
      },
    };
    const running = await listen(connector);
    active.push(running);
    const client = new Client(
      { name: "flowpilot-tool-test", version: "0.1.0" },
      {
        enforceStrictCapabilities: true,
        versionNegotiation: {
          mode: { pin: CURRENT_MCP_PROTOCOL_VERSION },
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(running.url, {
      authProvider: { token: async () => OPERATOR_TOKEN },
    });

    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(1);
    expect(listed.tools[0]).toMatchObject({
      name: "search_message_processing_logs",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    const result = await client.callTool({
      name: "search_message_processing_logs",
      arguments: {
        fromUtc: "2026-01-01T00:00:00Z",
        toUtc: "2026-01-01T01:00:00Z",
        limit: 20,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(received).toEqual({
      fromUtc: "2026-01-01T00:00:00Z",
      toUtc: "2026-01-01T01:00:00Z",
      limit: 20,
    });
    await client.close();
  });

  it("retains stateless compatibility with the pinned 2025 protocol", async () => {
    const running = await listen();
    active.push(running);
    const client = new Client(
      { name: "flowpilot-legacy-protocol-test", version: "0.1.0" },
      {
        supportedProtocolVersions: [LEGACY_MCP_PROTOCOL_VERSION],
      },
    );
    const transport = new StreamableHTTPClientTransport(running.url, {
      authProvider: { token: async () => OPERATOR_TOKEN },
    });

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("legacy");
    expect(client.getNegotiatedProtocolVersion()).toBe(
      LEGACY_MCP_PROTOCOL_VERSION,
    );
    expect(client.getServerVersion()).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    });
    await expect(client.ping()).resolves.toEqual({});
    await client.close();
  });
});
