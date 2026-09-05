export const MPL_DESTINATION_NAME = "FLOWPILOT_CLOUD_INTEGRATION_MPL";
export const MPL_ENTITY_PATH = "/MessageProcessingLogs";
export const MPL_MAX_LIMIT = 100;
export const MPL_DEFAULT_LIMIT = 20;
export const MPL_MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MPL_REQUEST_TIMEOUT_MS = 10_000;
export const MPL_MAX_RESPONSE_BYTES = 256 * 1024;
export const MPL_ACCEPT_HEADER = "application/json";
export const MPL_SELECT =
  "MessageGuid,CorrelationId,IntegrationArtifact,IntegrationFlowName,Status,LogStart,LogEnd";

export const MPL_STATUSES = [
  "COMPLETED",
  "PROCESSING",
  "RETRY",
  "ESCALATED",
  "FAILED",
  "CANCELLED",
  "DISCARDED",
  "ABANDONED",
] as const;

export type MplStatus = (typeof MPL_STATUSES)[number];

export interface SearchMessageProcessingLogsRequest {
  fromUtc: string;
  toUtc: string;
  status?: MplStatus;
  integrationFlowId?: string;
  correlationId?: string;
  limit?: number;
}

export interface MessageProcessingLogItem {
  messageId: string;
  correlationId: string | null;
  integrationFlowId: string | null;
  integrationFlowName: string | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMilliseconds: number | null;
}

export interface SearchMessageProcessingLogsResponse {
  items: MessageProcessingLogItem[];
  count: number;
  hasMore: boolean;
}

export type MplErrorCategory =
  | "invalid_request"
  | "not_authorized"
  | "destination_unavailable"
  | "upstream_rate_limited"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "invalid_upstream_response";

export class MessageProcessingLogsError extends Error {
  readonly category: MplErrorCategory;

  constructor(category: MplErrorCategory, message: string = category) {
    super(message);
    this.name = "MessageProcessingLogsError";
    this.category = category;
  }
}

export interface ResolvedDestination {
  url: string;
  headers: Record<string, string>;
}

export interface DestinationResolver {
  resolve(name: string): Promise<ResolvedDestination>;
}

export interface MessageProcessingLogsConnectorOptions {
  resolver: DestinationResolver;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface MessageProcessingLogsConnectorLike {
  search(value: unknown): Promise<SearchMessageProcessingLogsResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidRequest(): MessageProcessingLogsError {
  return new MessageProcessingLogsError(
    "invalid_request",
    "The Message Processing Logs request is invalid",
  );
}

function assertSafeIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidRequest();
  }
}

function parseUtcTimestamp(value: unknown): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw invalidRequest();
  }

  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw invalidRequest();
  }
  return timestamp;
}

function parseStatus(value: unknown): MplStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !(MPL_STATUSES as readonly string[]).includes(value)
  ) {
    throw invalidRequest();
  }
  return value as MplStatus;
}

export function validateSearchRequest(
  value: unknown,
): SearchMessageProcessingLogsRequest {
  if (!isRecord(value)) {
    throw invalidRequest();
  }

  const allowedKeys = new Set([
    "fromUtc",
    "toUtc",
    "status",
    "integrationFlowId",
    "correlationId",
    "limit",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw invalidRequest();
  }

  const from = parseUtcTimestamp(value.fromUtc);
  const to = parseUtcTimestamp(value.toUtc);
  const windowMs = to.getTime() - from.getTime();
  if (
    !Number.isFinite(windowMs) ||
    windowMs <= 0 ||
    windowMs > MPL_MAX_WINDOW_MS
  ) {
    throw invalidRequest();
  }

  const limit = value.limit ?? MPL_DEFAULT_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MPL_MAX_LIMIT
  ) {
    throw invalidRequest();
  }

  const status = parseStatus(value.status);
  let integrationFlowId: string | undefined;
  if (value.integrationFlowId !== undefined) {
    assertSafeIdentifier(value.integrationFlowId);
    integrationFlowId = value.integrationFlowId;
  }

  let correlationId: string | undefined;
  if (value.correlationId !== undefined) {
    assertSafeIdentifier(value.correlationId);
    correlationId = value.correlationId;
  }

  return {
    fromUtc: from.toISOString(),
    toUtc: to.toISOString(),
    ...(status ? { status } : {}),
    ...(integrationFlowId ? { integrationFlowId } : {}),
    ...(correlationId ? { correlationId } : {}),
    limit,
  };
}

