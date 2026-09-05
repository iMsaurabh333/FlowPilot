import xsenv from "@sap/xsenv";

import {
  MessageProcessingLogsConnector,
  MessageProcessingLogsError,
  MPL_DESTINATION_NAME,
  type DestinationResolver,
  type ResolvedDestination,
} from "./mpl.js";

const DESTINATION_REQUEST_TIMEOUT_MS = 10_000;
const DESTINATION_MAX_RESPONSE_BYTES = 64 * 1024;

interface DestinationServiceCredentials {
  clientid: string;
  clientsecret: string;
  uri: string;
  url: string;
}

export interface DestinationServiceResolverOptions {
  credentials?: DestinationServiceCredentials;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      `The Destination service binding has no ${field}`,
    );
  }
  return value.trim();
}

function loadDestinationCredentials(): DestinationServiceCredentials {
  let bindings: Record<string, unknown>;
  try {
    bindings = xsenv.getServices({ destination: { tag: "destination" } });
  } catch {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      "No Destination service binding is available",
    );
  }

  const binding = bindings.destination;
  if (!isRecord(binding)) {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      "No Destination service binding is available",
    );
  }
  const credentials = isRecord(binding.credentials)
    ? binding.credentials
    : binding;
  return {
    clientid: requiredString(credentials.clientid, "clientid"),
    clientsecret: requiredString(credentials.clientsecret, "clientsecret"),
    uri: requiredString(credentials.uri, "uri"),
    url: requiredString(credentials.url, "url"),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
    hostname.toLowerCase(),
  );
}

function assertHttpsEndpoint(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      `The Destination service ${label} is invalid`,
    );
  }
  const isLoopbackHttp =
    url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (
    (url.protocol !== "https:" && !isLoopbackHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      `The Destination service ${label} is not allowed`,
    );
  }
  return url;
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      "The Destination service response is too large",
    );
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service response is too large",
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MessageProcessingLogsError(
          "destination_unavailable",
          "The Destination service response is too large",
        );
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      "The Destination service returned invalid JSON",
    );
  }
}

function responseFailure(status: number): MessageProcessingLogsError {
  if (status === 401 || status === 403) {
    return new MessageProcessingLogsError(
      "not_authorized",
      "The Destination service rejected authorization",
    );
  }
  return new MessageProcessingLogsError(
    "destination_unavailable",
    "The Destination service request failed",
  );
}

export class DestinationServiceResolver implements DestinationResolver {
  private readonly credentials?: DestinationServiceCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private accessToken?: { value: string; expiresAt: number };

  constructor(options: DestinationServiceResolverOptions = {}) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DESTINATION_REQUEST_TIMEOUT_MS;
  }

  private getCredentials(): DestinationServiceCredentials {
    return this.credentials ?? loadDestinationCredentials();
  }

  private async request(
    url: URL,
    init: RequestInit,
    maxResponseBytes: number,
  ): Promise<{ response: Response; body: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
      const body = await readBoundedText(response, maxResponseBytes);
      return { response, body };
    } catch (error: unknown) {
      if (error instanceof MessageProcessingLogsError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MessageProcessingLogsError(
          "upstream_timeout",
          "The Destination service request timed out",
        );
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new MessageProcessingLogsError(
          "upstream_timeout",
          "The Destination service request timed out",
        );
      }
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service request failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.value;
    }

    const credentials = this.getCredentials();
    const tokenBaseUrl = assertHttpsEndpoint(credentials.url, "token URL");
    const tokenUrl = new URL(tokenBaseUrl.href);
    if (!tokenUrl.pathname.endsWith("/oauth/token")) {
      tokenUrl.pathname = `${tokenUrl.pathname.replace(/\/+$/u, "")}/oauth/token`;
    }
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientid,
      client_secret: credentials.clientsecret,
    });
    const { response, body } = await this.request(
      tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
      16 * 1024,
    );
    if (response.status !== 200) {
      throw responseFailure(response.status);
    }
    const parsed = parseJson(body);
    if (!isRecord(parsed) || typeof parsed.access_token !== "string") {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service token response is invalid",
      );
    }
    const expiresIn =
      typeof parsed.expires_in === "number" &&
      Number.isFinite(parsed.expires_in)
        ? parsed.expires_in
        : 300;
    this.accessToken = {
      value: parsed.access_token,
      expiresAt: now + Math.max(60, expiresIn) * 1_000,
    };
    return parsed.access_token;
  }

  async resolve(name: string): Promise<ResolvedDestination> {
    if (name !== MPL_DESTINATION_NAME) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The requested destination is not approved",
      );
    }
    const credentials = this.getCredentials();
    const destinationBaseUrl = assertHttpsEndpoint(credentials.uri, "URI");
    const endpoint = new URL(destinationBaseUrl.href);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}/destination-configuration/v1/destinations/${encodeURIComponent(name)}`;
    const token = await this.getAccessToken();
    const { response, body } = await this.request(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      DESTINATION_MAX_RESPONSE_BYTES,
    );
    if (response.status !== 200) {
      throw responseFailure(response.status);
    }

    const parsed = parseJson(body);
    if (!isRecord(parsed) || !isRecord(parsed.destinationConfiguration)) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service response is invalid",
      );
    }
    const configuration = parsed.destinationConfiguration;
    if (
      configuration.Name !== name ||
      configuration.Type !== "HTTP" ||
      configuration.ProxyType !== "Internet" ||
      configuration.Authentication !== "OAuth2ClientCredentials"
    ) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The approved destination configuration is invalid",
      );
    }
    const destinationUrl = requiredString(configuration.URL, "destination URL");
    assertHttpsEndpoint(destinationUrl, "destination URL");
    if (!Array.isArray(parsed.authTokens)) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service returned no access token",
      );
    }
    const authToken = parsed.authTokens.find((candidate) => {
      if (!isRecord(candidate) || !isRecord(candidate.http_header)) {
        return false;
      }
      return (
        candidate.http_header.key === "Authorization" &&
        typeof candidate.http_header.value === "string" &&
        candidate.http_header.value.startsWith("Bearer ")
      );
    });
    if (!isRecord(authToken) || !isRecord(authToken.http_header)) {
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The Destination service returned no usable access token",
      );
    }
    return {
      url: destinationUrl,
      headers: { Authorization: authToken.http_header.value as string },
    };
  }
}

export function createConfiguredMessageProcessingLogsConnector(
  options: {
    fetchImpl?: typeof fetch;
  } = {},
): MessageProcessingLogsConnector {
  return new MessageProcessingLogsConnector({
    fetchImpl: options.fetchImpl,
    resolver: new DestinationServiceResolver({ fetchImpl: options.fetchImpl }),
  });
}
