import express, { type RequestHandler } from "express";
import { z, ZodError } from "zod";

import { createAuthentication } from "./auth.js";
import {
  ConversationBusyError,
  ConversationLimitError,
  ConversationNotFoundError,
  ConversationService,
  ModelInvocationError,
} from "./conversations/service.js";
import {
  MCP_ADMIN_SCOPE,
  McpRegistryError,
  McpRegistryService,
} from "./mcp/registry.js";
import type { ConversationPolicyService } from "./conversation-policy.js";
import type { ReportJobService } from "./reports/service.js";
import { ReportJobBusyError, ReportJobNotFoundError, ReportJobScheduleTooSoonError } from "./reports/service.js";
import { extractActionDocument } from "./reports/action-document.js";
import type { ReportActionPlanService } from "./reports/action-plan.js";
import { ActionPlanImmutableError, ActionPlanNotFoundError, type PostgresActionPlanStore } from "./reports/action-plan-store.js";
import type { ApprovedPlanExecutor } from "./reports/approved-plan-executor.js";
import { ActionPlanValidationError } from "./reports/approved-plan-executor.js";
import { exportReport, ReportNotReadyError, type ReportExportFormat } from "./reports/report-export.js";
import type { ReportSource } from "./reports/mcp-report-executor.js";
import { previewReconciliationUpload, reconciliationTemplate, runReconciliation } from "./reports/reconciliation.js";
import type { ChatTool } from "@flowpilot/agent-core";
import type { OperationLogService } from "./operation-log.js";
import type { BulkJobStore } from "./bulk-jobs.js";
import "./types.js";

export interface AppOptions {
  authentication?: RequestHandler;
  conversations: ConversationService;
  registry?: McpRegistryService;
  conversationPolicy?: ConversationPolicyService;
  reports?: ReportJobService;
  schedulerAuthentication?: RequestHandler;
  reportPlanning?: ReportActionPlanService;
  actionPlans?: PostgresActionPlanStore;
  approvedPlanExecutor?: ApprovedPlanExecutor;
  reportSources?: (user: ReturnType<typeof authenticatedUser>) => Promise<ReportSource[]>;
  operationLogs?: OperationLogService;
  reconciliationTools?: (user: ReturnType<typeof authenticatedUser>) => Promise<ChatTool[]>;
  contentTools?: (user: ReturnType<typeof authenticatedUser>) => Promise<ChatTool[]>;
  bulkJobs?: BulkJobStore;
}

const conversationIdSchema = z.string().uuid();
const messageBodySchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

const mcpServerInputSchema = z
  .object({
    policyPresetId: z.enum(["generic"]).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    endpointUrl: z.string().trim().min(1).max(2_048).optional(),
    externalPort: z.number().int().min(1).max(65_535).nullable().optional(),
    authProfileRef: z.string().trim().min(1).max(128).optional(),
    allowedToolNames: z.array(z.string()).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const serverIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62})$/u);
const conversationPolicySchema = z
  .object({
    maxConversationsPerUser: z.number().int().min(1).max(1_000),
    maxRetainedTurns: z.number().int().min(2).max(500),
  })
  .strict();
const reportJobInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    reportPrompt: z.string().trim().min(1).max(12_000),
    scheduledFor: z.string().datetime({ offset: true }),
    recurrenceRule: z.string().trim().min(1).max(256).nullable().optional(),
    sourceToolNames: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    actionPlanId: z.string().uuid().nullable().optional(),
  })
  .strict();
