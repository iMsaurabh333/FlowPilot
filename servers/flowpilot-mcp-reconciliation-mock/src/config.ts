export type McpAuthMode = "xsuaa" | "mock";
export type MockSystem = "abc-warehouse" | "xyz-tms" | "mock-jira";

export interface MockServerConfig {
  allowedHosts?: string[];
  allowedOrigins?: string[];
  authMode: McpAuthMode;
  host: string;
  port: number;
  publicUrl: URL;
  system: MockSystem;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parseHostnames(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  const values = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!values.length || values.some((entry) => !/^[a-z0-9.-]+$/u.test(entry))) {
    throw new Error(`${name} must contain hostnames without schemes or ports`);
  }
  return [...new Set(values)];
}

export function loadMockServerConfig(environment: NodeJS.ProcessEnv = process.env): MockServerConfig {
  const port = Number(environment.PORT ?? "4200");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 to 65535");
  const host = environment.MCP_HOST ?? "127.0.0.1";
  const authMode = environment.MCP_AUTH_MODE ?? "xsuaa";
  if (authMode !== "xsuaa" && authMode !== "mock") throw new Error(`Unsupported MCP_AUTH_MODE: ${authMode}`);
  const system = environment.MCP_MOCK_SYSTEM ?? "";
  if (system !== "abc-warehouse" && system !== "xyz-tms" && system !== "mock-jira") throw new Error("MCP_MOCK_SYSTEM must be abc-warehouse, xyz-tms, or mock-jira");
  const allowedHosts = parseHostnames("MCP_ALLOWED_HOSTS", environment.MCP_ALLOWED_HOSTS);
  const allowedOrigins = parseHostnames("MCP_ALLOWED_ORIGINS", environment.MCP_ALLOWED_ORIGINS);
  if (!LOCAL_HOSTS.has(host) && (!allowedHosts || !allowedOrigins || !environment.MCP_PUBLIC_URL)) throw new Error("Public MCP_HOST values require MCP_ALLOWED_HOSTS, MCP_ALLOWED_ORIGINS, and MCP_PUBLIC_URL");
  const publicUrl = new URL(environment.MCP_PUBLIC_URL ?? `http://127.0.0.1:${port}/mcp`);
  if (publicUrl.pathname !== MCP_PATH || publicUrl.search || publicUrl.hash || (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && LOCAL_HOSTS.has(publicUrl.hostname)))) throw new Error("MCP_PUBLIC_URL must be an HTTPS /mcp URL, except for loopback HTTP");
  return { allowedHosts, allowedOrigins, authMode, host, port, publicUrl, system };
}

import { MCP_PATH } from "./constants.js";
