export const MCP_SERVER_NAME = "flowpilot-cloud-integration";
export const MCP_SERVER_VERSION = "0.1.0";
export const MCP_PATH = "/mcp";
export const MCP_INVOKE_SCOPE = "McpInvoke";

export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25"] as const;

export const CURRENT_MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
export const LEGACY_MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[1];
