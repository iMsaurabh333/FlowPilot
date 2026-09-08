import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it } from "vitest";

import { createChatAgent } from "@flowpilot/agent-core";
import { ConversationService } from "../src/conversations/service.js";
import type {
  ConversationRecord,
  ConversationRepository,
} from "../src/conversations/types.js";
import {
  MemoryMcpRegistryRepository,
  type McpServerRecord,
} from "../src/mcp/registry.js";
import { McpToolResolver } from "../src/mcp/tool-resolver.js";
import {
  createMcpApp,
  type McpAppRuntime,
} from "../../../servers/flowpilot-mcp-cloud-integration/src/app.js";
import { MCP_INVOKE_SCOPE } from "../../../servers/flowpilot-mcp-cloud-integration/src/constants.js";
import {
  MessageProcessingLogsConnector,
  type DestinationResolver,
} from "../../../servers/flowpilot-mcp-cloud-integration/src/mpl.js";

const MCP_TOKEN = "local-mcp-token";
const now = "2026-09-06T10:00:00.000Z";

const user = {
  subject: "operator",
  tenantId: "tenant",
  scopes: ["ChatUser", "ToolOperator"],
};

function verifier(): Parameters<typeof createMcpApp>[0]["verifier"] {
  return {
    async verifyAccessToken(token: string) {
      if (token !== MCP_TOKEN) {
        throw new Error("The access token is invalid");
      }
      return {
        token,
        clientId: "flowpilot-api-local-e2e",
        scopes: [MCP_INVOKE_SCOPE],
        expiresAt: Math.floor(Date.now() / 1_000) + 60,
      };
    },
  };
}

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    serverId: "cloud-integration",
    policyPresetId: "generic",
    displayName: "Cloud Integration monitoring",
    endpointUrl: "http://127.0.0.1",
    mcpPath: "/mcp",
    externalPort: null,
    authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_MPL",
    allowedToolNames: ["search_message_processing_logs"],
    requiredScopes: [MCP_INVOKE_SCOPE],
    enabled: true,
    healthState: "healthy",
    lastCheckedAt: now,
    latencyMs: 1,
    protocolVersion: "2026-07-28",
    discoveredToolCount: 1,
    lastErrorCategory: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function conversationRepository(): ConversationRepository {
  const conversation: ConversationRecord = {
    id: "conversation-1",
    threadId: "thread-1",
    title: "New conversation",
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  return {
    async create() {
      return conversation;
    },
    async list() {
      return [conversation];
    },
    async findOwned() {
      return conversation;
    },
    async delete() {
      return "deleted";
    },
    async acquireRun() {
      return { status: "acquired", conversation };
    },
    async completeRun(_user, _conversationId, _runId, title) {
      conversation.title = title;
    },
    async releaseRun() {},
  };
}

interface RunningServer {
  close(): Promise<void>;
  url: URL;
}

async function listen(
  handler: (request: import("node:http").IncomingMessage, body: string) => void,
): Promise<RunningServer> {
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    handler(request, Buffer.concat(chunks).toString("utf8"));
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        d: {
          results: [
            {
              MessageGuid: "message-1",
              CorrelationId: "corr-1",
              IntegrationArtifact: { Id: "iflow-1" },
              IntegrationFlowName: "Orders",
              Status: "FAILED",
              LogStart: "/Date(1788685200000)/",
              LogEnd: "/Date(1788685201000)/",
            },
          ],
        },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${address.port}`),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function listenMcp(
  connector: MessageProcessingLogsConnector,
): Promise<RunningServer & { runtime: McpAppRuntime }> {
  const runtime = createMcpApp({
    authorizationServerUrl: new URL("http://127.0.0.1/mock-authorization"),
    connector,
    reportError: () => undefined,
    resourceServerUrl: new URL("http://127.0.0.1/mcp"),
    verifier: verifier(),
  });
  const server = createServer(runtime.app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    runtime,
    url: new URL(`http://127.0.0.1:${address.port}`),
    close: async () => {
      await runtime.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const active: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(active.splice(0).map((server) => server.close()));
});

describe("local connector-to-MCP-to-agent path", () => {
  it("carries a bounded fake OData result through MCP into LangGraph", async () => {
    const upstreamRequests: Array<{
      method: string;
      url: string;
      authorization: string | undefined;
    }> = [];
    const odata = await listen((request) => {
      upstreamRequests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
      });
    });
    active.push(odata);

    const destinationResolver: DestinationResolver = {
      async resolve(name) {
        expect(name).toBe("FLOWPILOT_CLOUD_INTEGRATION_MPL");
        return {
          url: odata.url.href,
          headers: { Authorization: "Bearer fake-destination-token" },
        };
      },
    };
    const connector = new MessageProcessingLogsConnector({
      resolver: destinationResolver,
    });
    const mcp = await listenMcp(connector);
    active.push(mcp);

    const repository = new MemoryMcpRegistryRepository();
    await repository.save(record({ endpointUrl: mcp.url.href.slice(0, -1) }));
    const mcpResponses: Array<{ status: number; body: string }> = [];
    const resolver = new McpToolResolver({
      repository,
      authResolver: {
        async resolve(reference) {
          expect(reference).toBe("destination:FLOWPILOT_CLOUD_INTEGRATION_MPL");
          return { Authorization: `Bearer ${MCP_TOKEN}` };
        },
      },
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init);
        mcpResponses.push({
          status: response.status,
          body: await response.clone().text(),
        });
        return response;
      },
      now: () => new Date(now),
    });
    const resolvedTools = await resolver.resolve(user);
    expect(resolvedTools).toEqual([
      expect.objectContaining({
        name: "cloud-integration__search_message_processing_logs",
      }),
    ]);
    expect(mcpResponses).toEqual([
      {
        status: 200,
        body: expect.stringContaining('"search_message_processing_logs"'),
      },
    ]);

    const model = fakeModel()
      .respondWithTools([
        {
          name: "cloud-integration__search_message_processing_logs",
          args: {
            fromUtc: "2026-09-06T09:00:00Z",
            toUtc: "2026-09-06T10:00:00Z",
            status: "FAILED",
            limit: 20,
          },
        },
      ])
      .respond(new AIMessage("The approved tool found one failed Orders log."));
    const agent = createChatAgent({
      checkpointer: new MemorySaver(),
      model,
    });
    const conversations = new ConversationService(
      conversationRepository(),
      agent,
      resolver,
    );

    const result = await conversations.sendMessage(
      user,
      "conversation-1",
      "Find failed Orders messages from the last hour",
    );

    expect(result.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "The approved tool found one failed Orders log.",
      }),
    );
    expect(upstreamRequests).toEqual([
      {
        method: "GET",
        url: expect.stringContaining("/api/v1/MessageProcessingLogs?"),
        authorization: "Bearer fake-destination-token",
      },
    ]);
    const upstreamUrl = new URL(upstreamRequests[0].url, odata.url);
    expect(upstreamUrl.searchParams.get("$top")).toBe("21");
    expect(upstreamUrl.searchParams.get("$select")).toContain("MessageGuid");
    expect(upstreamUrl.searchParams.get("$filter")).toContain(
      "Status eq 'FAILED'",
    );
    expect(upstreamRequests[0].method).toBe("GET");
    expect(mcpResponses).toHaveLength(3);
    expect(mcpResponses.every(({ status }) => status === 200)).toBe(true);
    expect(mcpResponses.at(-1)?.body).toContain("message-1");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Find failed Orders messages from the last hour",
        }),
      ]),
    );
  });
});