function escapeODataString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function serializeODataDateTime(value: string): string {
  const timestamp = parseUtcTimestamp(value);
  return `datetime'${timestamp.toISOString().slice(0, 19)}'`;
}

export function buildMessageProcessingLogsQuery(
  request: SearchMessageProcessingLogsRequest,
): URLSearchParams {
  const normalized = validateSearchRequest(request);
  const filters = [
    `LogStart ge ${serializeODataDateTime(normalized.fromUtc)}`,
    `LogStart lt ${serializeODataDateTime(normalized.toUtc)}`,
  ];
  if (normalized.status) {
    filters.push(`Status eq ${escapeODataString(normalized.status)}`);
  }
  if (normalized.correlationId) {
    filters.push(
      `CorrelationId eq ${escapeODataString(normalized.correlationId)}`,
    );
  }
  if (normalized.integrationFlowId) {
    filters.push(
      `IntegrationArtifact/Id eq ${escapeODataString(normalized.integrationFlowId)}`,
    );
  }

  return new URLSearchParams({
    $select: MPL_SELECT,
    $filter: filters.join(" and "),
    $orderby: "LogStart desc",
    $top: String((normalized.limit ?? MPL_DEFAULT_LIMIT) + 1),
  });
}

function isLoopbackHostname(hostname: string): boolean {
  return new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
    hostname.toLowerCase(),
  );
}

function buildMessageProcessingLogsUrl(
  destinationUrl: string,
  query: URLSearchParams,
): URL {
  let url: URL;
  try {
    url = new URL(destinationUrl);
  } catch {
    throw new MessageProcessingLogsError(
      "destination_unavailable",
      "The configured destination URL is invalid",
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
      "The configured destination URL is not allowed",
    );
  }

  let rootPath = url.pathname.replace(/\/+$/u, "");
  if (rootPath.endsWith("/api/v1")) {
    // The destination already points at the reviewed Cloud Integration API root.
  } else if (rootPath.endsWith("/api")) {
    rootPath += "/v1";
  } else {
    rootPath += "/api/v1";
  }
  url.pathname = `${rootPath}${MPL_ENTITY_PATH}`;
  url.search = query.toString();
  return url;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      "The upstream response is too large",
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new MessageProcessingLogsError(
        "invalid_upstream_response",
        "The upstream response is too large",
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new MessageProcessingLogsError(
          "invalid_upstream_response",
          "The upstream response is too large",
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

function responseError(status: number): MessageProcessingLogsError {
  if (status === 401 || status === 403) {
    return new MessageProcessingLogsError(
      "not_authorized",
      "The upstream service rejected authorization",
    );
  }
  if (status === 429) {
    return new MessageProcessingLogsError(
      "upstream_rate_limited",
      "The upstream service rate limited the request",
    );
  }
  if (status >= 500) {
    return new MessageProcessingLogsError(
      "upstream_unavailable",
      "The upstream service is unavailable",
    );
  }
  return new MessageProcessingLogsError(
    "invalid_upstream_response",
    "The upstream service returned an unexpected response",
  );
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      `The upstream ${field} field is invalid`,
    );
  }
  return value;
}

function parseUpstreamDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      `The upstream ${field} field is invalid`,
    );
  }

  const sapDate = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/u.exec(value);
  const timestamp = sapDate
    ? new Date(Number(sapDate[1]))
    : /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)
      ? new Date(value)
      : new Date(`${value}Z`);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      `The upstream ${field} field is invalid`,
    );
  }
  return timestamp.toISOString();
}

