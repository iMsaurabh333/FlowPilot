import type { XsuaaSecurityContext } from "@sap/xssec";
import { describe, expect, it } from "vitest";

import {
  createConfiguredAuthentication,
  createMockTokenVerifier,
  createXsuaaTokenVerifier,
} from "../src/auth.js";
import { MCP_INVOKE_SCOPE } from "../src/constants.js";

const MOCK_TOKEN = "local-only-token-with-at-least-32-characters";

function xsuaaContext(options?: {
  grantType?: string;
  hasScope?: boolean;
}): XsuaaSecurityContext {
  return {
    token: {
      getExpirationDate: () => new Date(Date.now() + 60_000),
      getGrantType: () => options?.grantType ?? "client_credentials",
    },
    checkLocalScope: (scope: string) =>
      scope === MCP_INVOKE_SCOPE && (options?.hasScope ?? true),
    getClientId: () => "flowpilot-api-client",
  } as unknown as XsuaaSecurityContext;
}

describe("technical token verification", () => {
  it("maps a validated client-credentials token to MCP auth info", async () => {
    const verifier = createXsuaaTokenVerifier(async () => xsuaaContext());

    await expect(
      verifier.verifyAccessToken("signed-token"),
    ).resolves.toMatchObject({
      token: "signed-token",
      clientId: "flowpilot-api-client",
      scopes: [MCP_INVOKE_SCOPE],
    });
  });

  it("leaves missing scope enforcement to the bearer middleware", async () => {
    const verifier = createXsuaaTokenVerifier(async () =>
      xsuaaContext({ hasScope: false }),
    );

    await expect(
      verifier.verifyAccessToken("signed-token"),
    ).resolves.toMatchObject({
      scopes: [],
    });
  });

  it("rejects a valid user token because the MCP boundary is technical", async () => {
    const verifier = createXsuaaTokenVerifier(async () =>
      xsuaaContext({ grantType: "authorization_code" }),
    );

    await expect(
      verifier.verifyAccessToken("user-token"),
    ).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("supports a constant-time local token outside production", async () => {
    const verifier = createMockTokenVerifier({
      NODE_ENV: "test",
      MCP_MOCK_TOKEN: MOCK_TOKEN,
    });

    await expect(verifier.verifyAccessToken(MOCK_TOKEN)).resolves.toMatchObject(
      {
        clientId: "flowpilot-local-mcp-client",
        scopes: [MCP_INVOKE_SCOPE],
      },
    );
    await expect(
      verifier.verifyAccessToken("wrong-token"),
    ).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("fails closed for weak or production mock configuration", () => {
    expect(() =>
      createMockTokenVerifier({ NODE_ENV: "test", MCP_MOCK_TOKEN: "short" }),
    ).toThrow("MCP_MOCK_TOKEN must contain at least 32 characters");

    expect(() =>
      createMockTokenVerifier({
        NODE_ENV: "production",
        MCP_MOCK_TOKEN: MOCK_TOKEN,
      }),
    ).toThrow("Mock MCP authentication cannot run in production");
  });

  it("accepts an IPv6 loopback authorization server for local mock mode", () => {
    const authentication = createConfiguredAuthentication("mock", {
      MCP_AUTHORIZATION_SERVER_URL: "http://[::1]:4100/authorize",
      MCP_MOCK_TOKEN: MOCK_TOKEN,
      NODE_ENV: "test",
    });

    expect(authentication.authorizationServerUrl.href).toBe(
      "http://[::1]:4100/authorize",
    );
  });
});