const reconciliationUploadSchema = z.object({ fileName: z.string().trim().min(1).max(255), contentBase64: z.string().min(1).max(1_400_000) }).strict();
const reconciliationRunSchema = z.object({ ids: z.array(z.string().trim().min(1).max(256)).min(1).max(60), sourceToolNames: z.array(z.string().trim().min(1).max(200)).min(1).max(3), fields: z.array(z.string().trim().min(1).max(80)).max(12).default([]) }).strict();
const contentFlowSchema = z.object({ integrationFlowId: z.string().trim().min(1).max(256), version: z.string().trim().min(1).max(256) }).strict();
const contentConfigurationSchema = contentFlowSchema.extend({ configuration: z.record(z.string().trim().min(1).max(256), z.object({ value: z.string().max(10_000), dataType: z.string().trim().min(1).max(100) }).strict()).refine((value) => Object.keys(value).length <= 100) }).strict();
const bulkJobSchema = z.object({ title: z.string().trim().min(1).max(120), artifacts: z.array(z.object({ id: z.string().min(1).max(256), version: z.string().min(1).max(256), name: z.string().min(1).max(256), packageName: z.string().min(1).max(256), action: z.enum(["deploy", "undeploy", "none"]), configure: z.boolean(), parameters: z.array(z.object({ key: z.string().min(1).max(256), value: z.string().max(10_000), dataType: z.string().min(1).max(100) }).strict()).max(100) }).passthrough()).min(1).max(100) }).strict();

function authenticatedUser(request: express.Request) {
  if (!request.flowpilotUser) {
    throw new Error("Authenticated route has no validated user context");
  }
  return request.flowpilotUser;
}

