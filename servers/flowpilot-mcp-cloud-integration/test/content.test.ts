import { describe, expect, it } from "vitest";

import { ContentClient } from "../src/content.js";
import { CONTENT_DESTINATION_NAME, type DestinationResolver } from "../src/mpl.js";

function resolver(): DestinationResolver {
  return {
    async resolve(name) {
      expect(name).toBe(CONTENT_DESTINATION_NAME);
      return {
        url: "https://cpi.example.test/api/v1",
        headers: { Authorization: "Bearer destination-token" },
      };
    },
  };
}

describe("Content client", () => {
  it("gets a CSRF token from the OData service root before deploying", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const client = new ContentClient(resolver(), async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      if (requests.length === 1) {
        return new Response("", {
          status: 200,
          headers: { "x-csrf-token": "csrf-token", "set-cookie": "session=1" },
        });
      }
      return new Response("{}", { status: 202, headers: { "content-type": "application/json" } });
    });

    await client.deploy({ operation: "deploy", artifactId: "iflow1", version: "active" });

    expect(requests).toHaveLength(2);
    expect(requests[0].url.pathname).toBe("/api/v1/");
    expect(requests[0].init?.method).toBe("GET");
    expect(new Headers(requests[0].init?.headers).get("X-CSRF-Token")).toBe("Fetch");
    expect(requests[1].url.pathname).toBe("/api/v1/DeployIntegrationDesigntimeArtifact");
    expect(requests[1].init?.method).toBe("POST");
    expect(new Headers(requests[1].init?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(new Headers(requests[1].init?.headers).get("Cookie")).toBe("session=1");
  });

  it("falls back to the design-time artifact collection when the service root has no token", async () => {
    const requests: URL[] = [];
    const client = new ContentClient(resolver(), async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (requests.length === 1) return new Response("", { status: 404 });
      if (requests.length === 2) {
        return new Response("", { status: 200, headers: { "x-csrf-token": "csrf-token" } });
      }
      return new Response("{}", { status: 202, headers: { "content-type": "application/json" } });
    });

    await expect(client.deploy({ operation: "deploy", artifactId: "iflow1", version: "active" })).resolves.toEqual({});

    expect(requests.map(({ pathname }) => pathname)).toEqual([
      "/api/v1/",
      "/api/v1/IntegrationDesigntimeArtifacts",
      "/api/v1/DeployIntegrationDesigntimeArtifact",
    ]);
    expect(requests[1].searchParams.get("$top")).toBe("1");
    expect(requests[1].searchParams.get("$format")).toBe("json");
  });

  it("does not send unsupported $top when reading configurations", async () => {
    const requests: URL[] = [];
    const client = new ContentClient(resolver(), async (input, init) => {
      expect(init?.method).toBeUndefined();
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify({ d: { results: [{ ParameterKey: "one" }, { ParameterKey: "two" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(client.configurations("iflow1", undefined, 1)).resolves.toEqual([{ ParameterKey: "one" }]);

    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe("/api/v1/IntegrationDesigntimeArtifacts(Id='iflow1',Version='active')/Configurations");
    expect(requests[0].searchParams.get("$format")).toBe("json");
    expect(requests[0].searchParams.has("$top")).toBe(false);
  });
});
