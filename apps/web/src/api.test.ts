import { describe, expect, it, vi } from "vitest";

import { loadCurrentUser } from "./api";

describe("loadCurrentUser", () => {
  it("returns the authenticated user payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          subject: "user-123",
          tenantId: "tenant-456",
          displayName: "Test User",
          scopes: ["ChatUser"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(loadCurrentUser(fetcher)).resolves.toMatchObject({
      subject: "user-123",
      scopes: ["ChatUser"],
    });
  });
});
