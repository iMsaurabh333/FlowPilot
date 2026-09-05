import { describe, expect, it } from "vitest";

import {
  DestinationServiceResolver,
  type DestinationServiceResolverOptions,
} from "../src/destination.js";
import {
  MessageProcessingLogsError,
  MPL_DESTINATION_NAME,
} from "../src/mpl.js";

const credentials: NonNullable<
  DestinationServiceResolverOptions["credentials"]
> = {
  clientid: "destination-client",
  clientsecret: "destination-secret",
  uri: "https://destination.example.test",
  url: "https://uaa.example.test",
};

describe("Destination service resolver", () => {
  it("gets a token, resolves only the approved destination, and returns a safe header", async () => {
    const calls: { method: string; url: string; authorization?: string }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization:
          new Headers(init?.headers).get("authorization") ?? undefined,
      });
      if (String(url).endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "destination-access-token",
            expires_in: 300,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          destinationConfiguration: {
            Name: MPL_DESTINATION_NAME,
            Type: "HTTP",
            ProxyType: "Internet",
            Authentication: "OAuth2ClientCredentials",
            URL: "https://cpi.example.test",
          },
          authTokens: [
            {
              type: "Bearer",
              http_header: {
                key: "Authorization",
                value: "Bearer cpi-access-token",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const resolver = new DestinationServiceResolver({
      credentials,
      fetchImpl,
    });

    await expect(resolver.resolve(MPL_DESTINATION_NAME)).resolves.toEqual({
      url: "https://cpi.example.test",
      headers: { Authorization: "Bearer cpi-access-token" },
    });
    await expect(resolver.resolve(MPL_DESTINATION_NAME)).resolves.toEqual({
      url: "https://cpi.example.test",
      headers: { Authorization: "Bearer cpi-access-token" },
    });
    expect(
      calls.filter((call) => call.url.endsWith("/oauth/token")),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.url.includes("/destinations/")).length,
    ).toBe(2);
    expect(calls[1].authorization).toBe("Bearer destination-access-token");
    expect(JSON.stringify(calls)).not.toContain(credentials.clientsecret);
  });

  it("fails closed for unapproved names and malformed destination responses", async () => {
    const resolver = new DestinationServiceResolver({
      credentials,
      fetchImpl: async (url) =>
        String(url).endsWith("/oauth/token")
          ? new Response(JSON.stringify({ access_token: "token" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify({}), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
    });
    await expect(resolver.resolve("OTHER_DESTINATION")).rejects.toMatchObject({
      category: "destination_unavailable",
    });
    await expect(resolver.resolve(MPL_DESTINATION_NAME)).rejects.toBeInstanceOf(
      MessageProcessingLogsError,
    );
  });
});
