import type { Pool } from "pg";
import type { ChatTool } from "@flowpilot/agent-core";
import { quoteIdentifier } from "./db/migrations.js";
import type { AuthenticatedUser } from "./types.js";

const FAILED = new Set([
  "FAILED",
  "CANCELLED",
  "DISCARDED",
  "ABANDONED",
  "ESCALATED",
]);
const TERMINAL = new Set(["COMPLETED", ...FAILED]);
const SCHEMA = quoteIdentifier("flowpilot_app");

export interface HealthMplItem {
  messageId: string;
  applicationMessageId?: string | null;
  applicationMessageType?: string | null;
  integrationFlowId?: string | null;
  integrationFlowName?: string | null;
  status?: string | null;
  endedAt?: string | null;
  durationMilliseconds?: number | null;
}
interface HealthSnapshotRow {
  bucket_start: Date;
  flow_id: string;
  flow_name: string;
  status_counts: Record<string, number>;
  business_messages: BusinessMessage[];
  representative_error: string | null;
  partial: boolean;
}
export interface BusinessMessage {
  applicationMessageId: string | null;
  applicationMessageType: string | null;
  failed: number;
  completed: number;
  lastFailureAt: string | null;
  latestError: string | null;
  durationTotalMilliseconds?: number;
  durationSamples?: number;
}
export interface HealthFlow {
  flowId: string;
  flowName: string;
  processed: number;
  failed: number;
  failureRate: number;
  changePoints: number | null;
  partial: boolean;
  recurring: boolean;
  intermittent: boolean;
  businessMessages: BusinessMessage[];
  representativeError: string | null;
  averageProcessingMilliseconds: number | null;
}
export interface HealthSummary {
  window: "last_completed_hour" | "today" | "yesterday" | "last_24_hours";
  from: string;
  to: string;
  partial: boolean;
  processed: number;
  failed: number;
  failureRate: number;
  changePoints: number | null;
  trend: number[];
  flows: HealthFlow[];
  conclusion: string;
}

export class IntegrationHealthSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IntegrationHealthSourceError";
  }
}

function count(values: Record<string, number>, status: string) {
  return values[status] ?? 0;
}
function total(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([status]) => TERMINAL.has(status))
    .reduce((sum, [, value]) => sum + value, 0);
}
function failureRate(processed: number, failed: number) {
  return processed === 0 ? 0 : (failed / processed) * 100;
}
function hour(value: Date) {
  const result = new Date(value);
  result.setUTCMinutes(0, 0, 0);
  return result;
}
function iso(value: Date) {
  return value.toISOString();
}
function range(window: HealthSummary["window"], now = new Date()) {
  const end = hour(now);
  const start = new Date(end);
  if (window === "last_completed_hour")
    start.setUTCHours(start.getUTCHours() - 1);
  else if (window === "last_24_hours")
    start.setUTCHours(start.getUTCHours() - 24);
  else if (window === "today") start.setUTCHours(0, 0, 0, 0);
  else {
    end.setUTCHours(0, 0, 0, 0);
    start.setTime(end.getTime());
    start.setUTCDate(start.getUTCDate() - 1);
  }
  return { start, end };
}

export function calculateHealth(
  items: HealthMplItem[],
  partial: boolean,
): Array<Omit<HealthSnapshotRow, "bucket_start" | "representative_error">> {
  const flows = new Map<
    string,
    Omit<HealthSnapshotRow, "bucket_start" | "representative_error">
  >();
  for (const item of items) {
    const flowId = item.integrationFlowId ?? "unidentified";
    const flowName = item.integrationFlowName ?? flowId;
    let flow = flows.get(flowId);
    if (!flow) {
      flow = {
        flow_id: flowId,
        flow_name: flowName,
        status_counts: {},
        business_messages: [],
        partial,
      };
      flows.set(flowId, flow);
    }
    const status = item.status ?? "UNKNOWN";
    flow.status_counts[status] = (flow.status_counts[status] ?? 0) + 1;
    if (!TERMINAL.has(status)) continue;
    const applicationMessageId = item.applicationMessageId ?? null;
    let message = flow.business_messages.find(
      (entry) => entry.applicationMessageId === applicationMessageId,
    );
    if (!message) {
      message = {
        applicationMessageId,
        applicationMessageType: item.applicationMessageType ?? null,
        failed: 0,
        completed: 0,
        lastFailureAt: null,
        latestError: null,
      };
      flow.business_messages.push(message);
    }
    if (status === "COMPLETED") message.completed += 1;
    else if (FAILED.has(status)) {
      message.failed += 1;
      message.lastFailureAt = item.endedAt ?? null;
    }
    if (typeof item.durationMilliseconds === "number" && item.durationMilliseconds >= 0) {
      message.durationTotalMilliseconds = (message.durationTotalMilliseconds ?? 0) + item.durationMilliseconds;
      message.durationSamples = (message.durationSamples ?? 0) + 1;
    }
  }
  return [...flows.values()];
}

