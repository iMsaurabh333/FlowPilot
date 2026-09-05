import {
  APPROVED_MCP_SERVER_PROFILES,
  MCP_PROTOCOL_VERSIONS,
  type McpHealthState,
  type McpProtocolVersion,
  type McpServerProbe,
  type McpServerRecord,
  type McpProbeResult,
} from "./registry.js";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_RESPONSE_BYTES = 128 * 1024;
const PROBE_CLIENT_NAME = "flowpilot-registry-probe";
const PROBE_CLIENT_VERSION = "0.1.0";

export interface McpAuthProfileResolver {
  resolve(authProfileRef: string): Promise<Record<string, string> | undefined>;
}

export class EnvironmentMcpAuthProfileResolver implements McpAuthProfileResolver {
  readonly #environment: NodeJS.ProcessEnv;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#environment = environment;
  }

  async resolve(authProfileRef: string) {
    const suffix = authProfileRef.replace(/[^A-Za-z0-9]/gu, "_").toUpperCase();
    const token = this.#environment[`MCP_REGISTRY_AUTH_${suffix}`]?.trim();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }
}

interface JsonRpcResponse {
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeProtocolVersion(value: unknown): McpProtocolVersion | null {
  return typeof value === "string" &&
    MCP_PROTOCOL_VERSIONS.includes(value as McpProtocolVersion)
    ? (value as McpProtocolVersion)
    : null;
}

function parseJsonRpcBody(body: string): JsonRpcResponse | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? (parsed as JsonRpcResponse) : undefined;
  } catch {
    const dataLine = body
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      return undefined;
    }
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

