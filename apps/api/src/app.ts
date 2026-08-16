import express, { type RequestHandler } from "express";
import { z, ZodError } from "zod";

import { createAuthentication } from "./auth.js";
import {
  ConversationBusyError,
  ConversationNotFoundError,
  ConversationService,
  ModelInvocationError,
} from "./conversations/service.js";
import "./types.js";

export interface AppOptions {
  authentication?: RequestHandler;
  conversations: ConversationService;
}

const conversationIdSchema = z.string().uuid();
const messageBodySchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

function authenticatedUser(request: express.Request) {
  if (!request.flowpilotUser) {
    throw new Error("Authenticated route has no validated user context");
  }
  return request.flowpilotUser;
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
