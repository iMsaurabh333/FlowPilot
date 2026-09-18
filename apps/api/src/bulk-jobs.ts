import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { quoteIdentifier } from "./db/migrations.js";
import type { AuthenticatedUser } from "./types.js";

export interface BulkJob { id: string; title: string; artifacts: unknown[]; createdAt: Date; updatedAt: Date; }
type Row = { id: string; title: string; artifacts: unknown[]; created_at: Date; updated_at: Date };
export class BulkJobStore {
  #pool: Pool; #table: string;
  constructor(pool: Pool, schema = "flowpilot_app") { this.#pool = pool; this.#table = `${quoteIdentifier(schema)}.bulk_action_jobs`; }
  async #identity<T>(user: AuthenticatedUser, operation: (client: PoolClient) => Promise<T>) { const client = await this.#pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('flowpilot.tenant_id',$1,true),set_config('flowpilot.subject_id',$2,true)", [user.tenantId, user.subject]); const value = await operation(client); await client.query("COMMIT"); return value; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  #map(row: Row): BulkJob { return { id: row.id, title: row.title, artifacts: row.artifacts, createdAt: row.created_at, updatedAt: row.updated_at }; }
  list(user: AuthenticatedUser) { return this.#identity(user, async (client) => (await client.query<Row>(`SELECT id,title,artifacts,created_at,updated_at FROM ${this.#table} ORDER BY updated_at DESC`)).rows.map((row) => this.#map(row))); }
  create(user: AuthenticatedUser, title: string, artifacts: unknown[]) { return this.#identity(user, async (client) => this.#map((await client.query<Row>(`INSERT INTO ${this.#table}(id,tenant_id,subject_id,title,artifacts) VALUES($1,$2,$3,$4,$5) RETURNING id,title,artifacts,created_at,updated_at`, [randomUUID(), user.tenantId, user.subject, title, JSON.stringify(artifacts)])).rows[0])); }
}
