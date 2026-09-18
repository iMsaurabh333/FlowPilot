import { fromJsonSchema, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_VERSION } from "./constants.js";
import { CONTENT_DESTINATION_NAME, DestinationServiceResolver } from "./destination.js";

const id = { type: "string", minLength: 1, maxLength: 256 } as const;
const flow = { type: "object", additionalProperties: false, required: ["integrationFlowId", "version"], properties: { integrationFlowId: id, version: id } } as const;
const packageInput = { type: "object", additionalProperties: false, required: ["packageId"], properties: { packageId: id } } as const;
const config = { type: "object", additionalProperties: false, required: ["integrationFlowId", "version", "configuration"], properties: { integrationFlowId: id, version: id, configuration: { type: "object", additionalProperties: { type: "object", additionalProperties: false, required: ["value", "dataType"], properties: { value: { type: "string", maxLength: 10000 }, dataType: id } } } } } as const;
const limit = { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } } } as const;

const quote = (value: string) => value.replaceAll("'", "''");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const failed = (cause: unknown): CallToolResult => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: cause instanceof Error ? cause.message : "content_api_unavailable" }) }] });

class ContentApi {
  #resolver = new DestinationServiceResolver();
  #csrf?: string;
  async #token(base: string, headers: Record<string, string>) {
    if (this.#csrf) return this.#csrf;
    const response = await fetch(`${base.replace(/\/+$/u, "")}/IntegrationPackages?$top=1`, { headers: { Accept: "application/json", "x-csrf-token": "fetch", ...headers }, redirect: "error", signal: AbortSignal.timeout(15000) });
    const token = response.headers.get("x-csrf-token");
    if (!response.ok || !token) throw new Error("content_api_csrf_token_failed");
    this.#csrf = token;
    return token;
  }
  async request(path: string, init: RequestInit = {}) {
    const destination = await this.#resolver.resolve(CONTENT_DESTINATION_NAME);
    const configuredBase = destination.url.replace(/\/+$/u, "");
    // The BTP Destination represents the CPI tenant host. Keep the OData API
    // root in this reviewed connector rather than requiring it in Destination.
    const base = configuredBase.endsWith("/api/v1") ? configuredBase : `${configuredBase}/api/v1`;
    const modifying = init.method !== undefined && init.method !== "GET";
    const response = await fetch(`${base}/${path.replace(/^\/+/, "")}`, { ...init, redirect: "error", signal: AbortSignal.timeout(30000), headers: { Accept: "application/json", ...destination.headers, ...(modifying ? { "x-csrf-token": await this.#token(base, destination.headers) } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    const body = await response.text();
    if (!response.ok) { if (response.status === 403) this.#csrf = undefined; throw new Error(response.status === 401 || response.status === 403 ? "content_api_not_authorized" : `content_api_request_failed_${response.status}`); }
    if (!body) return { accepted: true };
    try { return JSON.parse(body) as unknown; } catch { return { result: body }; }
  }
  packages(value: number) { return this.request(`IntegrationPackages?$format=json&$top=${value}`); }
  flows(value: string) { return this.request(`IntegrationPackages('${quote(value)}')/IntegrationDesigntimeArtifacts?$format=json`); }
  configurations(value: string, version: string) { return this.request(`IntegrationDesigntimeArtifacts(Id='${quote(value)}',Version='${quote(version)}')/Configurations?$format=json`); }
  deploy(value: string, version: string) { return this.request(`DeployIntegrationDesigntimeArtifact?Id='${encodeURIComponent(value)}'&Version='${encodeURIComponent(version)}'`, { method: "POST" }); }
  undeploy(value: string) { return this.request(`IntegrationRuntimeArtifacts('${quote(value)}')`, { method: "DELETE" }); }
  async update(value: string, version: string, parameters: Record<string, { value: string; dataType: string }>) { for (const [key, parameter] of Object.entries(parameters)) await this.request(`IntegrationDesigntimeArtifacts(Id='${quote(value)}',Version='${quote(version)}')/$links/Configurations('${quote(key)}')`, { method: "PUT", body: JSON.stringify({ ParameterKey: key, ParameterValue: parameter.value, DataType: parameter.dataType }) }); return { updated: Object.keys(parameters).length }; }
}

function tool(server: McpServer, name: string, title: string, description: string, schema: object, readOnly: boolean, handler: (args: Record<string, unknown>) => Promise<unknown>) {
  server.registerTool(name, { title, description, inputSchema: fromJsonSchema(schema), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: false, openWorldHint: false } }, async (args) => { try { const result = await handler(record(args) ? args : {}); return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: record(result) ? result : { result } }; } catch (cause) { return failed(cause); } });
}

export function createCloudIntegrationContentMcpServer(): McpServer {
  const server = new McpServer({ name: "flowpilot-cloud-integration-content", version: MCP_SERVER_VERSION }, { capabilities: {}, instructions: "Live Content API access is limited to FLOWPILOT_CLOUD_INTEGRATION_CONTENT.", supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS] });
  const api = new ContentApi();
  tool(server, "list_integration_packages", "List integration packages", "List Integration Packages in the configured CPI tenant.", limit, true, ({ limit: value = 50 }) => api.packages(value as number));
  tool(server, "list_package_integration_flows", "List package integration flows", "List design-time flows in one Integration Package.", packageInput, true, ({ packageId }) => api.flows(packageId as string));
  tool(server, "list_integration_flow_configurations", "List flow configurations", "List externalized parameters by integration flow ID and version.", flow, true, ({ integrationFlowId, version }) => api.configurations(integrationFlowId as string, version as string));
  tool(server, "deploy_integration_flow", "Deploy integration flow", "Deploy one design-time integration flow.", flow, false, ({ integrationFlowId, version }) => api.deploy(integrationFlowId as string, version as string));
  tool(server, "undeploy_integration_flow", "Undeploy integration flow", "Undeploy a runtime integration artifact.", { type: "object", additionalProperties: false, required: ["integrationFlowId"], properties: { integrationFlowId: id } }, false, ({ integrationFlowId }) => api.undeploy(integrationFlowId as string));
  tool(server, "update_integration_flow_configuration", "Update flow configuration", "Update externalized values before deployment.", config, false, ({ integrationFlowId, version, configuration }) => api.update(integrationFlowId as string, version as string, configuration as Record<string, { value: string; dataType: string }>));
  return server;
}
