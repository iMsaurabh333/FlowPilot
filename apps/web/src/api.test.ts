import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient, loadCurrentUser } from "./api";

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("loadCurrentUser", () => {
  it("returns the authenticated user payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        subject: "user-123",
        tenantId: "tenant-456",
        displayName: "Test User",
        scopes: ["ChatUser"],
      }),
    );

    await expect(loadCurrentUser(fetcher)).resolves.toMatchObject({
      subject: "user-123",
      scopes: ["ChatUser"],
    });

    expect(fetcher).toHaveBeenCalledWith("/api/me", {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": "Fetch",
      },
    });
  });

  it("uses the AppRouter CSRF token for state-changing requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            subject: "user-123",
            tenantId: "tenant-456",
            scopes: ["ChatUser"],
          },
          200,
          { "X-CSRF-Token": "csrf-123" },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: "conversation-1",
            title: "New conversation",
            createdAt: "2026-08-17T08:00:00.000Z",
            updatedAt: "2026-08-17T08:00:00.000Z",
          },
          201,
        ),
      );
    const client = createApiClient(fetcher);

    await client.loadCurrentUser();
    await client.createConversation();

    const [, createOptions] = fetcher.mock.calls[1];
    expect(createOptions?.method).toBe("POST");
    expect(new Headers(createOptions?.headers).get("x-csrf-token")).toBe(
      "csrf-123",
    );
  });

  it("refreshes an expired CSRF token and retries once", async () => {
    const created = {
      id: "conversation-1",
      title: "New conversation",
      createdAt: "2026-08-17T08:00:00.000Z",
      updatedAt: "2026-08-17T08:00:00.000Z",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({}, 200, { "X-CSRF-Token": "expired-token" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "forbidden" }, 403, {
          "X-CSRF-Token": "Required",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({}, 200, { "X-CSRF-Token": "fresh-token" }),
      )
      .mockResolvedValueOnce(jsonResponse(created, 201));

    await expect(
      createApiClient(fetcher).createConversation(),
    ).resolves.toEqual(created);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [, retryOptions] = fetcher.mock.calls[3];
    expect(new Headers(retryOptions?.headers).get("x-csrf-token")).toBe(
      "fresh-token",
    );
  });

  it("returns typed safe API errors without exposing response text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: "model_unavailable", detail: "private" }, 502),
      );

    const error = await createApiClient(fetcher)
      .loadConversation("conversation-1")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "model_unavailable" });
    expect((error as Error).message).not.toContain("private");
  });

  it("encodes conversation identifiers and serializes only message content", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({}, 200, { "X-CSRF-Token": "csrf-123" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "conversation-1",
          title: "Test",
          createdAt: "2026-08-17T08:00:00.000Z",
          updatedAt: "2026-08-17T08:00:00.000Z",
          messages: [],
        }),
      );

    await createApiClient(fetcher).sendMessage("id/with spaces", "Check 42");

    const [path, options] = fetcher.mock.calls[1];
    expect(path).toBe("/api/conversations/id%2Fwith%20spaces/messages");
    expect(options?.body).toBe(JSON.stringify({ content: "Check 42" }));
  });
});
