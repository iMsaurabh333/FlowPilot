import type { Pool, PoolClient } from "pg";

import { quoteIdentifier } from "../db/migrations.js";

export const MCP_ADMIN_SCOPE = "ChatAdmin";
export const MCP_DEFAULT_PATH = "/mcp";
export const MCP_MAX_SERVERS = 50;
export const MCP_HEALTH_MAX_AGE_MS = 5 * 60 * 1_000;

export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25"] as const;
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

export const MCP_HEALTH_STATES = [
  "never_checked",
  "healthy",
  "unhealthy",
  "stale",
] as const;
export type McpHealthState = (typeof MCP_HEALTH_STATES)[number];

export const MCP_POLICY_PRESET_IDS = ["generic"] as const;
export type McpPolicyPresetId = (typeof MCP_POLICY_PRESET_IDS)[number];

export interface ApprovedMcpPolicyPreset {
  policyPresetId: McpPolicyPresetId;
  requiredScopes: readonly string[];
  allowExternalPort: boolean;
  allowedPath: string;
  allowedAuthProfilePattern: RegExp;
}

export const APPROVED_MCP_POLICY_PRESETS: Record<
  McpPolicyPresetId,
  ApprovedMcpPolicyPreset
> = {
  generic: {
    policyPresetId: "generic",
    requiredScopes: ["McpInvoke"],
    allowExternalPort: true,
    allowedPath: MCP_DEFAULT_PATH,
    allowedAuthProfilePattern:
      /^(?:destination:[A-Za-z0-9_.-]{1,100}|technical:flowpilot-mcp)$/u,
  },
};

export interface McpServerRecord {
  serverId: string;
  policyPresetId: McpPolicyPresetId;
  displayName: string;
  endpointUrl: string;
  mcpPath: string;
  externalPort: number | null;
  authProfileRef: string;
  allowedToolNames: string[];
  requiredScopes: string[];
  enabled: boolean;
  healthState: McpHealthState;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  protocolVersion: McpProtocolVersion | null;
  discoveredToolCount: number | null;
  lastErrorCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerInput {
  policyPresetId?: McpPolicyPresetId;
  displayName?: string;
  endpointUrl?: string;
  externalPort?: number | null;
  authProfileRef?: string;
  allowedToolNames?: string[];
  enabled?: boolean;
}

export interface McpProbeResult {
  healthState: Exclude<McpHealthState, "never_checked" | "stale">;
  checkedAt: string;
  latencyMs: number | null;
  protocolVersion: McpProtocolVersion | null;
  discoveredToolCount: number | null;
  errorCategory: string | null;
}

export interface McpServerProbe {
  ping(server: McpServerRecord): Promise<McpProbeResult>;
}

export interface McpRegistryRepository {
  list(): Promise<McpServerRecord[]>;
  find(serverId: string): Promise<McpServerRecord | undefined>;
  save(server: McpServerRecord): Promise<void>;
}

export class McpRegistryError extends Error {
  readonly code:
    | "invalid_request"
    | "not_found"
    | "server_unhealthy"
    | "registry_unavailable";

  constructor(
    code: McpRegistryError["code"],
    message = "MCP registry request failed",
  ) {
    super(message);
    this.name = "McpRegistryError";
    this.code = code;
  }
}

function assertSafeText(
  value: unknown,
  field: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new McpRegistryError("invalid_request", `Invalid ${field}`);
  }
}

function validateServerId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62})$/u.test(value)
  ) {
    throw new McpRegistryError("invalid_request", "Invalid server ID");
  }
}

function isLoopbackHostname(hostname: string) {
  return new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
    hostname.toLowerCase(),
  );
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "metadata.google.internal" ||
    normalized === "169.254.169.254" ||
    normalized === "100.100.100.200" ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("127.") ||
    normalized.startsWith("169.254.") ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./u.test(normalized)
  );
}