function requireScope(scope: string): RequestHandler {
  return (request, response, next) => {
    const user = request.flowpilotUser;
    if (!user) {
      response.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!user.scopes.includes(scope)) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

function httpErrorStatus(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

function safeModelFailureDetails(error: ModelInvocationError) {
  const cause = error.cause;
  const causeRecord =
    typeof cause === "object" && cause !== null
      ? (cause as Record<string, unknown>)
      : undefined;
  const status = causeRecord?.status;
  const code = causeRecord?.code;
  return {
    errorType: error.name,
    causeType: cause instanceof Error ? cause.name : "UnknownError",
    ...(typeof status === "number" && Number.isSafeInteger(status)
      ? { providerStatus: status }
      : {}),
    ...(typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(code)
      ? { providerCode: code }
      : {}),
  };
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "flowpilot-api" });
  });

  if (options.reports && options.schedulerAuthentication) {
    app.post("/internal/reports/dispatch", options.schedulerAuthentication, async (request, response, next) => {
      try {
        const body = z.object({ reportJobId: z.string().uuid() }).strict().parse(request.body);
        await options.reports!.runScheduled(body.reportJobId);
        response.status(204).end();
      } catch (error) { next(error); }
    });
  }

  app.use("/api", options.authentication ?? createAuthentication());

  app.get("/api/me", (request, response) => {
    const user = authenticatedUser(request);
    response.status(200).json({
      subject: user.subject,
      tenantId: user.tenantId,
      displayName: user.displayName,
      scopes: user.scopes,
    });
  });

  const adminRegistry = requireScope(MCP_ADMIN_SCOPE);
  const reportOperator = requireScope("ToolOperator");
  const invokeContent = async (user: ReturnType<typeof authenticatedUser>, name: string, arguments_: Record<string, unknown>) => {
    if (!options.contentTools) throw new Error("content_tools_unavailable");
    // The registry server ID is administrator-configurable. Match the approved
    // tool suffix instead of coupling this API route to one particular ID.
    const tool = (await options.contentTools(user)).find((candidate) => candidate.name.endsWith(`__${name}`));
    if (!tool) throw new Error("content_tool_unavailable");
    const result = await tool.invoke(arguments_);
    try {
      const parsed = JSON.parse(result) as unknown;
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) throw new Error("content_tool_failed");
      return parsed;
    } catch (error) { if (error instanceof Error && error.message === "content_tool_failed") throw error; throw new Error("content_tool_invalid_response"); }
  };
  app.get("/api/admin/conversation-policy", adminRegistry, async (_request, response, next) => {
    if (!options.conversationPolicy) {
      response.status(503).json({ error: "policy_unavailable" });
      return;
    }
    try {
      response.status(200).json(await options.conversationPolicy.get());
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/admin/conversation-policy", adminRegistry, async (request, response, next) => {
    if (!options.conversationPolicy) {
      response.status(503).json({ error: "policy_unavailable" });
      return;
    }
    try {
      response.status(200).json(
        await options.conversationPolicy.update(conversationPolicySchema.parse(request.body)),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get(
    "/api/admin/mcp-servers",
    adminRegistry,
    async (_request, response, next) => {
      if (!options.registry) {
        response.status(503).json({ error: "registry_unavailable" });
        return;
      }
      try {
        response.status(200).json({ servers: await options.registry.list() });
      } catch (error) {
        next(error);
      }
    },
  );

  app.put(
    "/api/admin/mcp-servers/:serverId",
    adminRegistry,
    async (request, response, next) => {
      if (!options.registry) {
        response.status(503).json({ error: "registry_unavailable" });
        return;
      }
      try {
        const serverId = serverIdSchema.parse(request.params.serverId);
        const input = mcpServerInputSchema.parse(request.body);
        const server = await options.registry.upsert(serverId, input);
        response.status(200).json(server);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/admin/mcp-servers/:serverId/ping",
    adminRegistry,
    async (request, response, next) => {
      if (!options.registry) {
        response.status(503).json({ error: "registry_unavailable" });
        return;
      }
      try {
        const serverId = serverIdSchema.parse(request.params.serverId);
        const server = await options.registry.ping(serverId);
        response.status(200).json(server);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api/admin/mcp-servers/:serverId/tools", adminRegistry, async (request, response, next) => {
    if (!options.registry) return response.status(503).json({ error: "registry_unavailable" });
    try {
      const serverId = serverIdSchema.parse(request.params.serverId);
      response.status(200).json({ tools: await options.registry.listTools(serverId) });
    } catch (error) { next(error); }
  });

  app.post("/api/conversations", async (request, response) => {
    const conversation = await options.conversations.create(
      authenticatedUser(request),
    );
    response.status(201).json(conversation);
  });

  app.post("/api/prompt-assist", async (request, response) => {
    const { content } = messageBodySchema.parse(request.body);
    const improved = await options.conversations.improvePrompt(content);
    response.status(200).json({ content: improved });
  });

  app.get("/api/reports/jobs", async (request, response, next) => {
    if (!options.reports) {
      response.status(503).json({ error: "reports_unavailable" });
      return;
    }
    try {
      response.status(200).json({ jobs: await options.reports.list(authenticatedUser(request)) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/operation-logs", async (request, response, next) => {
    if (!options.operationLogs) { response.status(503).json({ error: "logs_unavailable" }); return; }
    try { response.status(200).json({ logs: await options.operationLogs.list(authenticatedUser(request)) }); } catch (error) { next(error); }
  });

  app.get("/api/reports/sources", reportOperator, async (request, response, next) => {
    if (!options.reportSources) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { response.status(200).json({ sources: await options.reportSources(authenticatedUser(request)) }); } catch (error) { next(error); }
  });
  app.get("/api/reconciliations/sources", reportOperator, async (request, response, next) => {
    if (!options.reconciliationTools) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const tools = await options.reconciliationTools(authenticatedUser(request));
      response.status(200).json({ sources: tools.map((tool) => ({ name: tool.name, description: tool.description })) });
    } catch (error) { next(error); }
  });
  app.get("/api/bulk-actions/packages", reportOperator, async (request, response, next) => { try { response.json(await invokeContent(authenticatedUser(request), "list_integration_packages", { limit: 100 })); } catch (error) { next(error); } });
  app.get("/api/bulk-actions/jobs", reportOperator, async (request, response, next) => { if (!options.bulkJobs) return response.status(503).json({ error: "bulk_jobs_unavailable" }); try { response.json({ jobs: await options.bulkJobs.list(authenticatedUser(request)) }); } catch (error) { next(error); } });
  app.post("/api/bulk-actions/jobs", reportOperator, async (request, response, next) => { if (!options.bulkJobs) return response.status(503).json({ error: "bulk_jobs_unavailable" }); try { const input = bulkJobSchema.parse(request.body); response.status(201).json(await options.bulkJobs.create(authenticatedUser(request), input.title, input.artifacts)); } catch (error) { next(error); } });
  app.get("/api/bulk-actions/packages/:packageId/flows", reportOperator, async (request, response, next) => { try { response.json(await invokeContent(authenticatedUser(request), "list_package_integration_flows", { packageId: z.string().min(1).max(256).parse(request.params.packageId) })); } catch (error) { next(error); } });
  app.get("/api/bulk-actions/flows/:flowId/configurations", reportOperator, async (request, response, next) => { try { const version = z.string().min(1).max(256).parse(request.query.version); response.json(await invokeContent(authenticatedUser(request), "list_integration_flow_configurations", { integrationFlowId: z.string().min(1).max(256).parse(request.params.flowId), version })); } catch (error) { next(error); } });
  app.post("/api/bulk-actions/flows/:flowId/deploy", reportOperator, async (request, response, next) => { try { const input = contentFlowSchema.parse({ ...request.body, integrationFlowId: request.params.flowId }); response.json(await invokeContent(authenticatedUser(request), "deploy_integration_flow", input)); } catch (error) { next(error); } });
  app.delete("/api/bulk-actions/flows/:flowId", reportOperator, async (request, response, next) => { try { response.json(await invokeContent(authenticatedUser(request), "undeploy_integration_flow", { integrationFlowId: z.string().min(1).max(256).parse(request.params.flowId) })); } catch (error) { next(error); } });
  app.put("/api/bulk-actions/flows/:flowId/configurations", reportOperator, async (request, response, next) => { try { const input = contentConfigurationSchema.parse({ ...request.body, integrationFlowId: request.params.flowId }); response.json(await invokeContent(authenticatedUser(request), "update_integration_flow_configuration", input)); } catch (error) { next(error); } });
  app.post("/api/reconciliations/preview", reportOperator, async (request, response, next) => {
    try { const body = reconciliationUploadSchema.parse(request.body); response.status(200).json(previewReconciliationUpload(body.fileName, body.contentBase64)); } catch (error) { next(error); }
  });
  app.get("/api/reconciliations/template", reportOperator, (_request, response) => {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=flowpilot-reconciliation-template.xlsx");
    response.status(200).send(reconciliationTemplate());
  });
  app.post("/api/reconciliations/run", reportOperator, async (request, response, next) => {
    if (!options.reconciliationTools) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { const body = reconciliationRunSchema.parse(request.body); response.status(200).json(await runReconciliation({ ...body, user: authenticatedUser(request), resolveTools: options.reconciliationTools })); } catch (error) { next(error); }
  });

  app.post("/api/reports/jobs", reportOperator, async (request, response, next) => {
    if (!options.reports) {
      response.status(503).json({ error: "reports_unavailable" });
      return;
    }
    try {
      const input = reportJobInputSchema.parse(request.body);
      if (input.sourceToolNames?.length) {
        if (!options.reportSources) { response.status(503).json({ error: "reports_unavailable" }); return; }
        const available = new Set((await options.reportSources(authenticatedUser(request))).map((source) => source.name));
        if (input.sourceToolNames.some((name) => !available.has(name))) { response.status(400).json({ error: "invalid_request" }); return; }
      }
      if (input.actionPlanId) {
        if (!options.actionPlans || !await options.actionPlans.findApproved(authenticatedUser(request), input.actionPlanId)) {
          response.status(409).json({ error: "action_plan_not_approved" });
          return;
        }
      }
      response.status(201).json(
        await options.reports.create(authenticatedUser(request), {
          ...input,
          scheduledFor: new Date(input.scheduledFor),
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/reports/jobs/:jobId", reportOperator, async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const input = reportJobInputSchema.parse(request.body);
      if (input.sourceToolNames?.length) {
        if (!options.reportSources) { response.status(503).json({ error: "reports_unavailable" }); return; }
        const available = new Set((await options.reportSources(authenticatedUser(request))).map((source) => source.name));
        if (input.sourceToolNames.some((name) => !available.has(name))) { response.status(400).json({ error: "invalid_request" }); return; }
      }
      if (input.actionPlanId && (!options.actionPlans || !await options.actionPlans.findApproved(authenticatedUser(request), input.actionPlanId))) { response.status(409).json({ error: "action_plan_not_approved" }); return; }
      response.status(200).json(await options.reports.update(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId), { ...input, scheduledFor: new Date(input.scheduledFor) }));
    } catch (error) { next(error); }
  });

  app.get("/api/reports/jobs/:jobId/export", async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const format = z.enum(["html", "markdown", "xlsx"]).parse(request.query.format) as ReportExportFormat;
      const output = exportReport(await options.reports.get(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId)), format);
      response.setHeader("Content-Type", output.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${output.fileName}"`);
      response.status(200).send(output.body);
    } catch (error) { next(error); }
  });
  app.get("/api/reports/jobs/:jobId/runs", async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { response.status(200).json({ runs: await options.reports.listRuns(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId)) }); } catch (error) { next(error); }
  });
  app.get("/api/reports/jobs/:jobId/runs/:runId/roadblock", async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { const run = (await options.reports.listRuns(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId))).find((item) => item.id === conversationIdSchema.parse(request.params.runId)); if (!run || !run.errorLog) { response.status(404).json({ error: "not_found" }); return; } response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.setHeader("Content-Disposition", `attachment; filename="report-roadblock-${run.id}.txt"`); response.send(run.errorLog); } catch (error) { next(error); }
  });
  app.post("/api/reports/jobs/:jobId/schedule-active", reportOperator, async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { const body = z.object({ active: z.boolean() }).strict().parse(request.body); response.status(200).json(await options.reports.setScheduleActive(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId), body.active)); } catch (error) { next(error); }
  });
  app.delete("/api/reports/jobs/:jobId", reportOperator, async (request, response, next) => {
    if (!options.reports) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { await options.reports.remove(authenticatedUser(request), conversationIdSchema.parse(request.params.jobId)); response.status(204).end(); } catch (error) { next(error); }
  });

  app.post("/api/reports/action-plan-preview", reportOperator, async (request, response, next) => {
    if (!options.reportPlanning || !options.actionPlans) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const body = z.object({ fileName: z.string().trim().min(1).max(255), contentBase64: z.string().min(1).max(200_000) }).strict().parse(request.body);
      const source = extractActionDocument(body.fileName, body.contentBase64);
      const preview = await options.reportPlanning.createPreview(source);
      response.status(201).json(await options.actionPlans.create(authenticatedUser(request), source, preview.plan, preview.steps));
    } catch (error) { next(error); }
  });

  app.put("/api/reports/action-plans/:planId", reportOperator, async (request, response, next) => {
    if (!options.actionPlans) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { const body = z.object({ plan: z.string().trim().min(1).max(60_000) }).strict().parse(request.body); response.status(200).json(await options.actionPlans.update(authenticatedUser(request), conversationIdSchema.parse(request.params.planId), body.plan)); } catch (error) { next(error); }
  });
  app.post("/api/reports/action-plans/:planId/approve", reportOperator, async (request, response, next) => {
    if (!options.actionPlans || !options.approvedPlanExecutor) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const user = authenticatedUser(request);
      const body = z.object({ revision: z.number().int().min(1) }).strict().parse(request.body);
      const planId = conversationIdSchema.parse(request.params.planId);
      const plan = await options.actionPlans.findDraft(user, planId);
      if (!plan) { response.status(409).json({ error: "action_plan_not_draft" }); return; }
      await options.approvedPlanExecutor.validate(user, plan.steps);
      response.status(200).json(await options.actionPlans.approve(user, planId, body.revision));
    } catch (error) { next(error); }
  });
  app.post("/api/reports/action-plans/:planId/regenerate", reportOperator, async (request, response, next) => {
    if (!options.actionPlans || !options.reportPlanning) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { const plan = await options.actionPlans.findDraft(authenticatedUser(request), conversationIdSchema.parse(request.params.planId)); if (!plan) { response.status(409).json({ error: "action_plan_not_draft" }); return; } response.status(200).json(await options.actionPlans.updateSteps(authenticatedUser(request), plan.id, await options.reportPlanning.regenerate(plan.plan))); } catch (error) { next(error); }
  });
  app.post("/api/reports/action-plans/:planId/execute", reportOperator, async (request, response, next) => {
    if (!options.actionPlans || !options.approvedPlanExecutor) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try {
      const plan = await options.actionPlans.findApproved(authenticatedUser(request), conversationIdSchema.parse(request.params.planId));
      if (!plan) { response.status(409).json({ error: "action_plan_not_approved" }); return; }
      const outcome = await options.approvedPlanExecutor.execute(authenticatedUser(request), plan);
      await options.actionPlans.recordExecution(authenticatedUser(request), plan.id, outcome);
      response.status(200).json(outcome);
    } catch (error) { next(error); }
  });

  app.post("/api/reports/jobs/:jobId/run", reportOperator, async (request, response, next) => {
    if (!options.reports) {
      response.status(503).json({ error: "reports_unavailable" });
      return;
    }
    try {
      const jobId = conversationIdSchema.parse(request.params.jobId);
      response.status(200).json(await options.reports.runNow(authenticatedUser(request), jobId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/conversations", async (request, response) => {
    const conversations = await options.conversations.list(
      authenticatedUser(request),
    );
    response.status(200).json({ conversations });
  });

  app.get("/api/conversations/:conversationId", async (request, response) => {
    const conversationId = conversationIdSchema.parse(
      request.params.conversationId,
    );
    const conversation = await options.conversations.get(
      authenticatedUser(request),
      conversationId,
    );
    response.status(200).json(conversation);
  });

  app.delete("/api/conversations/:conversationId", async (request, response) => {
    const conversationId = conversationIdSchema.parse(
      request.params.conversationId,
    );
    await options.conversations.delete(
      authenticatedUser(request),
      conversationId,
    );
    response.status(204).end();
  });

  app.post(
    "/api/conversations/:conversationId/messages",
    async (request, response) => {
      const conversationId = conversationIdSchema.parse(
        request.params.conversationId,
      );
      const { content } = messageBodySchema.parse(request.body);
      const conversation = await options.conversations.sendMessage(
        authenticatedUser(request),
        conversationId,
        content,
      );
      response.status(200).json(conversation);
    },
  );

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof ZodError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
      const status = httpErrorStatus(error);
      if (status === 400) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
      if (status === 413) {
        response.status(413).json({ error: "payload_too_large" });
        return;
      }
      if (error instanceof ConversationNotFoundError) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      if (error instanceof ConversationBusyError) {
        response.status(409).json({ error: "conversation_busy" });
        return;
      }
      if (error instanceof ConversationLimitError) {
        response.status(409).json({ error: "conversation_limit_reached" });
        return;
      }
      if (error instanceof ReportJobNotFoundError) {
        response.status(404).json({ error: "not_found" });
        return;
      }
    if (error instanceof ReportJobBusyError) {
      response.status(409).json({ error: "report_job_busy" });
      return;
    }
    if (error instanceof ReportJobScheduleTooSoonError) {
      response.status(400).json({ error: "schedule_time_too_soon" });
      return;
    }
      if (error instanceof ReportNotReadyError) { response.status(409).json({ error: "report_not_ready" }); return; }
      if (error instanceof ActionPlanNotFoundError) { response.status(404).json({ error: "not_found" }); return; }
      if (error instanceof ActionPlanImmutableError) { response.status(409).json({ error: "action_plan_immutable" }); return; }
      if (error instanceof ActionPlanValidationError) { response.status(422).json({ error: "action_plan_invalid" }); return; }
      if (error instanceof ModelInvocationError) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "FlowPilot model invocation failed",
            ...safeModelFailureDetails(error),
          }),
        );
        response.status(502).json({ error: "model_unavailable" });
        return;
      }
      if (error instanceof McpRegistryError) {
        const status =
          error.code === "not_found"
            ? 404
            : error.code === "server_unhealthy"
              ? 409
              : error.code === "registry_unavailable"
                ? 503
                : 400;
        response.status(status).json({ error: error.code });
        return;
      }

      console.error(
        JSON.stringify({
          level: "error",
          message: "FlowPilot API request failed unexpectedly",
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      response.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
