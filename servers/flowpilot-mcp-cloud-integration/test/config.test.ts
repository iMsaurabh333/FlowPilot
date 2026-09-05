import { describe, expect, it } from "vitest";

import { loadMcpServerConfig } from "../src/config.js";

describe("MCP server configuration", () => {
  it("defaults to loopback, XSUAA, and the local port", () => {
    const config = loadMcpServerConfig({});
    expect({ ...config, publicUrl: config.publicUrl.href }).toEqual({
      allowedHosts: undefined,
      allowedOrigins: undefined,
      authMode: "xsuaa",
      host: "127.0.0.1",
      port: 4100,
      publicUrl: "http://127.0.0.1:4100/mcp",
    });
  });

  it("accepts an IPv6 loopback listener and public URL", () => {
    const config = loadMcpServerConfig({
      MCP_HOST: "::1",
      MCP_PUBLIC_URL: "http://[::1]:4100/mcp",
    });

    expect(config.host).toBe("::1");
    expect(config.publicUrl.href).toBe("http://[::1]:4100/mcp");
  });

  it("requires host and origin allowlists for a public bind", () => {
    expect(() => loadMcpServerConfig({ MCP_HOST: "0.0.0.0" })).toThrow(
      "Public MCP_HOST values require MCP_ALLOWED_HOSTS and MCP_ALLOWED_ORIGINS",
    );
  });

  it("normalizes public allowlists", () => {
    expect(
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "mcp.example.test, mcp.example.test",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
        MCP_AUTH_MODE: "mock",
        MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
        PORT: "49152",
      }),
    ).toEqual({
      allowedHosts: ["mcp.example.test"],
      allowedOrigins: ["flowpilot.example.test"],
      authMode: "mock",
      host: "0.0.0.0",
      port: 49152,
      publicUrl: new URL("https://mcp.example.test/mcp"),
    });
  });

  it.each(["0", "65536", "12.5", "invalid"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => loadMcpServerConfig({ PORT: port })).toThrow(
        "PORT must be an integer from 1 to 65535",
      );
    },
  );

  it("rejects schemes and ports in hostname allowlists", () => {
    expect(() =>
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "https://mcp.example.test",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
      }),
    ).toThrow(
      "MCP_ALLOWED_HOSTS must contain hostnames without schemes or ports",
    );

    expect(() =>
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "mcp.example.test:443",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
      }),
    ).toThrow(
      "MCP_ALLOWED_HOSTS must contain hostnames without schemes or ports",
    );

    expect(() =>
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "mcp example test",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
      }),
    ).toThrow(
      "MCP_ALLOWED_HOSTS must contain hostnames without schemes or ports",
    );
  });

  it("requires a safe canonical public MCP URL", () => {
    expect(() =>
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "mcp.example.test",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
      }),
    ).toThrow("Public MCP_HOST values require MCP_PUBLIC_URL");

    expect(() =>
      loadMcpServerConfig({ MCP_PUBLIC_URL: "https://mcp.example.test/other" }),
    ).toThrow(
      "MCP_PUBLIC_URL must be an HTTPS /mcp URL, except for loopback HTTP",
    );

    expect(() =>
      loadMcpServerConfig({
        MCP_HOST: "0.0.0.0",
        MCP_ALLOWED_HOSTS: "other.example.test",
        MCP_ALLOWED_ORIGINS: "flowpilot.example.test",
        MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      }),
    ).toThrow("MCP_ALLOWED_HOSTS must include the MCP_PUBLIC_URL hostname");
  });
});
