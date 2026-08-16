import { createChatAgent } from "@flowpilot/agent-core";
import {
  createChatModel,
  loadEnvironmentCredentials,
  loadModelConfig,
} from "@flowpilot/model-adapters";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { createApp } from "./app.js";
import { PostgresConversationRepository } from "./conversations/postgres-repository.js";
import { ConversationService } from "./conversations/service.js";
import { runMigrations } from "./db/migrations.js";
import { createPostgresPool, resolveDatabaseConfig } from "./db/postgres.js";

export async function createRuntime(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const databaseConfig = resolveDatabaseConfig(environment);
  const pool = createPostgresPool(databaseConfig, environment);

  try {
    await runMigrations(pool);

    const checkpointer = new PostgresSaver(pool, undefined, {
      schema: "flowpilot_graph",
    });
    await checkpointer.setup();

    const modelConfig = loadModelConfig(environment);
    const model = createChatModel(
      modelConfig,
      loadEnvironmentCredentials(environment),
    );
    const agent = createChatAgent({
      checkpointer,
      maxContextMessages: 12,
      model,
    });
    const repository = new PostgresConversationRepository(pool);
    const conversations = new ConversationService(repository, agent);

    return {
      app: createApp({ conversations }),
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    await Promise.allSettled([pool.end()]);
    throw error;
  }
}
