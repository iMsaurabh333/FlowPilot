import { timingSafeEqual } from "node:crypto";

import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import xsenv from "@sap/xsenv";
import { createSecurityContext, errors, XsuaaService } from "@sap/xssec";

import type { McpAuthMode } from "./config.js";
import { MCP_INVOKE_SCOPE } from "./constants.js";

function invalidToken() { return new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid"); }

function mockVerifier(environment: NodeJS.ProcessEnv): OAuthTokenVerifier {
  if (environment.NODE_ENV === "production") throw new Error("Mock MCP authentication cannot run in production");
  const expected = environment.MCP_MOCK_TOKEN;
  if (!expected || expected.length < 32) throw new Error("MCP_MOCK_TOKEN must contain at least 32 characters");
  return { async verifyAccessToken(token: string): Promise<AuthInfo> {
    const actual = Buffer.from(token); const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw invalidToken();
    return { token, clientId: "flowpilot-local-mcp-client", scopes: [MCP_INVOKE_SCOPE], expiresAt: Math.floor(Date.now() / 1_000) + 300 };
  } };
}

function xsuaaVerifier(): { authorizationServerUrl: URL; verifier: OAuthTokenVerifier } {
  const bindings = xsenv.getServices({ xsuaa: { tag: "xsuaa" } });
  const credentials = bindings.xsuaa as ConstructorParameters<typeof XsuaaService>[0];
  if (!credentials.url) throw new Error("XSUAA binding has no authorization server URL");
  const authorizationServerUrl = new URL(credentials.url);
  if (authorizationServerUrl.protocol !== "https:") throw new Error("XSUAA authorization server URL must use HTTPS");
  const service = new XsuaaService(credentials);
  return { authorizationServerUrl, verifier: { async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const context = await createSecurityContext(service, { jwt: token });
      if (context.token.getGrantType() !== "client_credentials") throw invalidToken();
      return { token, clientId: context.getClientId(), scopes: context.checkLocalScope(MCP_INVOKE_SCOPE) ? [MCP_INVOKE_SCOPE] : [], expiresAt: Math.floor(context.token.getExpirationDate().getTime() / 1_000) };
    } catch (error) { if (error instanceof errors.ValidationError) throw invalidToken(); throw error; }
  } } };
}

export function createConfiguredAuthentication(mode: McpAuthMode, environment: NodeJS.ProcessEnv = process.env) {
  if (mode === "xsuaa") return xsuaaVerifier();
  const port = Number(environment.PORT ?? "4200");
  return { authorizationServerUrl: new URL(environment.MCP_AUTHORIZATION_SERVER_URL ?? `http://127.0.0.1:${port}/mock-authorization-server`), verifier: mockVerifier(environment) };
}
