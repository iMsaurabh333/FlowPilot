import type { ErrorRequestHandler, Express } from "express";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/server";

import {
  MCP_INVOKE_SCOPE,
  MCP_PATH,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./constants.js";
import { createCloudIntegrationMcpServer } from "./mcp.js";
import type { MessageProcessingLogsConnectorLike } from "./mpl.js";

export interface McpAppOptions {
  allowedHosts?: string[];
  allowedOrigins?: string[];
  authorizationServerUrl: URL;
  connector?: MessageProcessingLogsConnectorLike;
  host?: string;
  reportError?: (error: Error) => void;
  resourceServerUrl: URL;
  verifier: OAuthTokenVerifier;
}

export interface McpAppRuntime {
  app: Express;
  close(): Promise<void>;
}

function defaultErrorReporter(error: Error): void {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Cloud Integration MCP request failed",
      errorType: error.name,
    }),
  );
}

function safeRequestErrorHandler(
  reportError: (error: Error) => void,
): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const requestError = error as { status?: unknown; type?: unknown };
    if (requestError.type === "entity.parse.failed") {
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32_700, message: "Parse error" },
        id: null,
      });
      return;
    }
    if (requestError.type === "entity.too.large") {
      response.status(413).json({
        jsonrpc: "2.0",
        error: { code: -32_000, message: "Request body too large" },
        id: null,
      });
      return;
    }

    reportError(error instanceof Error ? error : new Error("Unknown error"));
    response.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32_603, message: "Internal error" },
      id: null,
    });
  };
}

export function createMcpApp(options: McpAppOptions): McpAppRuntime {
  const reportError = options.reportError ?? defaultErrorReporter;
  const app = createMcpExpressApp({
    host: options.host ?? "127.0.0.1",
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins,
    jsonLimit: "32kb",
  });
  app.disable("x-powered-by");

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
    options.resourceServerUrl,
  );
  const resourceMetadataPath = new URL(resourceMetadataUrl).pathname;
  const resourceMetadata: OAuthProtectedResourceMetadata = {
    resource: options.resourceServerUrl.href,
    authorization_servers: [options.authorizationServerUrl.href],
    scopes_supported: [MCP_INVOKE_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "FlowPilot Cloud Integration MCP server",
  };

  app.get(resourceMetadataPath, (_request, response) => {
    response
      .set("Access-Control-Allow-Origin", "*")
      .set("Cache-Control", "public, max-age=300")
      .status(200)
      .json(resourceMetadata);
  });
  app.options(resourceMetadataPath, (_request, response) => {
    response
      .set("Access-Control-Allow-Origin", "*")
      .set("Access-Control-Allow-Methods", "GET, OPTIONS")
      .status(204)
      .end();
  });

  app.get("/health", (_request, response) => {
    response.set("Cache-Control", "no-store").status(200).json({
      status: "ok",
      server: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      protocolVersions: MCP_PROTOCOL_VERSIONS,
      toolsEnabled: true,
    });
  });

  const handler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo?.scopes.includes(MCP_INVOKE_SCOPE)) {
        throw new Error("Authenticated MCP context is missing");
      }
      return createCloudIntegrationMcpServer({ connector: options.connector });
    },
    {
      legacy: "stateless",
      onerror: reportError,
    },
  );
  const nodeHandler = toNodeHandler(handler, { onerror: reportError });
  const authenticate = requireBearerAuth({
    verifier: options.verifier,
    requiredScopes: [MCP_INVOKE_SCOPE],
    resourceMetadataUrl,
  });

  app.all(MCP_PATH, authenticate, async (request, response) => {
    await nodeHandler(request, response, request.body);
  });
  app.use(safeRequestErrorHandler(reportError));

  return {
    app,
    close: () => handler.close(),
  };
}
