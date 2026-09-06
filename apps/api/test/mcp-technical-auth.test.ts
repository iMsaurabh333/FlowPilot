import { describe, expect, it } from "vitest";

import { TechnicalMcpAuthProfileResolver } from "../src/mcp/technical-auth.js";

const binding = {
  VCAP_SERVICES: JSON.stringify({
    xsuaa: [
      {
        name: "flowpilot-auth",
        credentials: {
          url: "https://mcp-auth.example.test",
          clientid: "technical-client",
          clientsecret: "technical-secret",
          xsappname: "flowpilot",
        },
      },
    ],
  }),
};

describe("MCP technical authentication", () => {
  it("mints and caches a narrowly scoped technical token", async () => {
    const calls: unknown[] = [];
    const resolver = new TechnicalMcpAuthProfileResolver(binding, {
      request: async (request) => {
        calls.push(request);
        return {
          ok: true,
          body: JSON.stringify({
            access_token: "short-lived-token",
            expires_in: 300,
          }),
        };
      },
    });

    await expect(resolver.resolve("technical:flowpilot-mcp")).resolves.toEqual({
      Authorization: "Bearer short-lived-token",
    });
    await expect(resolver.resolve("technical:flowpilot-mcp")).resolves.toEqual({
      Authorization: "Bearer short-lived-token",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://mcp-auth.example.test/oauth/token",
      body: "grant_type=client_credentials&scope=flowpilot-mcp.McpInvoke",
    });
  });

  it("fails closed for unrelated profiles, missing bindings, and bad token responses", async () => {
    const missing = new TechnicalMcpAuthProfileResolver({});
    await expect(
      missing.resolve("technical:flowpilot-mcp"),
    ).resolves.toBeUndefined();

    const resolver = new TechnicalMcpAuthProfileResolver(binding, {
      request: async () => ({ ok: true, body: "{}" }),
    });
    await expect(
      resolver.resolve("destination:unrelated"),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolve("technical:flowpilot-mcp"),
    ).resolves.toBeUndefined();
  });
});
