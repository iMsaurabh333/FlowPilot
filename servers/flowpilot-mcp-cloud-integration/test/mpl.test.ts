import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMessageProcessingLogsQuery,
  MessageProcessingLogsConnector,
  MessageProcessingLogsError,
  MPL_DESTINATION_NAME,
  type DestinationResolver,
} from "../src/mpl.js";

const REQUEST = {
  fromUtc: "2026-01-01T00:00:00+02:00",
  toUtc: "2026-01-01T02:00:00+02:00",
  status: "FAILED" as const,
  integrationFlowId: "O'Hare",
  correlationId: "corr-1",
  limit: 2,
};

interface FakeODataServer {
  server: Server;
  url: URL;
  requests: {
    method: string;
    url: string;
    authorization: string | undefined;
  }[];
}

async function startFakeODataServer(): Promise<FakeODataServer> {
  const requests: FakeODataServer["requests"] = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json;odata=verbose");
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
              LogStart: "/Date(1760000000000)/",
              LogEnd: "/Date(1760000123456)/",
            },
            {
              MessageGuid: "message-2",
              CorrelationId: null,
              IntegrationArtifact: { Id: "iflow-2" },
              IntegrationFlowName: null,
              Status: "COMPLETED",
              LogStart: "2026-01-01T00:30:00",
              LogEnd: "2026-01-01T00:29:59",
            },
            {
              MessageGuid: "message-3",
              CorrelationId: "corr-3",
              IntegrationArtifact: null,
              IntegrationFlowName: "Other",
              Status: "PROCESSING",
              LogStart: null,
              LogEnd: null,
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
    server,
    url: new URL(`http://127.0.0.1:${address.port}`),
    requests,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function resolver(url: URL): DestinationResolver {
  return {
    async resolve(name) {
      expect(name).toBe(MPL_DESTINATION_NAME);
      return {
        url: url.href,
        headers: { Authorization: "Bearer fake-destination-token" },
      };
    },
  };
}

describe("Message Processing Logs connector", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("builds a bounded, escaped OData v2 query", () => {
    const query = buildMessageProcessingLogsQuery(REQUEST);
    expect(query.get("$select")).toBe(
      "MessageGuid,CorrelationId,IntegrationArtifact,IntegrationFlowName,Status,LogStart,LogEnd",
    );
    expect(query.get("$orderby")).toBe("LogStart desc");
    expect(query.get("$top")).toBe("3");
    expect(query.get("$filter")).toBe(
      "LogStart ge datetime'2025-12-31T22:00:00' and LogStart lt datetime'2026-01-01T00:00:00' and Status eq 'FAILED' and CorrelationId eq 'corr-1' and IntegrationArtifact/Id eq 'O''Hare'",
    );
    expect(query.toString()).not.toContain("%22");
    expect(query.toString()).not.toContain("$skiptoken");
  });

  it.each([
    {
      name: "unknown fields",
      value: { ...REQUEST, rawFilter: "Status eq 'FAILED'" },
    },
    {
      name: "missing offset",
      value: { ...REQUEST, fromUtc: "2026-01-01T00:00:00" },
    },
    {
      name: "reversed interval",
      value: { ...REQUEST, toUtc: "2025-12-31T21:00:00Z" },
    },
    {
      name: "interval over 24 hours",
      value: { ...REQUEST, toUtc: "2026-01-02T03:00:00+02:00" },
    },
    {
      name: "invalid limit",
      value: { ...REQUEST, limit: 101 },
    },
  ])("rejects $name", ({ value }) => {
    expect(() => buildMessageProcessingLogsQuery(value)).toThrow(
      MessageProcessingLogsError,
    );
    try {
      buildMessageProcessingLogsQuery(value);
    } catch (error: unknown) {
      expect(error).toMatchObject({ category: "invalid_request" });
    }
  });

  it("calls only the fixed GET path and normalizes the OData response", async () => {
    const fake = await startFakeODataServer();
    servers.push(fake.server);
    const connector = new MessageProcessingLogsConnector({
      resolver: resolver(fake.url),
    });

    await expect(connector.search(REQUEST)).resolves.toEqual({
      items: [
        {
          messageId: "message-1",
          correlationId: "corr-1",
          integrationFlowId: "iflow-1",
          integrationFlowName: "Orders",
          status: "FAILED",
          startedAt: "2025-10-09T08:53:20.000Z",
          endedAt: "2025-10-09T08:55:23.456Z",
          durationMilliseconds: 123456,
        },
        {
          messageId: "message-2",
          correlationId: null,
          integrationFlowId: "iflow-2",
          integrationFlowName: null,
          status: "COMPLETED",
          startedAt: "2026-01-01T00:30:00.000Z",
          endedAt: "2026-01-01T00:29:59.000Z",
          durationMilliseconds: null,
        },
      ],
      count: 2,
      hasMore: true,
    });

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: "GET",
      authorization: "Bearer fake-destination-token",
    });
    const requestUrl = new URL(fake.requests[0].url, fake.url);
    expect(requestUrl.pathname).toBe("/api/v1/MessageProcessingLogs");
    expect(requestUrl.searchParams.get("$top")).toBe("3");
    expect(requestUrl.searchParams.get("$orderby")).toBe("LogStart desc");
  });

  it("maps upstream status and malformed payloads to stable categories", async () => {
    const responseFetch: typeof fetch = async (_url, init) => {
      expect(init?.method).toBe("GET");
      return new Response("", { status: 429 });
    };
    const connector = new MessageProcessingLogsConnector({
      fetchImpl: responseFetch,
      resolver: resolver(new URL("https://cpi.example.test")),
    });
    await expect(connector.search(REQUEST)).rejects.toMatchObject({
      category: "upstream_rate_limited",
    });

    const malformed = new MessageProcessingLogsConnector({
      fetchImpl: async () =>
        new Response('{"d":{"results":"bad"}}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      resolver: resolver(new URL("https://cpi.example.test")),
    });
    await expect(malformed.search(REQUEST)).rejects.toMatchObject({
      category: "invalid_upstream_response",
    });
  });
});
