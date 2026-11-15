import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { quoteIdentifier } from "./db/migrations.js";
import type { AuthenticatedUser } from "./types.js";

export type OperationLogEvent = { surface: "chat" | "report" | "system"; eventType: "llm_input" | "mcp_call" | "error"; title: string; detail: Record<string, unknown>; reportJobId?: string | null };
export type OperationLogEntry = OperationLogEvent & { id: string; createdAt: string };

function bounded(value: unknown) { const text = JSON.stringify(value); return text.length > 24_000 ? `${text.slice(0, 24_000)}…[truncated]` : text; }
function detailFrom(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return { raw: String(value) };
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { raw: value };
  } catch {
    return { raw: value };
  }
}

export class OperationLogService {
  readonly #pool: Pool; readonly #table: string;
  constructor(pool: Pool, schemaName = "flowpilot_app") { this.#pool = pool; this.#table = `${quoteIdentifier(schemaName)}.operation_logs`; }
  async record(user: AuthenticatedUser, event: OperationLogEvent) {
    const client = await this.#pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('flowpilot.tenant_id',$1,true), set_config('flowpilot.subject_id',$2,true)", [user.tenantId, user.subject]); await client.query(`INSERT INTO ${this.#table} (id,tenant_id,subject_id,surface,event_type,title,report_job_id,detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), user.tenantId, user.subject, event.surface, event.eventType, event.title.slice(0, 240), event.reportJobId ?? null, bounded(event.detail)]); await client.query("COMMIT"); } catch { await client.query("ROLLBACK"); } finally { client.release(); }
  }
  async list(user: AuthenticatedUser, limit = 100): Promise<OperationLogEntry[]> {
    const client = await this.#pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('flowpilot.tenant_id',$1,true), set_config('flowpilot.subject_id',$2,true)", [user.tenantId, user.subject]); const result = await client.query<{ id:string; surface:OperationLogEntry["surface"]; event_type:OperationLogEntry["eventType"]; title:string; report_job_id:string|null; detail:unknown; created_at:Date }>(`SELECT * FROM ${this.#table} ORDER BY created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 200)]); await client.query("COMMIT"); return result.rows.map((row) => ({ id: row.id, surface: row.surface, eventType: row.event_type, title: row.title, reportJobId: row.report_job_id, detail: detailFrom(row.detail), createdAt: row.created_at.toISOString() })); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
