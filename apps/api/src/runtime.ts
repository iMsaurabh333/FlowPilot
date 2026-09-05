import { createChatAgent } from "@flowpilot/agent-core";
import { createChatModel, loadModelConfig } from "@flowpilot/model-adapters";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { createApp } from "./app.js";
import { PostgresConversationRepository } from "./conversations/postgres-repository.js";
import { ConversationService } from "./conversations/service.js";
import {
  createLazyCredentialChatModel,
  createProviderCredentialResolver,
  modelCredentialsFor,
} from "./credentials/credential-store.js";
import { runMigrations } from "./db/migrations.js";
import { createPostgresPool, resolveDatabaseConfig } from "./db/postgres.js";
import { createConfiguredMcpServerProbe } from "./mcp/probe.js";
import {
  McpRegistryService,
  PostgresMcpRegistryRepository,
} from "./mcp/registry.js";

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
    const credentials = createProviderCredentialResolver(environment);
    const model = createLazyCredentialChatModel(async () =>
      createChatModel(
        modelConfig,
        modelCredentialsFor(
          modelConfig.provider,
          await credentials.resolve(modelConfig.provider),
        ),
      ),
    );
    const agent = createChatAgent({
      checkpointer,
      maxContextMessages: 12,
      model,
    });
    const repository = new PostgresConversationRepository(pool);
    const conversations = new ConversationService(repository, agent);
    const registry = new McpRegistryService(
      new PostgresMcpRegistryRepository(pool),
      createConfiguredMcpServerProbe(environment),
    );

    return {
      app: createApp({ conversations, registry }),
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    await Promise.allSettled([pool.end()]);
    throw error;
  }
}
