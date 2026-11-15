import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";

import {
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./constants.js";
import { createConfiguredMessageProcessingLogsConnector } from "./destination.js";
import {
  MessageProcessingLogsError,
  MPL_DEFAULT_LIMIT,
  MPL_MAX_LIMIT,
  MPL_STATUSES,
  type SearchMessageProcessingLogsRequest,
  type SearchMessageProcessingLogsResponse,
  type GetMessageProcessingLogErrorInformationRequest,
  type MessageProcessingLogErrorInformation,
  type MessageProcessingLogsConnectorLike,
} from "./mpl.js";

const searchInputSchema = fromJsonSchema<SearchMessageProcessingLogsRequest>({
  type: "object",
  additionalProperties: false,
  properties: {
    fromUtc: {
      type: "string",
      pattern:
        "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
      description: "RFC 3339 timestamp with a UTC offset",
    },
    toUtc: {
      type: "string",
      pattern:
        "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
      description: "RFC 3339 timestamp with a UTC offset",
    },
    status: { type: "string", enum: [...MPL_STATUSES] },
    integrationFlowId: { type: "string", minLength: 1, maxLength: 256 },
    correlationId: { type: "string", minLength: 1, maxLength: 256 },
    applicationMessageId: { type: "string", minLength: 1, maxLength: 256 },
    applicationMessageType: {
      type: "string",
      minLength: 1,
      maxLength: 256,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MPL_MAX_LIMIT,
      default: MPL_DEFAULT_LIMIT,
    },
  },
});

const searchOutputSchema = fromJsonSchema<SearchMessageProcessingLogsResponse>({
  type: "object",
  additionalProperties: false,
  required: ["items", "count", "hasMore"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "messageId",
          "correlationId",
          "applicationMessageId",
          "applicationMessageType",
          "integrationFlowId",
          "integrationFlowName",
          "status",
          "startedAt",
          "endedAt",
          "durationMilliseconds",
        ],
        properties: {
          messageId: { type: "string" },
          correlationId: { type: ["string", "null"] },
          applicationMessageId: { type: ["string", "null"] },
          applicationMessageType: { type: ["string", "null"] },
          integrationFlowId: { type: ["string", "null"] },
          integrationFlowName: { type: ["string", "null"] },
          status: { type: ["string", "null"] },
          startedAt: { type: ["string", "null"] },
          endedAt: { type: ["string", "null"] },
          durationMilliseconds: {
            type: ["integer", "null"],
            minimum: 0,
          },
        },
      },
    },
    count: { type: "integer", minimum: 0, maximum: MPL_MAX_LIMIT },
    hasMore: { type: "boolean" },
  },
});

const errorInformationInputSchema = fromJsonSchema<GetMessageProcessingLogErrorInformationRequest>({
  type: "object",
  additionalProperties: false,
  required: ["messageId", "status"],
  properties: {
    messageId: { type: "string", minLength: 1, maxLength: 256 },
    status: { type: "string", enum: [...MPL_STATUSES] },
  },
});

const errorInformationOutputSchema = fromJsonSchema<MessageProcessingLogErrorInformation>({
  type: "object",
  additionalProperties: false,
  required: ["messageId", "status", "errorInformation", "available"],
  properties: {
    messageId: { type: "string" },
    status: { type: "string", enum: [...MPL_STATUSES] },
    errorInformation: { type: ["string", "null"] },
    available: { type: "boolean" },
  },
});

export interface CloudIntegrationMcpServerOptions {
  connector?: MessageProcessingLogsConnectorLike;
}

function safeToolError(error: unknown): CallToolResult {
  const category =
    error instanceof MessageProcessingLogsError
      ? error.category
      : "destination_unavailable";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: category }) }],
  };
}

export function createCloudIntegrationMcpServer(
  options: CloudIntegrationMcpServerOptions = {},
): McpServer {
  const connector =
    options.connector ?? createConfiguredMessageProcessingLogsConnector();
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {},
      instructions:
        "Only the reviewed bounded GET-only Message Processing Logs tool is exposed.",
      supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
    },
  );

  server.registerTool(
    "search_message_processing_logs",
    {
      title: "Search Message Processing Logs",
      description:
        "Return bounded Message Processing Log metadata for a UTC time window. " +
        "Only reviewed exact filters are accepted; message bodies, traces, attachments, " +
        "and write operations are never exposed.",
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const result = await connector.search(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return safeToolError(error);
      }
    },
  );

  server.registerTool(
    "get_message_processing_log_error_information",
    {
      title: "Get Message Processing Log Error Information",
      description:
        "Return bounded plain-text error information for one non-completed Message Processing Log. " +
        "Requires the MessageGuid and current status from an approved log search. " +
        "Completed and discarded messages are not queried.",
      inputSchema: errorInformationInputSchema,
      outputSchema: errorInformationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const getErrorInformation = connector.errorInformation;
        if (!getErrorInformation) {
          throw new MessageProcessingLogsError("destination_unavailable");
        }
        const result = await getErrorInformation.call(connector, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return safeToolError(error);
      }
    },
  );

  return server;
}
