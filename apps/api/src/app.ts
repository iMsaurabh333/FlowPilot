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
import { ReportJobBusyError, ReportJobNotFoundError } from "./reports/service.js";
import { extractActionDocument } from "./reports/action-document.js";
import type { ReportActionPlanService } from "./reports/action-plan.js";
import { ActionPlanImmutableError, ActionPlanNotFoundError, type PostgresActionPlanStore } from "./reports/action-plan-store.js";
import type { ApprovedPlanExecutor } from "./reports/approved-plan-executor.js";
import { ActionPlanValidationError } from "./reports/approved-plan-executor.js";
import { exportReport, ReportNotReadyError, type ReportExportFormat } from "./reports/report-export.js";
import type { ReportSource } from "./reports/mcp-report-executor.js";
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

  app.get("/api/reports/sources", reportOperator, async (request, response, next) => {
    if (!options.reportSources) { response.status(503).json({ error: "reports_unavailable" }); return; }
    try { response.status(200).json({ sources: await options.reportSources(authenticatedUser(request)) }); } catch (error) { next(error); }
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
