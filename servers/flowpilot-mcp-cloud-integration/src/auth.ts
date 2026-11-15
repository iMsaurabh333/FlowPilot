import { timingSafeEqual } from "node:crypto";

import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import xsenv from "@sap/xsenv";
import {
  createSecurityContext,
  errors,
  XsuaaService,
  type XsuaaSecurityContext,
} from "@sap/xssec";

import type { McpAuthMode } from "./config.js";
import { MCP_INVOKE_SCOPE } from "./constants.js";

export type ValidateXsuaaToken = (
  token: string,
) => Promise<XsuaaSecurityContext>;

export interface McpAuthentication {
  authorizationServerUrl: URL;
  verifier: OAuthTokenVerifier;
}

function invalidToken(): OAuthError {
  return new OAuthError(
    OAuthErrorCode.InvalidToken,
    "The access token is invalid",
  );
}

function loadXsuaaService(): {
  authorizationServerUrl: URL;
  service: XsuaaService;
} {
  const bindings = xsenv.getServices({ xsuaa: { tag: "xsuaa" } });
  const credentials = bindings.xsuaa as ConstructorParameters<
    typeof XsuaaService
  >[0];
  if (!credentials.url) {
    throw new Error("XSUAA binding has no authorization server URL");
  }
  const authorizationServerUrl = new URL(credentials.url);
  if (authorizationServerUrl.protocol !== "https:") {
    throw new Error("XSUAA authorization server URL must use HTTPS");
  }

  return {
    authorizationServerUrl,
    service: new XsuaaService(credentials),
  };
}

function createDefaultXsuaaValidator(): ValidateXsuaaToken {
  const { service } = loadXsuaaService();

  return (token) => createSecurityContext(service, { jwt: token });
}

export function createXsuaaTokenVerifier(
  validateToken: ValidateXsuaaToken = createDefaultXsuaaValidator(),
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let context: XsuaaSecurityContext;
      try {
        context = await validateToken(token);
      } catch (error: unknown) {
        if (error instanceof errors.ValidationError) {
          throw invalidToken();
        }
        throw error;
      }

      if (context.token.getGrantType() !== "client_credentials") {
        throw invalidToken();
      }

      const expiresAt = Math.floor(
        context.token.getExpirationDate().getTime() / 1_000,
      );
      if (!Number.isSafeInteger(expiresAt)) {
        throw invalidToken();
      }

      return {
        token,
        clientId: context.getClientId(),
        scopes: context.checkLocalScope(MCP_INVOKE_SCOPE)
          ? [MCP_INVOKE_SCOPE]
          : [],
        expiresAt,
      };
    },
  };
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function createMockTokenVerifier(
  environment: NodeJS.ProcessEnv = process.env,
): OAuthTokenVerifier {
  if (environment.NODE_ENV === "production") {
    throw new Error("Mock MCP authentication cannot run in production");
  }

  const expectedToken = environment.MCP_MOCK_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    throw new Error("MCP_MOCK_TOKEN must contain at least 32 characters");
  }

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (!tokensMatch(token, expectedToken)) {
        throw invalidToken();
      }

      return {
        token,
        clientId: "flowpilot-local-mcp-client",
        scopes: [MCP_INVOKE_SCOPE],
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
      };
    },
  };
}

function parseAuthorizationServerUrl(value: string): URL {
  const url = new URL(value);
  const isLoopbackHttp =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !isLoopbackHttp) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "MCP authorization server URL must use HTTPS, except for loopback HTTP",
    );
  }
  return url;
}

export function createConfiguredAuthentication(
  mode: McpAuthMode,
  environment: NodeJS.ProcessEnv = process.env,
): McpAuthentication {
  if (mode === "mock") {
    const port = Number(environment.PORT ?? "4100");
    return {
      authorizationServerUrl: parseAuthorizationServerUrl(
        environment.MCP_AUTHORIZATION_SERVER_URL ??
          `http://127.0.0.1:${port}/mock-authorization-server`,
      ),
      verifier: createMockTokenVerifier(environment),
    };
  }

  const { authorizationServerUrl, service } = loadXsuaaService();
  return {
    authorizationServerUrl: parseAuthorizationServerUrl(
      environment.MCP_AUTHORIZATION_SERVER_URL ?? authorizationServerUrl.href,
    ),
    verifier: createXsuaaTokenVerifier((token) =>
      createSecurityContext(service, { jwt: token }),
    ),
  };
}
