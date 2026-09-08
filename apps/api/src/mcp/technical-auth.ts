import type { McpAuthProfileResolver } from "./probe.js";

const MCP_TECHNICAL_AUTH_PROFILE = "technical:flowpilot-mcp";
const MCP_CONTENT_TECHNICAL_AUTH_PROFILE = "technical:flowpilot-mcp-content";
const TOKEN_TIMEOUT_MS = 5_000;
const TOKEN_CACHE_TTL_MS = 4 * 60_000;

interface McpXsuaaBinding {
  clientid: string;
  clientsecret: string;
  url: string;
  xsappname: string;
}

interface McpScopeBinding {
  xsappname: string;
}

export interface TechnicalTokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type TechnicalTokenRequester = (
  request: TechnicalTokenRequest,
) => Promise<{ ok: boolean; body: string }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function serviceBindings(environment: NodeJS.ProcessEnv) {
  const raw = environment.VCAP_SERVICES;
  if (!raw?.trim()) return undefined;
  let services: unknown;
  try {
    services = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!record(services)) return undefined;
  return Object.values(services).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
}

function parseBinding(
  environment: NodeJS.ProcessEnv,
): McpXsuaaBinding | undefined {
  const candidates = serviceBindings(environment);
  if (!candidates) return undefined;
  const service = candidates.find(
    (value) => record(value) && value.name === "flowpilot-auth",
  );
  if (!record(service) || !record(service.credentials)) return undefined;
  const url = text(service.credentials.url);
  const clientid = text(service.credentials.clientid);
  const clientsecret = text(service.credentials.clientsecret);
  const xsappname = text(service.credentials.xsappname);
  if (!url || !clientid || !clientsecret || !xsappname) return undefined;
  try {
    if (new URL(url).protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return { url: url.replace(/\/$/u, ""), clientid, clientsecret, xsappname };
}

function parseScopeBinding(
  environment: NodeJS.ProcessEnv,
): McpScopeBinding | undefined {
  const candidates = serviceBindings(environment);
  if (!candidates) return undefined;
  const service = candidates.find(
    (value) => record(value) && value.name === "flowpilot-mcp-auth",
  );
  if (!record(service) || !record(service.credentials)) return undefined;
  const xsappname = text(service.credentials.xsappname);
  return xsappname ? { xsappname } : undefined;
}

async function defaultRequester(
  request: TechnicalTokenRequest,
): Promise<{ ok: boolean; body: string }> {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal: request.signal,
  });
  return { ok: response.ok, body: await response.text() };
}

export class TechnicalMcpAuthProfileResolver implements McpAuthProfileResolver {
  readonly #binding: McpXsuaaBinding | undefined;
  readonly #scopeBinding: McpScopeBinding | undefined;
  readonly #request: TechnicalTokenRequester;
  readonly #now: () => number;
  #tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    options: { request?: TechnicalTokenRequester; now?: () => number } = {},
  ) {
    this.#binding = parseBinding(environment);
    this.#scopeBinding = parseScopeBinding(environment);
    this.#request = options.request ?? defaultRequester;
    this.#now = options.now ?? Date.now;
  }

  async resolve(authProfileRef: string) {
    if (
      (authProfileRef !== MCP_TECHNICAL_AUTH_PROFILE &&
        authProfileRef !== MCP_CONTENT_TECHNICAL_AUTH_PROFILE) ||
      !this.#binding ||
      !this.#scopeBinding
    ) {
      return undefined;
    }
    const now = this.#now();
    const cached = this.#tokens.get(authProfileRef);
    if (cached && cached.expiresAt > now) {
      return { Authorization: `Bearer ${cached.value}` };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    try {
      const response = await this.#request({
        url: `${this.#binding.url}/oauth/token`,
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(
            `${this.#binding.clientid}:${this.#binding.clientsecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: `${this.#scopeBinding.xsappname}.${
            authProfileRef === MCP_CONTENT_TECHNICAL_AUTH_PROFILE
              ? "ContentInvoke"
              : "McpInvoke"
          }`,
        }).toString(),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const payload = JSON.parse(response.body) as unknown;
      if (!record(payload) || !text(payload.access_token)) return undefined;
      const lifetime = Number(payload.expires_in);
      const ttl = Number.isFinite(lifetime)
        ? Math.min(
            Math.max(Math.floor(lifetime * 1_000) - 30_000, 1_000),
            TOKEN_CACHE_TTL_MS,
          )
        : TOKEN_CACHE_TTL_MS;
      this.#tokens.set(authProfileRef, {
        value: text(payload.access_token)!,
        expiresAt: now + ttl,
      });
      return { Authorization: `Bearer ${this.#tokens.get(authProfileRef)!.value}` };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createConfiguredMcpAuthProfileResolver(
  environment: NodeJS.ProcessEnv = process.env,
): McpAuthProfileResolver {
  if (environment.NODE_ENV?.trim().toLowerCase() === "production") {
    return new TechnicalMcpAuthProfileResolver(environment);
  }
  return {
    async resolve(authProfileRef) {
      const suffix = authProfileRef
        .replace(/[^A-Za-z0-9]/gu, "_")
        .toUpperCase();
      const token = environment[`MCP_REGISTRY_AUTH_${suffix}`]?.trim();
      return token ? { Authorization: `Bearer ${token}` } : undefined;
    },
  };
}