function normalizeRow(value: unknown): MessageProcessingLogItem {
  if (!isRecord(value)) {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      "The upstream result row is invalid",
    );
  }

  const messageId = value.MessageGuid;
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      "The upstream message identifier is invalid",
    );
  }
  const artifact = value.IntegrationArtifact;
  let integrationFlowId: string | null = null;
  if (artifact !== undefined && artifact !== null) {
    if (!isRecord(artifact)) {
      throw new MessageProcessingLogsError(
        "invalid_upstream_response",
        "The upstream integration artifact is invalid",
      );
    }
    integrationFlowId = optionalString(artifact.Id, "integration artifact");
  }

  const startedAt = parseUpstreamDate(value.LogStart, "LogStart");
  const endedAt = parseUpstreamDate(value.LogEnd, "LogEnd");
  const duration =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : null;
  const durationMilliseconds =
    duration !== null && duration >= 0 ? duration : null;

  return {
    messageId,
    correlationId: optionalString(value.CorrelationId, "CorrelationId"),
    integrationFlowId,
    integrationFlowName: optionalString(
      value.IntegrationFlowName,
      "IntegrationFlowName",
    ),
    status: optionalString(value.Status, "Status"),
    startedAt,
    endedAt,
    durationMilliseconds,
  };
}

function extractRows(value: unknown): unknown[] {
  if (
    !isRecord(value) ||
    !isRecord(value.d) ||
    !Array.isArray(value.d.results)
  ) {
    throw new MessageProcessingLogsError(
      "invalid_upstream_response",
      "The upstream OData response shape is invalid",
    );
  }
  return value.d.results;
}

export class MessageProcessingLogsConnector implements MessageProcessingLogsConnectorLike {
  private readonly resolver: DestinationResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: MessageProcessingLogsConnectorOptions) {
    this.resolver = options.resolver;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? MPL_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? MPL_MAX_RESPONSE_BYTES;
  }

  async search(value: unknown): Promise<SearchMessageProcessingLogsResponse> {
    const request = validateSearchRequest(value);
    let destination: ResolvedDestination;
    try {
      destination = await this.resolver.resolve(MPL_DESTINATION_NAME);
    } catch (error: unknown) {
      if (error instanceof MessageProcessingLogsError) {
        throw error;
      }
      throw new MessageProcessingLogsError(
        "destination_unavailable",
        "The configured destination is unavailable",
      );
    }

    const query = buildMessageProcessingLogsQuery(request);
    const endpoint = buildMessageProcessingLogsUrl(destination.url, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let body: string;
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          ...destination.headers,
          Accept: MPL_ACCEPT_HEADER,
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw responseError(response.status);
      }
      const contentType = response.headers.get("content-type");
      if (
        contentType &&
        !contentType.toLowerCase().startsWith("application/json")
      ) {
        throw new MessageProcessingLogsError(
          "invalid_upstream_response",
          "The upstream content type is invalid",
        );
      }
      body = await readBoundedBody(response, this.maxResponseBytes);
    } catch (error: unknown) {
      if (error instanceof MessageProcessingLogsError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MessageProcessingLogsError(
          "upstream_timeout",
          "The upstream request timed out",
        );
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new MessageProcessingLogsError(
          "upstream_timeout",
          "The upstream request timed out",
        );
      }
      throw new MessageProcessingLogsError(
        "upstream_unavailable",
        "The upstream request failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch (error: unknown) {
      if (error instanceof MessageProcessingLogsError) {
        throw error;
      }
      throw new MessageProcessingLogsError(
        "invalid_upstream_response",
        "The upstream response is not valid JSON",
      );
    }

    const rows = extractRows(payload).map(normalizeRow);
    const limit = request.limit ?? MPL_DEFAULT_LIMIT;
    const items = rows.slice(0, limit);
    return {
      items,
      count: items.length,
      hasMore: rows.length > limit,
    };
  }

  /** Exposed for deterministic tests and observability without logging secrets. */
  getNow(): number {
    return this.now();
  }
}
