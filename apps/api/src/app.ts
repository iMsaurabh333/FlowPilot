import express, { type RequestHandler } from "express";
import { z, ZodError } from "zod";

import { createAuthentication } from "./auth.js";
import {
  ConversationBusyError,
  ConversationNotFoundError,
  ConversationService,
  ModelInvocationError,
} from "./conversations/service.js";
import {
  MCP_ADMIN_SCOPE,
  McpRegistryError,
  McpRegistryService,
} from "./mcp/registry.js";
import "./types.js";

export interface AppOptions {
  authentication?: RequestHandler;
  conversations: ConversationService;
  registry?: McpRegistryService;
}

const conversationIdSchema = z.string().uuid();
const messageBodySchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

const mcpServerInputSchema = z
  .object({
    profileId: z
      .enum([
        "cloud-integration-monitoring",
        "cloud-integration-content",
        "event-mesh",
      ])
      .optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    endpointUrl: z.string().trim().min(1).max(2_048).optional(),
    mcpPath: z.string().trim().min(1).max(256).optional(),
    externalPort: z.number().int().min(1).max(65_535).nullable().optional(),
    authProfileRef: z.string().trim().min(1).max(128).optional(),
    allowedToolNames: z.array(z.string()).max(100).optional(),
    requiredScopes: z.array(z.string()).max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const serverIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62})$/u);

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

export function createApp(options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "flowpilot-api" });
  });

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

  app.post("/api/conversations", async (request, response) => {
    const conversation = await options.conversations.create(
      authenticatedUser(request),
    );
    response.status(201).json(conversation);
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
      if (error instanceof ModelInvocationError) {
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
