import type { Pool, PoolClient } from "pg";

import { quoteIdentifier } from "./db/migrations.js";

export const CONVERSATION_POLICY_DEFAULTS = {
  maxConversationsPerUser: 50,
  maxRetainedTurns: 40,
} as const;

export interface ConversationPolicy {
  maxConversationsPerUser: number;
  maxRetainedTurns: number;
}

export interface ConversationPolicyService {
  get(): Promise<ConversationPolicy>;
  update(input: ConversationPolicy): Promise<ConversationPolicy>;
}

interface PolicyRow {
  max_conversations_per_user: number;
  max_retained_turns: number;
}

function asPolicy(row: PolicyRow): ConversationPolicy {
  return {
    maxConversationsPerUser: row.max_conversations_per_user,
    maxRetainedTurns: row.max_retained_turns,
  };
}

export class PostgresConversationPolicyService implements ConversationPolicyService {
  readonly #pool: Pool;
  readonly #table: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    this.#table = `${quoteIdentifier(schemaName)}.conversation_policy`;
  }

  async #asAdmin<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('flowpilot.is_admin', 'true', true)");
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

  async get() {
    return this.#asAdmin(async (client) => {
      const result = await client.query<PolicyRow>(
        `SELECT max_conversations_per_user, max_retained_turns FROM ${this.#table} WHERE singleton = true`,
      );
      return result.rows[0]
        ? asPolicy(result.rows[0])
        : { ...CONVERSATION_POLICY_DEFAULTS };
    });
  }

  async update(input: ConversationPolicy) {
    return this.#asAdmin(async (client) => {
      const result = await client.query<PolicyRow>(
        `UPDATE ${this.#table}
            SET max_conversations_per_user = $1,
                max_retained_turns = $2,
                updated_at = now()
          WHERE singleton = true
          RETURNING max_conversations_per_user, max_retained_turns`,
        [input.maxConversationsPerUser, input.maxRetainedTurns],
      );
      return asPolicy(result.rows[0]);
    });
  }
}
