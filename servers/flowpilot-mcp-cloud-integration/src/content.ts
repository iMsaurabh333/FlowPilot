import { fromJsonSchema, McpServer, type CallToolResult } from "@modelcontextprotocol/server";

import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_VERSION } from "./constants.js";

const identifier = { type: "string", minLength: 1, maxLength: 256 } as const;
const optionalLimit = {
  type: "object",
  additionalProperties: false,
  properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
} as const;
const flowInput = {
  type: "object",
  additionalProperties: false,
  required: ["integrationFlowId"],
  properties: { integrationFlowId: identifier },
} as const;
const packageInput = {
  type: "object",
  additionalProperties: false,
  required: ["packageId"],
  properties: { packageId: identifier },
} as const;
const resourceInput = {
  type: "object",
  additionalProperties: false,
  required: ["integrationFlowId", "resourceName"],
  properties: { integrationFlowId: identifier, resourceName: identifier },
} as const;
const configurationInput = {
  type: "object",
  additionalProperties: false,
  required: ["integrationFlowId", "configuration"],
  properties: {
    integrationFlowId: identifier,
    configuration: { type: "object", additionalProperties: true },
  },
} as const;

const unavailable = (): CallToolResult => ({
  isError: true,
  content: [{
    type: "text",
    text: JSON.stringify({ error: "content_api_not_configured" }),
  }],
});

function register(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: object,
  readOnlyHint: boolean,
) {
  server.registerTool(name, {
    title,
    description,
    inputSchema: fromJsonSchema(inputSchema),
    annotations: {
      readOnlyHint,
      destructiveHint: !readOnlyHint,
      idempotentHint: readOnlyHint,
      openWorldHint: false,
    },
  }, async () => unavailable());
}

/**
 * Content endpoint contract. Invocation is intentionally fail-closed until a
 * separately reviewed Integration Content destination contract is configured.
 */
export function createCloudIntegrationContentMcpServer(): McpServer {
  const server = new McpServer({ name: "flowpilot-cloud-integration-content", version: MCP_SERVER_VERSION }, {
    capabilities: {},
    instructions: "Integration Content tools require a reviewed Content API destination before execution.",
    supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
  });
  register(server, "list_integration_packages", "List integration packages", "List bounded Integration Content packages.", optionalLimit, true);
  register(server, "list_integration_flow_configurations", "List flow configurations", "List configurations for one integration flow.", flowInput, true);
  register(server, "list_integration_flow_resources", "List flow resources", "List resources for one integration flow.", flowInput, true);
  register(server, "list_package_integration_flows", "List package integration flows", "List integration flows in one package.", packageInput, true);
  register(server, "get_deployed_integration_artifact", "Get deployed artifact", "Get a deployed integration artifact by flow ID.", flowInput, true);
  register(server, "list_deployed_integration_artifacts", "List deployed artifacts", "List bounded deployed integration artifacts.", optionalLimit, true);
  register(server, "execute_integration_flow_plan", "Execute integration-flow plan", "Execute a reviewed Integration Content plan.", { type: "object", additionalProperties: false, required: ["plan"], properties: { plan: { type: "array", minItems: 1, maxItems: 100 } } }, false);
  register(server, "deploy_integration_flow", "Deploy integration flow", "Deploy one reviewed integration flow.", flowInput, false);
  register(server, "undeploy_integration_flow", "Undeploy integration flow", "Undeploy one reviewed integration flow.", flowInput, false);
  register(server, "update_integration_flow_configuration", "Update flow configuration", "Update a reviewed integration-flow configuration.", configurationInput, false);
  return server;
}
