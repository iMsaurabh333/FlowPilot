import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { quoteIdentifier } from "../db/migrations.js";
import type { AuthenticatedUser } from "../types.js";
import type {
  ConversationRecord,
  ConversationRepository,
  RunAcquisition,
} from "./types.js";

interface ConversationRow {
  id: string;
  thread_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresConversationRepository implements ConversationRepository {
  readonly #pool: Pool;
  readonly #table: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    this.#table = `${quoteIdentifier(schemaName)}.conversations`;
  }

  async #withIdentity<T>(
    user: AuthenticatedUser,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT
          set_config('flowpilot.tenant_id', $1, true),
          set_config('flowpilot.subject_id', $2, true)`,
        [user.tenantId, user.subject],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async create(user: AuthenticatedUser) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ConversationRow>(
        `INSERT INTO ${this.#table}
          (id, thread_id, tenant_id, subject_id, title)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, thread_id, title, created_at, updated_at`,
        [
          randomUUID(),
          randomUUID(),
          user.tenantId,
          user.subject,
          "New conversation",
        ],
      );
      return toRecord(result.rows[0]);
    });
  }

  async list(user: AuthenticatedUser) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ConversationRow>(
        `SELECT id, thread_id, title, created_at, updated_at
           FROM ${this.#table}
          ORDER BY updated_at DESC, id DESC`,
      );
      return result.rows.map(toRecord);
    });
  }

  async findOwned(user: AuthenticatedUser, conversationId: string) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ConversationRow>(
        `SELECT id, thread_id, title, created_at, updated_at
           FROM ${this.#table}
          WHERE id = $1`,
        [conversationId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }

  async acquireRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ): Promise<RunAcquisition> {
    return this.#withIdentity(user, async (client) => {
      const acquired = await client.query<ConversationRow>(
        `UPDATE ${this.#table}
            SET active_run_id = $2,
                run_started_at = now()
          WHERE id = $1
            AND (
              active_run_id IS NULL OR
              run_started_at < now() - interval '2 minutes'
            )
        RETURNING id, thread_id, title, created_at, updated_at`,
        [conversationId, runId],
      );
      if (acquired.rows[0]) {
        return { status: "acquired", conversation: toRecord(acquired.rows[0]) };
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM ${this.#table} WHERE id = $1`,
        [conversationId],
      );
      return existing.rowCount ? { status: "busy" } : { status: "not_found" };
    });
  }

  async completeRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
    title: string,
  ) {
    await this.#withIdentity(user, async (client) => {
      await client.query(
        `UPDATE ${this.#table}
            SET title = CASE WHEN title = 'New conversation' THEN $3 ELSE title END,
                updated_at = now(),
                active_run_id = NULL,
                run_started_at = NULL
          WHERE id = $1 AND active_run_id = $2`,
        [conversationId, runId, title],
      );
    });
  }

  async releaseRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ) {
    await this.#withIdentity(user, async (client) => {
      await client.query(
        `UPDATE ${this.#table}
            SET active_run_id = NULL,
                run_started_at = NULL
          WHERE id = $1 AND active_run_id = $2`,
        [conversationId, runId],
      );
    });
  }
}
