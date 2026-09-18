import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedUser } from "./types.js";
import { quoteIdentifier } from "./db/migrations.js";

export interface BulkJob { id: string; title: string; artifacts: unknown[]; scheduledFor: Date | null; scheduleActive: boolean; schedulerJobId: string | null; createdAt: Date; updatedAt: Date; }
export interface ScheduledBulkJob extends BulkJob { user: AuthenticatedUser; }
type Row = { id: string; tenant_id: string; subject_id: string; title: string; artifacts: unknown[]; scheduled_for: Date | null; schedule_active: boolean; scheduler_job_id: string | null; created_at: Date; updated_at: Date };
export class BulkJobStore {
  #pool: Pool; #table: string;
  constructor(pool: Pool, schema = "flowpilot_app") { this.#pool = pool; this.#table = `${quoteIdentifier(schema)}.bulk_action_jobs`; }
  async #identity<T>(user: AuthenticatedUser, operation: (client: PoolClient) => Promise<T>) { const client = await this.#pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('flowpilot.tenant_id',$1,true),set_config('flowpilot.subject_id',$2,true)", [user.tenantId, user.subject]); const value = await operation(client); await client.query("COMMIT"); return value; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  #map(row: Row): BulkJob { return { id: row.id, title: row.title, artifacts: row.artifacts, scheduledFor: row.scheduled_for, scheduleActive: row.schedule_active, schedulerJobId: row.scheduler_job_id, createdAt: row.created_at, updatedAt: row.updated_at }; }
  list(user: AuthenticatedUser) { return this.#identity(user, async (client) => (await client.query<Row>(`SELECT * FROM ${this.#table} ORDER BY updated_at DESC`)).rows.map((row) => this.#map(row))); }
  create(user: AuthenticatedUser, title: string, artifacts: unknown[], scheduledFor: Date | null) { return this.#identity(user, async (client) => this.#map((await client.query<Row>(`INSERT INTO ${this.#table}(id,tenant_id,subject_id,title,artifacts,scheduled_for) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(), user.tenantId, user.subject, title, JSON.stringify(artifacts), scheduledFor])).rows[0])); }
  setSchedulerJobId(user: AuthenticatedUser, jobId: string, schedulerJobId: string | null) { return this.#identity(user, async (client) => { await client.query(`UPDATE ${this.#table} SET scheduler_job_id=$2,updated_at=now() WHERE id=$1`, [jobId, schedulerJobId]); }); }
  async findOwned(user: AuthenticatedUser, jobId: string) { return this.#identity(user, async (client) => { const row = (await client.query<Row>(`SELECT * FROM ${this.#table} WHERE id=$1`, [jobId])).rows[0]; return row ? this.#map(row) : undefined; }); }
  async findScheduled(jobId: string): Promise<ScheduledBulkJob | undefined> { const client = await this.#pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('flowpilot.scheduler','true',true)"); const row = (await client.query<Row>(`SELECT * FROM ${this.#table} WHERE id=$1 AND schedule_active=true`, [jobId])).rows[0]; await client.query("COMMIT"); return row ? { ...this.#map(row), user: { tenantId: row.tenant_id, subject: row.subject_id, scopes: ["ToolOperator"] } } : undefined; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
