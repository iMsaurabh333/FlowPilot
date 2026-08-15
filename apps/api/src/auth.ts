import type { RequestHandler } from "express";
import xsenv from "@sap/xsenv";
import { createSecurityContext, errors, XsuaaService } from "@sap/xssec";

import type { AuthenticatedUser } from "./types.js";

function parseScopes(value: string | undefined): string[] {
  return (value ?? "ChatUser")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function localUser(): AuthenticatedUser {
  return {
    subject: process.env.MOCK_USER_ID ?? "local-developer",
    tenantId: "local",
    displayName: process.env.MOCK_USER_NAME ?? "Local Developer",
    scopes: parseScopes(process.env.MOCK_USER_SCOPES),
  };
}

export function createMockAuthentication(): RequestHandler {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Mock authentication cannot run in production");
  }

  const user = localUser();
  return (request, _response, next) => {
    request.flowpilotUser = user;
    next();
  };
}

function displayName(
  givenName: string | null | undefined,
  familyName: string | null | undefined,
) {
  const value = [givenName, familyName].filter(Boolean).join(" ").trim();
  return value || undefined;
}

export function createXsuaaAuthentication(): RequestHandler {
  const bindings = xsenv.getServices({ xsuaa: { tag: "xsuaa" } });
  const credentials = bindings.xsuaa as ConstructorParameters<
    typeof XsuaaService
  >[0];
  const service = new XsuaaService(credentials);

  return async (request, response, next) => {
    try {
      const context = await createSecurityContext(service, { req: request });

      if (!context.checkLocalScope("ChatUser")) {
        response.status(403).json({ error: "forbidden" });
        return;
      }

      const token = context.token;
      request.flowpilotUser = {
        subject: token.getSubject(),
        tenantId: token.zid,
        displayName:
          displayName(token.givenName, token.familyName) ??
          context.getUserName(),
        scopes: ["ChatUser", "ToolOperator", "ChatAdmin"].filter((scope) =>
          context.checkLocalScope(scope),
        ),
      };

      next();
    } catch (error: unknown) {
      if (error instanceof errors.ValidationError) {
        response.status(401).json({ error: "unauthenticated" });
        return;
      }

      console.error(
        JSON.stringify({
          level: "error",
          message: "XSUAA authentication failed unexpectedly",
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      response.status(500).json({ error: "authentication_failure" });
    }
  };
}

export function createAuthentication(): RequestHandler {
  const mode = process.env.AUTH_MODE ?? "xsuaa";
  if (mode === "mock") {
    return createMockAuthentication();
  }
  if (mode === "xsuaa") {
    return createXsuaaAuthentication();
  }

  throw new Error(`Unsupported AUTH_MODE: ${mode}`);
}
