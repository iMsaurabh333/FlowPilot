import { createChatAgent } from "@flowpilot/agent-core";
import { createChatModel, loadModelConfig } from "@flowpilot/model-adapters";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { createApp } from "./app.js";
import { PostgresConversationPolicyService } from "./conversation-policy.js";
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
import { McpToolResolver } from "./mcp/tool-resolver.js";
import { createConfiguredMcpAuthProfileResolver } from "./mcp/technical-auth.js";
import { PostgresReportJobRepository } from "./reports/postgres-repository.js";
import { ReportJobService } from "./reports/service.js";
import { resolveJobSchedulerBinding, SapJobSchedulerClient } from "./reports/job-scheduler.js";
import { createSchedulerAuthentication } from "./auth.js";
import { McpReportExecutor, reconciliationLookupTools, reportOnlyTools } from "./reports/mcp-report-executor.js";
import { ReportActionPlanService } from "./reports/action-plan.js";
import { PostgresActionPlanStore } from "./reports/action-plan-store.js";
import { ApprovedPlanExecutor } from "./reports/approved-plan-executor.js";
import { ReportWorkflowExecutor } from "./reports/report-workflow-executor.js";
import { OperationLogService } from "./operation-log.js";
import { BulkJobStore } from "./bulk-jobs.js";

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
    const chatAgent = createChatAgent({
      checkpointer,
      maxContextMessages: 12,
      model,
      compactResponses: true,
    });
    const repository = new PostgresConversationRepository(pool);
    const conversationPolicy = new PostgresConversationPolicyService(pool);
    const mcpRepository = new PostgresMcpRegistryRepository(pool);
    const operationLogs = new OperationLogService(pool);
    const mcpAuth = createConfiguredMcpAuthProfileResolver(environment);
    const mcpTools = new McpToolResolver({
      repository: mcpRepository,
      authResolver: mcpAuth,
      operationLogs,
    });
    const conversations = new ConversationService(
      repository,
      chatAgent,
      mcpTools,
      conversationPolicy,
      operationLogs,
    );
    const registry = new McpRegistryService(
      mcpRepository,
      createConfiguredMcpServerProbe(environment, mcpAuth),
    );
    const schedulerBinding = resolveJobSchedulerBinding(environment);
    const schedulerActionUrl = environment.REPORT_SCHEDULER_ACTION_URL;
    const actionPlans = new PostgresActionPlanStore(pool);
    const approvedPlanExecutor = new ApprovedPlanExecutor((user) => mcpTools.resolve(user));
    const reports = new ReportJobService(
      new PostgresReportJobRepository(pool),
      new ReportWorkflowExecutor(new McpReportExecutor({
        agent,
        resolveTools: (user, jobId) => mcpTools.resolve(user, { surface: "report", reportJobId: jobId }),
        operationLogs,
      }), actionPlans, approvedPlanExecutor),
      schedulerBinding && schedulerActionUrl ? new SapJobSchedulerClient(schedulerBinding) : undefined,
      schedulerActionUrl,
    );

    return {
      app: createApp({ conversations, registry, conversationPolicy, reports, operationLogs, bulkJobs: new BulkJobStore(pool), bulkScheduler: schedulerBinding ? new SapJobSchedulerClient(schedulerBinding) : undefined, bulkSchedulerActionUrl: environment.REPORT_SCHEDULER_ACTION_URL?.replace(/\/internal\/reports\/dispatch$/u, "/internal/bulk-actions/dispatch"), reportSources: async (user) => reportOnlyTools(await mcpTools.resolve(user)).map((tool) => ({ name: tool.name, description: tool.description })), reconciliationTools: async (user) => reconciliationLookupTools(await mcpTools.resolve(user, { surface: "report" })), contentTools: async (user) => mcpTools.resolve(user, { surface: "report" }), reportPlanning: new ReportActionPlanService(agent, () => mcpTools.resolve({ tenantId: "", subject: "", scopes: ["ChatUser", "ToolOperator"] })), actionPlans, approvedPlanExecutor, ...(schedulerBinding ? { schedulerAuthentication: createSchedulerAuthentication() } : {}) }),
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    await Promise.allSettled([pool.end()]);
    throw error;
  }
}