function validateEndpoint(value: unknown) {
  assertSafeText(value, "endpoint URL", 2_048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpRegistryError("invalid_request", "Invalid endpoint URL");
  }
  const loopbackHttp =
    url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (
    (url.protocol !== "https:" && !loopbackHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (isBlockedHostname(url.hostname) && !isLoopbackHostname(url.hostname))
  ) {
    throw new McpRegistryError(
      "invalid_request",
      "Endpoint URL is not allowed",
    );
  }
  return url.href.replace(/\/+$/u, "");
}

function validateAuthProfile(
  value: unknown,
  policyPreset: ApprovedMcpPolicyPreset,
) {
  assertSafeText(value, "authentication profile", 128);
  if (!policyPreset.allowedAuthProfilePattern.test(value)) {
    throw new McpRegistryError(
      "invalid_request",
      "Authentication profile is not approved",
    );
  }
  return value;
}

function validateNames(value: unknown, field: string) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(entry),
    )
  ) {
    throw new McpRegistryError("invalid_request", `Invalid ${field}`);
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) {
    throw new McpRegistryError("invalid_request", `Duplicate ${field}`);
  }
  return unique;
}

function validatePort(
  value: unknown,
  policyPreset: ApprovedMcpPolicyPreset,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !policyPreset.allowExternalPort ||
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new McpRegistryError(
      "invalid_request",
      "External port is not allowed",
    );
  }
  return value;
}

function validatePolicyPreset(value: unknown): ApprovedMcpPolicyPreset {
  if (typeof value !== "string" || !(value in APPROVED_MCP_POLICY_PRESETS)) {
    throw new McpRegistryError(
      "invalid_request",
      "MCP policy preset is not approved",
    );
  }
  return APPROVED_MCP_POLICY_PRESETS[value as McpPolicyPresetId];
}

function storedPolicyPreset(value: unknown): McpPolicyPresetId {
  if (
    value === "generic" ||
    value === "cloud-integration-monitoring" ||
    value === "cloud-integration-content" ||
    value === "event-mesh"
  ) {
    return "generic";
  }
  throw new McpRegistryError(
    "registry_unavailable",
    "Registry policy preset is invalid",
  );
}

function iso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new McpRegistryError(
      "registry_unavailable",
      "Registry timestamp is invalid",
    );
  }
  return date.toISOString();
}

function rowToRecord(row: Record<string, unknown>): McpServerRecord {
  const policyPresetId = storedPolicyPreset(row.profile_id);
  const policyPreset = APPROVED_MCP_POLICY_PRESETS[policyPresetId];
  return {
    serverId: String(row.server_id),
    policyPresetId,
    displayName: String(row.display_name),
    endpointUrl: String(row.endpoint_url),
    mcpPath: policyPreset.allowedPath,
    externalPort:
      row.external_port === null || row.external_port === undefined
        ? null
        : Number(row.external_port),
    authProfileRef: String(row.auth_profile_ref),
    allowedToolNames: Array.isArray(row.allowed_tool_names)
      ? row.allowed_tool_names.map(String)
      : [],
    requiredScopes: [...policyPreset.requiredScopes],
    enabled: Boolean(row.enabled),
    healthState: String(row.health_state) as McpHealthState,
    lastCheckedAt: row.last_checked_at ? iso(row.last_checked_at) : null,
    latencyMs:
      row.latency_ms === null || row.latency_ms === undefined
        ? null
        : Number(row.latency_ms),
    protocolVersion:
      row.protocol_version === null || row.protocol_version === undefined
        ? null
        : (String(row.protocol_version) as McpProtocolVersion),
    discoveredToolCount:
      row.discovered_tool_count === null ||
      row.discovered_tool_count === undefined
        ? null
        : Number(row.discovered_tool_count),
    lastErrorCategory:
      row.last_error_category === null || row.last_error_category === undefined
        ? null
        : String(row.last_error_category),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PostgresMcpRegistryRepository implements McpRegistryRepository {
  readonly #pool: Pool;
  readonly #schema: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    this.#schema = quoteIdentifier(schemaName);
  }

  async #withAdmin<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('flowpilot.is_admin', 'true', true)",
      );
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list() {
    return this.#withAdmin(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${this.#schema}.mcp_servers ORDER BY display_name, server_id`,
      );
      return result.rows.map(rowToRecord);
    });
  }

  async find(serverId: string) {
    return this.#withAdmin(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${this.#schema}.mcp_servers WHERE server_id = $1`,
        [serverId],
      );
      return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
    });
  }

  async save(server: McpServerRecord) {
    await this.#withAdmin((client) =>
      client.query(
        `
        INSERT INTO ${this.#schema}.mcp_servers (
          server_id, profile_id, display_name, endpoint_url, mcp_path,
          external_port, auth_profile_ref, allowed_tool_names, required_scopes,
          enabled, health_state, last_checked_at, latency_ms, protocol_version,
          discovered_tool_count, last_error_category, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (server_id) DO UPDATE SET
          profile_id = EXCLUDED.profile_id,
          display_name = EXCLUDED.display_name,
          endpoint_url = EXCLUDED.endpoint_url,
          mcp_path = EXCLUDED.mcp_path,
          external_port = EXCLUDED.external_port,
          auth_profile_ref = EXCLUDED.auth_profile_ref,
          allowed_tool_names = EXCLUDED.allowed_tool_names,
          required_scopes = EXCLUDED.required_scopes,
          enabled = EXCLUDED.enabled,
          health_state = EXCLUDED.health_state,
          last_checked_at = EXCLUDED.last_checked_at,
          latency_ms = EXCLUDED.latency_ms,
          protocol_version = EXCLUDED.protocol_version,
          discovered_tool_count = EXCLUDED.discovered_tool_count,
          last_error_category = EXCLUDED.last_error_category,
          updated_at = EXCLUDED.updated_at
      `,
        [
          server.serverId,
          server.policyPresetId,
          server.displayName,
          server.endpointUrl,
          server.mcpPath,
          server.externalPort,
          server.authProfileRef,
          server.allowedToolNames,
          server.requiredScopes,
          server.enabled,
          server.healthState,
          server.lastCheckedAt,
          server.latencyMs,
          server.protocolVersion,
          server.discoveredToolCount,
          server.lastErrorCategory,
          server.createdAt,
          server.updatedAt,
        ],
      ),
    );
  }
}

