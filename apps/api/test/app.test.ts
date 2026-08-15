import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const authenticated: RequestHandler = (incoming, _response, next) => {
  incoming.flowpilotUser = {
    subject: "user-123",
    tenantId: "tenant-456",
    displayName: "Test User",
    scopes: ["ChatUser"],
  };
  next();
};

describe("FlowPilot API", () => {
  it("exposes an unauthenticated health endpoint", async () => {
    const response = await request(createApp(authenticated)).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "flowpilot-api" });
  });

  it("returns only the authenticated user's safe identity fields", async () => {
    const response = await request(createApp(authenticated)).get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      subject: "user-123",
      tenantId: "tenant-456",
      displayName: "Test User",
      scopes: ["ChatUser"],
    });
  });
});