async function boundedText(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > PROBE_MAX_RESPONSE_BYTES) {
    return undefined;
  }
  if (!response.body) {
    const body = await response.text();
    return Buffer.byteLength(body, "utf8") > PROBE_MAX_RESPONSE_BYTES
      ? undefined
      : body;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > PROBE_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

function result(
  state: Exclude<McpHealthState, "never_checked" | "stale">,
  checkedAt: string,
  latencyMs: number | null,
  protocolVersion: McpProtocolVersion | null,
  discoveredToolCount: number | null,
  errorCategory: string | null,
): McpProbeResult {
  return {
    healthState: state,
    checkedAt,
    latencyMs,
    protocolVersion,
    discoveredToolCount,
    errorCategory,
  };
}

function statusCategory(status: number) {
  if (status === 401 || status === 403) return "not_authorized";
  if (status === 429) return "upstream_rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "invalid_upstream_response";
}

function supportedVersion(payload: JsonRpcResponse | undefined) {
  const values = payload?.result?.supportedVersions;
  if (Array.isArray(values)) {
    for (const value of values) {
      const version = safeProtocolVersion(value);
      if (version) return version;
    }
  }
  return safeProtocolVersion(payload?.result?.protocolVersion);
}

function allowlistedToolCount(
  payload: JsonRpcResponse | undefined,
  server: McpServerRecord,
) {
  const tools = payload?.result?.tools;
  if (!Array.isArray(tools)) {
    return { count: null, category: "invalid_upstream_response" };
  }
  const names = new Set(
    tools.flatMap((tool) =>
      isRecord(tool) && typeof tool.name === "string" ? [tool.name] : [],
    ),
  );
  const count = server.allowedToolNames.filter((name) =>
    names.has(name),
  ).length;
  if (count !== server.allowedToolNames.length) {
    return { count, category: "tool_allowlist_mismatch" };
  }
  return { count, category: null };
}

export class HttpMcpServerProbe implements McpServerProbe {
  readonly #authResolver: McpAuthProfileResolver;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: {
    authResolver: McpAuthProfileResolver;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    this.#authResolver = options.authResolver;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
  }

  async #request(
    server: McpServerRecord,
    method: string,
    id: number,
    params: Record<string, unknown>,
    headers: Record<string, string>,
  ) {
    const endpoint = new URL(server.endpointUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}${server.mcpPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(endpoint, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      });
      const body = await boundedText(response);
      return {
        status: response.status,
        payload: body === undefined ? undefined : parseJsonRpcBody(body),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(server: McpServerRecord): Promise<McpProbeResult> {
    const checkedAt = this.#now().toISOString();
    const started = Date.now();
    const profile = APPROVED_MCP_SERVER_PROFILES[server.profileId];
    const headers = await this.#authResolver.resolve(server.authProfileRef);
    const latency = () => Math.max(0, Date.now() - started);
    if (!headers) {
      return result(
        "unhealthy",
        checkedAt,
        null,
        null,
        null,
        "auth_profile_unavailable",
      );
    }

    try {
      const modern = await this.#request(
        server,
        "server/discover",
        1,
        {},
        headers,
      );
      const modernVersion = supportedVersion(modern.payload);
      if (
        modern.status === 200 &&
        modernVersion === "2026-07-28" &&
        !modern.payload?.error
      ) {
        const tools = await this.#request(server, "tools/list", 2, {}, headers);
        if (tools.status !== 200 || tools.payload?.error) {
          return result(
            "unhealthy",
            checkedAt,
            latency(),
            modernVersion,
            null,
            tools.status === 200
              ? "invalid_upstream_response"
              : statusCategory(tools.status),
          );
        }
        const allowlist = allowlistedToolCount(tools.payload, server);
        return result(
          allowlist.category ? "unhealthy" : "healthy",
          checkedAt,
          latency(),
          modernVersion,
          allowlist.count,
          allowlist.category,
        );
      }

      if (
        modern.status !== 200 &&
        modern.status !== 404 &&
        modern.status !== 405
      ) {
        return result(
          "unhealthy",
          checkedAt,
          latency(),
          null,
          null,
          statusCategory(modern.status),
        );
      }

      const initialize = await this.#request(
        server,
        "initialize",
        3,
        {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: PROBE_CLIENT_NAME,
            version: PROBE_CLIENT_VERSION,
          },
        },
        headers,
      );
      if (initialize.status !== 200 || initialize.payload?.error) {
        return result(
          "unhealthy",
          checkedAt,
          latency(),
          null,
          null,
          initialize.status === 200
            ? "invalid_upstream_response"
            : statusCategory(initialize.status),
        );
      }
      const legacyVersion = safeProtocolVersion(
        initialize.payload?.result?.protocolVersion,
      );
      if (legacyVersion !== "2025-11-25" || !profile) {
        return result(
          "unhealthy",
          checkedAt,
          latency(),
          legacyVersion,
          null,
          "protocol_incompatible",
        );
      }
      const legacyPing = await this.#request(server, "ping", 4, {}, headers);
      if (legacyPing.status !== 200 || legacyPing.payload?.error) {
        return result(
          "unhealthy",
          checkedAt,
          latency(),
          legacyVersion,
          null,
          legacyPing.status === 200
            ? "invalid_upstream_response"
            : statusCategory(legacyPing.status),
        );
      }
      const tools = await this.#request(server, "tools/list", 5, {}, headers);
      const allowlist = allowlistedToolCount(tools.payload, server);
      return result(
        tools.status === 200 && !allowlist.category ? "healthy" : "unhealthy",
        checkedAt,
        latency(),
        legacyVersion,
        allowlist.count,
        tools.status === 200
          ? allowlist.category
          : statusCategory(tools.status),
      );
    } catch (error: unknown) {
      const category =
        error instanceof Error && error.name === "AbortError"
          ? "upstream_timeout"
          : "upstream_unavailable";
      return result("unhealthy", checkedAt, latency(), null, null, category);
    }
  }
}

export function createConfiguredMcpServerProbe(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return new HttpMcpServerProbe({
    authResolver: new EnvironmentMcpAuthProfileResolver(environment),
  });
}