export class MemoryMcpRegistryRepository implements McpRegistryRepository {
  readonly records = new Map<string, McpServerRecord>();

  async list() {
    return [...this.records.values()].sort((a, b) =>
      `${a.displayName}\0${a.serverId}`.localeCompare(
        `${b.displayName}\0${b.serverId}`,
      ),
    );
  }

  async find(serverId: string) {
    return this.records.get(serverId);
  }

  async save(server: McpServerRecord) {
    this.records.set(server.serverId, server);
  }
}

function mergeServer(
  serverId: string,
  existing: McpServerRecord | undefined,
  input: McpServerInput,
  now: string,
): McpServerRecord {
  validateServerId(serverId);
  const policyPreset = validatePolicyPreset(
    input.policyPresetId ?? existing?.policyPresetId ?? "generic",
  );
  const displayName = input.displayName ?? existing?.displayName;
  const endpointUrl = input.endpointUrl ?? existing?.endpointUrl;
  const authProfileRef = input.authProfileRef ?? existing?.authProfileRef;
  const allowedToolNames =
    input.allowedToolNames ?? existing?.allowedToolNames ?? [];
  if (displayName === undefined) {
    throw new McpRegistryError("invalid_request", "Display name is required");
  }
  if (endpointUrl === undefined) {
    throw new McpRegistryError("invalid_request", "Endpoint URL is required");
  }
  if (authProfileRef === undefined) {
    throw new McpRegistryError(
      "invalid_request",
      "Authentication profile is required",
    );
  }
  assertSafeText(displayName, "display name", 120);
  const normalizedEndpoint = validateEndpoint(endpointUrl);
  const normalizedAuth = validateAuthProfile(authProfileRef, policyPreset);
  const normalizedTools = validateNames(allowedToolNames, "allowed tools");
  const externalPort = validatePort(
    input.externalPort !== undefined
      ? input.externalPort
      : existing?.externalPort,
    policyPreset,
  );
  const enabled = input.enabled ?? existing?.enabled ?? false;
  if (typeof enabled !== "boolean") {
    throw new McpRegistryError("invalid_request", "Enabled must be boolean");
  }

  return {
    serverId,
    policyPresetId: policyPreset.policyPresetId,
    displayName,
    endpointUrl: normalizedEndpoint,
    mcpPath: policyPreset.allowedPath,
    externalPort,
    authProfileRef: normalizedAuth,
    allowedToolNames: normalizedTools,
    requiredScopes: [...policyPreset.requiredScopes],
    enabled,
    healthState: existing?.healthState ?? "never_checked",
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    latencyMs: existing?.latencyMs ?? null,
    protocolVersion: existing?.protocolVersion ?? null,
    discoveredToolCount: existing?.discoveredToolCount ?? null,
    lastErrorCategory: existing?.lastErrorCategory ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function applyProbe(server: McpServerRecord, result: McpProbeResult) {
  return {
    ...server,
    healthState: result.healthState,
    lastCheckedAt: result.checkedAt,
    latencyMs: result.latencyMs,
    protocolVersion: result.protocolVersion,
    discoveredToolCount: result.discoveredToolCount,
    lastErrorCategory: result.errorCategory,
    updatedAt: result.checkedAt,
  } satisfies McpServerRecord;
}

export class McpRegistryService {
  readonly #repository: McpRegistryRepository;
  readonly #probe: McpServerProbe;
  readonly #now: () => string;

  constructor(
    repository: McpRegistryRepository,
    probe: McpServerProbe,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#probe = probe;
    this.#now = now;
  }

  async #listRecords() {
    try {
      return await this.#repository.list();
    } catch {
      throw new McpRegistryError(
        "registry_unavailable",
        "MCP registry storage is unavailable",
      );
    }
  }

  async #findRecord(serverId: string) {
    try {
      return await this.#repository.find(serverId);
    } catch {
      throw new McpRegistryError(
        "registry_unavailable",
        "MCP registry storage is unavailable",
      );
    }
  }

  async #saveRecord(server: McpServerRecord) {
    try {
      await this.#repository.save(server);
    } catch {
      throw new McpRegistryError(
        "registry_unavailable",
        "MCP registry storage is unavailable",
      );
    }
  }

  async #probeRecord(server: McpServerRecord): Promise<McpProbeResult> {
    try {
      return await this.#probe.ping(server);
    } catch {
      return {
        healthState: "unhealthy",
        checkedAt: this.#now(),
        latencyMs: null,
        protocolVersion: null,
        discoveredToolCount: null,
        errorCategory: "upstream_unavailable",
      };
    }
  }

  async #assertPortAvailable(serverId: string, externalPort: number | null) {
    if (externalPort === null) return;
    const records = await this.#listRecords();
    if (
      records.some(
        (record) =>
          record.serverId !== serverId && record.externalPort === externalPort,
      )
    ) {
      throw new McpRegistryError(
        "invalid_request",
        "External port is already assigned",
      );
    }
  }

  async list() {
    const records = await this.#listRecords();
    return records.map((record) => {
      if (
        record.healthState === "healthy" &&
        record.lastCheckedAt &&
        Date.parse(record.lastCheckedAt) + MCP_HEALTH_MAX_AGE_MS < Date.now()
      ) {
        return { ...record, healthState: "stale" as const };
      }
      return record;
    });
  }

  async upsert(serverId: string, input: McpServerInput) {
    validateServerId(serverId);
    const existing = await this.#findRecord(serverId);
    if (!existing && (await this.#listRecords()).length >= MCP_MAX_SERVERS) {
      throw new McpRegistryError(
        "invalid_request",
        "MCP server registry limit reached",
      );
    }
    const now = this.#now();
    const candidate = mergeServer(serverId, existing, input, now);
    await this.#assertPortAvailable(serverId, candidate.externalPort);
    if (!candidate.enabled) {
      await this.#saveRecord(candidate);
      return candidate;
    }

    const probe = await this.#probeRecord(candidate);
    const checked = applyProbe(candidate, probe);
    if (probe.healthState !== "healthy") {
      await this.#saveRecord({ ...checked, enabled: false });
      throw new McpRegistryError(
        "server_unhealthy",
        "MCP server must pass Ping before it can be enabled",
      );
    }
    await this.#saveRecord(checked);
    return checked;
  }

  async ping(serverId: string) {
    validateServerId(serverId);
    const existing = await this.#findRecord(serverId);
    if (!existing) {
      throw new McpRegistryError("not_found", "MCP server not found");
    }
    const checked = applyProbe(existing, await this.#probeRecord(existing));
    await this.#saveRecord(checked);
    return checked;
  }
}
