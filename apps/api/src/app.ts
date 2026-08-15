import express, { type RequestHandler } from "express";

import { createAuthentication } from "./auth.js";
import "./types.js";

export function createApp(
  authentication: RequestHandler = createAuthentication(),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "flowpilot-api" });
  });

  app.use("/api", authentication);

  app.get("/api/me", (request, response) => {
    const user = request.flowpilotUser;
    if (!user) {
      response.status(401).json({ error: "unauthenticated" });
      return;
    }

    response.status(200).json({
      subject: user.subject,
      tenantId: user.tenantId,
      displayName: user.displayName,
      scopes: user.scopes,
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  return app;
}
