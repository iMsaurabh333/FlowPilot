import { createMcpExpressApp, getOAuthProtectedResourceMetadataUrl, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import type { Request, Response } from "express";

import { createConfiguredAuthentication } from "./auth.js";
import { loadMockServerConfig } from "./config.js";
import { MCP_INVOKE_SCOPE, MCP_PATH, MCP_PROTOCOL_VERSIONS, MCP_SERVER_VERSION } from "./constants.js";
import { findDefect, findRecord } from "./data.js";

async function main(): Promise<void> {
  const config = loadMockServerConfig();
  const authentication = createConfiguredAuthentication(config.authMode);
  const app = createMcpExpressApp({ host: config.host, allowedHosts: config.allowedHosts, allowedOrigins: config.allowedOrigins, jsonLimit: "32kb" });
  app.disable("x-powered-by");
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);
  app.get(new URL(resourceMetadataUrl).pathname, (_request: Request, response: Response) => response.set("Access-Control-Allow-Origin", "*").status(200).json({ resource: config.publicUrl.href, authorization_servers: [authentication.authorizationServerUrl.href], scopes_supported: [MCP_INVOKE_SCOPE], bearer_methods_supported: ["header"], resource_name: `${config.system} reconciliation mock MCP server` }));
  app.get("/health", (_request: Request, response: Response) => response.status(200).json({ status: "ok", system: config.system, version: MCP_SERVER_VERSION, toolsEnabled: true }));
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: config.system, version: MCP_SERVER_VERSION }, { capabilities: {}, instructions: `Read-only deterministic mock data for ${config.system}.`, supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS] });
    if (config.system === "mock-jira") {
      server.registerTool("get_jira_defect", { title: "Get Jira defect", description: "Look up one mock Jira defect by its defect ID. The result includes the linked transaction ID for subsequent CPI, TMS, or Warehouse status checks.", inputSchema: fromJsonSchema({ type: "object", additionalProperties: false, required: ["defectId"], properties: { defectId: { type: "string", minLength: 1, maxLength: 256 } } }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args) => {
        const defect = findDefect((args as { defectId: string }).defectId);
        const items = defect ? [defect] : [];
        return { content: [{ type: "text", text: JSON.stringify({ items, count: items.length }) }], structuredContent: { items, count: items.length } };
      });
      return server;
    }
    const identifierField = config.system === "abc-warehouse" ? "orderNumber" : "salesOrderNumber";
    server.registerTool("get_application_message", { title: "Get application message", description: `Look up one ${config.system} record by its business identifier. ${identifierField} is the preferred input; applicationMessageId remains available for existing configurations.`, inputSchema: fromJsonSchema({ type: "object", additionalProperties: false, properties: { [identifierField]: { type: "string", minLength: 1, maxLength: 256 }, applicationMessageId: { type: "string", minLength: 1, maxLength: 256 } } }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args) => {
      const input = args as Record<string, string>;
      const record = findRecord(config.system, input[identifierField] ?? input.applicationMessageId ?? "");
      return { content: [{ type: "text", text: JSON.stringify({ items: record ? [record] : [], count: record ? 1 : 0 }) }], structuredContent: { items: record ? [record] : [], count: record ? 1 : 0 } };
    });
    return server;
  }, { legacy: "stateless", onerror: (error) => console.error(JSON.stringify({ level: "error", message: "Reconciliation mock MCP request failed", errorType: error.name })) });
  const nodeHandler = toNodeHandler(handler);
  app.all(MCP_PATH, requireBearerAuth({ verifier: authentication.verifier, requiredScopes: [MCP_INVOKE_SCOPE], resourceMetadataUrl }), async (request: Request, response: Response) => { await nodeHandler(request, response, request.body); });
  const server = app.listen(config.port, config.host, () => console.log(JSON.stringify({ level: "info", message: `${config.system} reconciliation mock MCP started`, host: config.host, port: config.port })));
  const shutdown = () => server.close(() => { void handler.close(); });
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => { console.error(JSON.stringify({ level: "error", message: "Reconciliation mock MCP failed to start", errorType: error instanceof Error ? error.name : "UnknownError" })); process.exitCode = 1; });
