import { randomUUID } from "node:crypto";

import { createChatAgent } from "@flowpilot/agent-core";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresConversationRepository } from "../src/conversations/postgres-repository.js";
import { ConversationService } from "../src/conversations/service.js";
import { quoteIdentifier, runMigrations } from "../src/db/migrations.js";
import {
  createPostgresPool,
  resolveDatabaseConfig,
  type DatabaseConfig,
} from "../src/db/postgres.js";
import type { AuthenticatedUser } from "../src/types.js";

const databaseConfig: DatabaseConfig | undefined = process.env.TEST_DATABASE_URL
  ? { connectionString: process.env.TEST_DATABASE_URL }
  : process.env.VCAP_SERVICES
    ? resolveDatabaseConfig(process.env)
    : undefined;
const testRunId = `${process.pid}_${Date.now()}`;
const appSchema = `flowpilot_test_${testRunId}`;
const graphSchema = `flowpilot_graph_test_${testRunId}`;

const userA: AuthenticatedUser = {
  subject: `user-a-${randomUUID()}`,
  tenantId: "integration-tenant",
  scopes: ["ChatUser"],
};
const userB: AuthenticatedUser = {
  subject: `user-b-${randomUUID()}`,
  tenantId: "integration-tenant",
  scopes: ["ChatUser"],
};

describe.skipIf(!databaseConfig)("PostgreSQL conversation isolation", () => {
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let checkpointer: PostgresSaver | undefined;
  let databaseReachable = false;
  let repository: PostgresConversationRepository;

  beforeAll(async () => {
    pool = createPostgresPool(databaseConfig!, {
      DATABASE_POOL_MAX: "3",
    });
    await pool.query("SELECT 1");
    databaseReachable = true;
    await runMigrations(pool, appSchema);
    checkpointer = new PostgresSaver(pool, undefined, {
      schema: graphSchema,
    });
    await checkpointer.setup();
    repository = new PostgresConversationRepository(pool, appSchema);
  });

  afterAll(async () => {
    if (!databaseConfig || !pool) {
      return;
    }
    try {
      if (databaseReachable) {
        await pool.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(appSchema)} CASCADE`,
        );
        await pool.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(graphSchema)} CASCADE`,
        );
      }
    } finally {
      await pool.end();
    }
  });

  it("enforces row ownership and preserves LangGraph state", async () => {
    const created = await repository.create(userA);

    expect(await repository.list(userB)).toEqual([]);
    expect(await repository.findOwned(userB, created.id)).toBeUndefined();
    expect(
      await repository.acquireRun(userB, created.id, randomUUID()),
    ).toEqual({ status: "not_found" });

    const rowsWithoutIdentity = await pool.query<{ count: string }>(
      `SELECT count(*) FROM ${quoteIdentifier(appSchema)}.conversations`,
    );
    expect(rowsWithoutIdentity.rows[0].count).toBe("0");

    const agent = createChatAgent({
      checkpointer: checkpointer!,
      model: new FakeListChatModel({ responses: ["Persisted answer"] }),
    });
    const service = new ConversationService(repository, agent);
    const response = await service.sendMessage(
      userA,
      created.id,
      "Persist this troubleshooting question",
    );
    expect(response.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Persist this troubleshooting question",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Persisted answer",
      }),
    ]);

    await expect(service.get(userB, created.id)).rejects.toMatchObject({
      name: "ConversationNotFoundError",
    });
    expect((await service.get(userA, created.id)).messages).toEqual(
      response.messages,
    );
  });
});
