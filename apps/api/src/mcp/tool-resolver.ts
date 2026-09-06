import type { ChatTool } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { McpAuthProfileResolver } from "./probe.js";
import {
  MCP_HEALTH_MAX_AGE_MS,
  type McpRegistryRepository,
  type McpServerRecord,
} from "./registry.js";

export const MCP_TOOL_OPERATOR_SCOPE = "ToolOperator";
const MCP_TOOL_TIMEOUT_MS = 5_000;
const MCP_TOOL_MAX_RESPONSE_BYTES = 128 * 1_024;

interface JsonRpcResponse {
  result?: Record<string, unknown>;
  error?: unknown;
}

interface AdvertisedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRpcBody(body: string): JsonRpcResponse | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? (parsed as JsonRpcResponse) : undefined;
  } catch {
    const dataLine = body
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return undefined;
    try {
      const parsed = JSON.parse(
        dataLine.slice("data:".length).trim(),
      ) as unknown;
      return isRecord(parsed) ? (parsed as JsonRpcResponse) : undefined;
    } catch {
      return undefined;
    }
  }
}

function endpointFor(server: McpServerRecord) {
  const endpoint = new URL(server.endpointUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}${server.mcpPath}`;
  return endpoint;
}

function isFreshHealthy(server: McpServerRecord, now: Date) {
  return (
    server.enabled &&
    server.healthState === "healthy" &&
    server.lastCheckedAt !== null &&
    Date.parse(server.lastCheckedAt) + MCP_HEALTH_MAX_AGE_MS >= now.getTime()
  );
}

function toolFrom(value: unknown): AdvertisedTool | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isRecord(value.inputSchema)
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description:
      typeof value.description === "string"
        ? value.description.slice(0, 1_000)
        : `Approved MCP tool ${value.name}`,
    inputSchema: value.inputSchema,
  };
}

function safeToolResult(payload: JsonRpcResponse | undefined) {
  if (!payload || payload.error || !isRecord(payload.result)) {
    return "MCP tool did not return a usable result.";
  }
  const content = payload.result.content;
  if (!Array.isArray(content)) return "MCP tool returned no content.";
  const text = content
    .flatMap((entry) =>
      isRecord(entry) && entry.type === "text" && typeof entry.text === "string"
        ? [entry.text]
        : [],
    )
    .join("\n");
  return text.slice(0, 32_768) || "MCP tool returned no text content.";
}

export class McpToolResolver {
  readonly #repository: McpRegistryRepository;
  readonly #authResolver: McpAuthProfileResolver;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: {
    repository: McpRegistryRepository;
    authResolver: McpAuthProfileResolver;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#authResolver = options.authResolver;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async #request(
    server: McpServerRecord,
    method: string,
    id: number,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse | undefined> {
    const headers = await this.#authResolver.resolve(server.authProfileRef);
    if (!headers) return undefined;
    try {
      const response = await this.#fetch(endpointFor(server), {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(MCP_TOOL_TIMEOUT_MS),
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) return undefined;
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MCP_TOOL_MAX_RESPONSE_BYTES
      ) {
        return undefined;
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MCP_TOOL_MAX_RESPONSE_BYTES) {
        return undefined;
      }
      return parseJsonRpcBody(text);
    } catch {
      return undefined;
    }
  }

  async resolve(user: AuthenticatedUser): Promise<ChatTool[]> {
    if (!user.scopes.includes(MCP_TOOL_OPERATOR_SCOPE)) return [];
    let servers: McpServerRecord[];
    try {
      servers = await this.#repository.list();
    } catch {
      return [];
    }
    const eligible = servers.filter((server) =>
      isFreshHealthy(server, this.#now()),
    );
    const groups = await Promise.all(
      eligible.map(async (server) => {
        const response = await this.#request(server, "tools/list", 1, {});
        const advertised = Array.isArray(response?.result?.tools)
          ? response.result.tools
              .map(toolFrom)
              .filter((tool): tool is AdvertisedTool => Boolean(tool))
          : [];
        const byName = new Map(advertised.map((tool) => [tool.name, tool]));
        if (!server.allowedToolNames.every((name) => byName.has(name)))
          return [];
        return server.allowedToolNames.flatMap((name) => {
          const advertisedTool = byName.get(name);
          if (!advertisedTool) return [];
          return [
            {
              name: `${server.serverId}__${name}`,
              description: advertisedTool.description,
              inputSchema: advertisedTool.inputSchema,
              invoke: async (arguments_: Record<string, unknown>) =>
                safeToolResult(
                  await this.#request(server, "tools/call", 2, {
                    name,
                    arguments: arguments_,
                  }),
                ),
            } satisfies ChatTool,
          ];
        });
      }),
    );
    return groups.flat();
  }
}
