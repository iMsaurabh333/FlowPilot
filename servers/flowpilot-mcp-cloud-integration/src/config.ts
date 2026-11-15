export type McpAuthMode = "xsuaa" | "mock";

export interface McpServerConfig {
  allowedHosts?: string[];
  allowedOrigins?: string[];
  authMode: McpAuthMode;
  host: string;
  port: number;
  publicUrl: URL;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "4100");
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return parsed;
}

function parseAuthMode(value: string | undefined): McpAuthMode {
  const mode = value ?? "xsuaa";
  if (mode === "xsuaa" || mode === "mock") {
    return mode;
  }
  throw new Error(`Unsupported MCP_AUTH_MODE: ${mode}`);
}

function parseHostnameList(
  name: "MCP_ALLOWED_HOSTS" | "MCP_ALLOWED_ORIGINS",
  value: string | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const values = entries.map((entry) => {
    try {
      const parsed = new URL(`http://${entry}`);
      if (
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.hostname !== entry
      ) {
        return undefined;
      }
      return parsed.hostname;
    } catch {
      return undefined;
    }
  });

  if (values.length === 0 || values.some((entry) => entry === undefined)) {
    throw new Error(`${name} must contain hostnames without schemes or ports`);
  }

  return [...new Set(values as string[])];
}

export function loadMcpServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): McpServerConfig {
  const port = parsePort(environment.PORT);
  const host = environment.MCP_HOST ?? "127.0.0.1";
  const allowedHosts = parseHostnameList(
    "MCP_ALLOWED_HOSTS",
    environment.MCP_ALLOWED_HOSTS,
  );
  const allowedOrigins = parseHostnameList(
    "MCP_ALLOWED_ORIGINS",
    environment.MCP_ALLOWED_ORIGINS,
  );

  if (!LOCAL_HOSTS.has(host)) {
    if (!allowedHosts || !allowedOrigins) {
      throw new Error(
        "Public MCP_HOST values require MCP_ALLOWED_HOSTS and MCP_ALLOWED_ORIGINS",
      );
    }
    if (!environment.MCP_PUBLIC_URL) {
      throw new Error("Public MCP_HOST values require MCP_PUBLIC_URL");
    }
  }

  const publicUrl = new URL(
    environment.MCP_PUBLIC_URL ?? `http://127.0.0.1:${port}/mcp`,
  );
  if (
    publicUrl.pathname !== "/mcp" ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password ||
    (publicUrl.protocol !== "https:" &&
      !(publicUrl.protocol === "http:" && LOCAL_HOSTS.has(publicUrl.hostname)))
  ) {
    throw new Error(
      "MCP_PUBLIC_URL must be an HTTPS /mcp URL, except for loopback HTTP",
    );
  }
  if (
    !LOCAL_HOSTS.has(host) &&
    !allowedHosts?.includes(publicUrl.hostname.toLowerCase())
  ) {
    throw new Error(
      "MCP_ALLOWED_HOSTS must include the MCP_PUBLIC_URL hostname",
    );
  }

  return {
    allowedHosts,
    allowedOrigins,
    authMode: parseAuthMode(environment.MCP_AUTH_MODE),
    host,
    port,
    publicUrl,
  };
}