export class IntegrationHealthService {
  constructor(
    private readonly pool: Pool,
    private readonly resolveTools: (
      user: AuthenticatedUser,
    ) => Promise<ChatTool[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async collect(user: AuthenticatedUser, at = this.now()) {
    const end = hour(at);
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const tool = (await this.resolveTools(user)).find((candidate) =>
      candidate.name.endsWith("__search_message_processing_logs"),
    );
    if (!tool) throw new Error("integration_health_source_unavailable");
    const raw = await tool.invoke({
      fromUtc: iso(start),
      toUtc: iso(end),
      limit: 100,
    });
    let result: { items?: HealthMplItem[]; hasMore?: boolean; error?: unknown };
    try {
      result = JSON.parse(raw) as {
        items?: HealthMplItem[];
        hasMore?: boolean;
      };
    } catch {
      throw new IntegrationHealthSourceError("mcp_response_unusable");
    }
    if (typeof result.error === "string" && /^[a-z_]{3,80}$/u.test(result.error))
      throw new IntegrationHealthSourceError(result.error);
    if (!Array.isArray(result.items))
      throw new IntegrationHealthSourceError("invalid_response");
    const snapshots = calculateHealth(result.items, result.hasMore === true);
    // Error text is deliberately fetched only once per failing flow, after the
    // fixed rules identify it as attention-worthy. No payload or trace data is
    // requested by this path.
    const errorTool = (await this.resolveTools(user)).find((candidate) =>
      candidate.name.endsWith("__get_message_processing_log_error_information"),
    );
    const representativeErrors = new Map<string, string>();
    if (errorTool) {
      const seen = new Set<string>();
      const failedMessages = result.items.filter((item) => {
        const key = `${item.integrationFlowId ?? ""}\u0000${item.applicationMessageId ?? item.messageId}`;
        if (!item.messageId || !item.status || !FAILED.has(item.status) || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 50);
      for (const failed of failedMessages) {
        try {
          const parsed = JSON.parse(
            await errorTool.invoke({
              messageId: failed.messageId,
              status: failed.status,
            }),
          ) as { errorInformation?: unknown };
          if (
            typeof parsed.errorInformation !== "string" ||
            !parsed.errorInformation.trim()
          )
            continue;
          const error = parsed.errorInformation.trim().slice(0, 2_000);
          const flowId = failed.integrationFlowId ?? "unidentified";
          representativeErrors.set(flowId, error);
          const snapshot = snapshots.find((entry) => entry.flow_id === flowId);
          const message = snapshot?.business_messages.find(
            (entry) =>
              entry.applicationMessageId ===
              (failed.applicationMessageId ?? null),
          );
          if (message) message.latestError = error;
        } catch {
          /* Health metrics remain usable if a bounded error lookup fails. */
        }
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM " + SCHEMA + ".integration_health_snapshots WHERE tenant_id = $1 AND bucket_start = $2", [user.tenantId, start]);
      for (const snapshot of snapshots) await client.query(
        "INSERT INTO " + SCHEMA + ".integration_health_snapshots (tenant_id, bucket_start, flow_id, flow_name, status_counts, business_messages, representative_error, partial) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) ON CONFLICT (tenant_id, bucket_start, flow_id) DO UPDATE SET flow_name=EXCLUDED.flow_name, status_counts=EXCLUDED.status_counts, business_messages=EXCLUDED.business_messages, representative_error=EXCLUDED.representative_error, partial=EXCLUDED.partial, created_at=now()",
        [user.tenantId, start, snapshot.flow_id, snapshot.flow_name, JSON.stringify(snapshot.status_counts), JSON.stringify(snapshot.business_messages), representativeErrors.get(snapshot.flow_id) ?? null, snapshot.partial],
      );
      let retentionDays = 30;
      try {
        const setting = await client.query<{ retention_days: number }>(
          "SELECT retention_days FROM " + SCHEMA + ".integration_health_settings WHERE tenant_id = $1",
          [user.tenantId],
        );
        retentionDays = setting.rows[0]?.retention_days ?? retentionDays;
      } catch {
        // Collection must stay available while an older deployment completes
        // the additive settings migration.
      }
      // Calculate the retention boundary in application code. Passing a bound
      // parameter into PostgreSQL's named `make_interval` argument leaves its
      // type unresolved with some managed PostgreSQL drivers, which aborts the
      // whole collection transaction after the snapshot insert.
      const retentionCutoff = new Date(start);
      retentionCutoff.setUTCDate(retentionCutoff.getUTCDate() - retentionDays);
      await client.query(
        "DELETE FROM " + SCHEMA + ".integration_health_snapshots WHERE tenant_id = $1 AND bucket_start < $2",
        [user.tenantId, retentionCutoff],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return {
      bucketStart: iso(start),
      partial: result.hasMore === true,
      flows: snapshots.length,
    };
  }

  async collectRecent(user: AuthenticatedUser, hours: number) {
    const boundedHours = Math.min(Math.max(Math.trunc(hours), 1), 24);
    const end = hour(this.now());
    let flows = 0;
    let partial = false;
    for (let offset = boundedHours; offset >= 1; offset -= 1) {
      const collected = await this.collect(user, new Date(end.getTime() - (offset - 1) * 60 * 60 * 1000));
      flows += collected.flows;
      partial ||= collected.partial;
    }
    return { bucketStart: iso(new Date(end.getTime() - 60 * 60 * 1000)), partial, flows };
  }

  async retentionDays(user: AuthenticatedUser) {
    const result = await this.pool.query<{ retention_days: number }>(
      "SELECT retention_days FROM " + SCHEMA + ".integration_health_settings WHERE tenant_id = $1",
      [user.tenantId],
    );
    return result.rows[0]?.retention_days ?? 30;
  }

  async updateRetentionDays(user: AuthenticatedUser, retentionDays: number) {
    await this.pool.query(
      "INSERT INTO " + SCHEMA + ".integration_health_settings (tenant_id, retention_days) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET retention_days = EXCLUDED.retention_days, updated_at = now()",
      [user.tenantId, retentionDays],
    );
    return { retentionDays };
  }

  async summary(
    user: AuthenticatedUser,
    window: HealthSummary["window"] = "last_completed_hour",
  ): Promise<HealthSummary> {
    const current = range(window, this.now());
    const result = await this.pool.query<HealthSnapshotRow>(
      "SELECT bucket_start, flow_id, flow_name, status_counts, business_messages, representative_error, partial FROM " +
        SCHEMA +
        ".integration_health_snapshots WHERE tenant_id=$1 AND bucket_start >= $2 AND bucket_start < $3 ORDER BY bucket_start",
      [user.tenantId, current.start, current.end],
    );
    const previous = range("last_completed_hour", current.start);
    const prior = await this.pool.query<HealthSnapshotRow>(
      "SELECT status_counts FROM " +
        SCHEMA +
        ".integration_health_snapshots WHERE tenant_id=$1 AND bucket_start >= $2 AND bucket_start < $3",
      [user.tenantId, previous.start, previous.end],
    );
    const grouped = new Map<string, HealthFlow>();
    const trend = new Map<string, { processed: number; failed: number }>();
    for (const row of result.rows) {
      const processed = total(row.status_counts),
        failed = [...FAILED].reduce(
          (sum, status) => sum + count(row.status_counts, status),
          0,
        );
      const entry = grouped.get(row.flow_id) ?? {
        flowId: row.flow_id,
        flowName: row.flow_name,
        processed: 0,
        failed: 0,
        failureRate: 0,
        changePoints: null,
        partial: false,
        recurring: false,
        intermittent: false,
        businessMessages: [],
        representativeError: row.representative_error,
        averageProcessingMilliseconds: null,
      };
      entry.processed += processed;
      entry.failed += failed;
      entry.partial ||= row.partial;
      entry.representativeError ??= row.representative_error;
      for (const message of row.business_messages ?? []) {
        const existing = entry.businessMessages.find(
          (value) =>
            value.applicationMessageId === message.applicationMessageId,
        );
        if (existing) {
          existing.failed += message.failed;
          existing.completed += message.completed;
          existing.durationTotalMilliseconds = (existing.durationTotalMilliseconds ?? 0) + (message.durationTotalMilliseconds ?? 0);
          existing.durationSamples = (existing.durationSamples ?? 0) + (message.durationSamples ?? 0);
          if ((message.lastFailureAt ?? "") > (existing.lastFailureAt ?? "")) {
            existing.lastFailureAt = message.lastFailureAt;
            existing.latestError = message.latestError ?? existing.latestError;
          }
        } else entry.businessMessages.push({ ...message });
      }
      grouped.set(row.flow_id, entry);
      const bucket = iso(new Date(row.bucket_start));
      const bucketTotal = trend.get(bucket) ?? { processed: 0, failed: 0 };
      bucketTotal.processed += processed;
      bucketTotal.failed += failed;
      trend.set(bucket, bucketTotal);
    }
    const priorProcessed = prior.rows.reduce(
      (sum, row) => sum + total(row.status_counts),
      0,
    );
    const priorFailed = prior.rows.reduce(
      (sum, row) =>
        sum +
        [...FAILED].reduce(
          (value, status) => value + count(row.status_counts, status),
          0,
        ),
      0,
    );
    const processed = [...grouped.values()].reduce(
      (sum, flow) => sum + flow.processed,
      0,
    );
    const failed = [...grouped.values()].reduce(
      (sum, flow) => sum + flow.failed,
      0,
    );
    const rate = failureRate(processed, failed);
    const flows = [...grouped.values()]
      .map((flow) => ({
        ...flow,
        failureRate: failureRate(flow.processed, flow.failed),
        averageProcessingMilliseconds: (() => {
          const samples = flow.businessMessages.reduce((sum, message) => sum + (message.durationSamples ?? 0), 0);
          const totalDuration = flow.businessMessages.reduce((sum, message) => sum + (message.durationTotalMilliseconds ?? 0), 0);
          return samples ? totalDuration / samples : null;
        })(),
        recurring:
          flow.failed > 0 &&
          result.rows.filter(
            (row) =>
              row.flow_id === flow.flowId &&
              [...FAILED].some(
                (status) => count(row.status_counts, status) > 0,
              ),
          ).length > 1,
        intermittent: flow.businessMessages.some(
          (message) => message.failed > 0 && message.completed > 0,
        ),
      }))
      .filter((flow) => flow.failed > 0)
      .sort((a, b) => b.failureRate - a.failureRate);
    const partial = result.rows.some((row) => row.partial);
    return {
      window,
      from: iso(current.start),
      to: iso(current.end),
      partial,
      processed,
      failed,
      failureRate: rate,
      changePoints: rate - failureRate(priorProcessed, priorFailed),
      trend: [...trend.values()].map((value) =>
        failureRate(value.processed, value.failed),
      ),
      flows,
      conclusion:
        failed === 0
          ? "Healthy: no terminal failures were collected."
          : `Attention required: ${flows.length} flow${flows.length === 1 ? "" : "s"} had terminal failures.${partial ? " Collection is partial." : ""}`,
    };
  }
}

/** Starts the non-LLM hourly collector when a deployment supplies its tenant. */
export function startIntegrationHealthCollector(
  service: IntegrationHealthService,
  tenantId: string | undefined,
  subject: string | undefined,
) {
  if (!tenantId || !subject) return () => undefined;
  let collectedBucket = "";
  const tick = () => {
    const now = new Date();
    if (now.getUTCMinutes() < 5 || now.getUTCMinutes() > 9) return;
    const bucket = iso(hour(new Date(now.getTime() - 60 * 60 * 1000)));
    if (bucket === collectedBucket) return;
    collectedBucket = bucket;
    void service
      .collect({ tenantId, subject, scopes: ["ToolOperator"] })
      .catch(() => {
        collectedBucket = "";
      });
  };
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
