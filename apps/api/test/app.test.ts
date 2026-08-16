import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage } from "@flowpilot/agent-core";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ConversationService } from "../src/conversations/service.js";
import type {
  ConversationRecord,
  ConversationRepository,
  RunAcquisition,
} from "../src/conversations/types.js";
import type { AuthenticatedUser } from "../src/types.js";

const users: Record<string, AuthenticatedUser> = {
  a: {
    subject: "user-a",
    tenantId: "tenant-1",
    displayName: "User A",
    scopes: ["ChatUser"],
  },
  b: {
    subject: "user-b",
    tenantId: "tenant-1",
    displayName: "User B",
    scopes: ["ChatUser"],
  },
};

interface OwnedConversation extends ConversationRecord {
  tenantId: string;
  subject: string;
  activeRunId?: string;
}

class MemoryConversationRepository implements ConversationRepository {
  readonly records = new Map<string, OwnedConversation>();

  #owned(user: AuthenticatedUser, conversationId: string) {
    const record = this.records.get(conversationId);
    return record?.tenantId === user.tenantId && record.subject === user.subject
      ? record
      : undefined;
  }

  async create(user: AuthenticatedUser) {
    const now = new Date();
    const record: OwnedConversation = {
      id: randomUUID(),
      threadId: randomUUID(),
      title: "New conversation",
      tenantId: user.tenantId,
      subject: user.subject,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  async list(user: AuthenticatedUser) {
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === user.tenantId && record.subject === user.subject,
    );
  }

  async findOwned(user: AuthenticatedUser, conversationId: string) {
    return this.#owned(user, conversationId);
  }

  async acquireRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ): Promise<RunAcquisition> {
    const record = this.#owned(user, conversationId);
    if (!record) {
      return { status: "not_found" };
    }
    if (record.activeRunId) {
      return { status: "busy" };
    }
    record.activeRunId = runId;
    return { status: "acquired", conversation: record };
  }

  async completeRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
    title: string,
  ) {
    const record = this.#owned(user, conversationId);
    if (record?.activeRunId === runId) {
      record.title = record.title === "New conversation" ? title : record.title;
      record.updatedAt = new Date(record.updatedAt.getTime() + 1_000);
      record.activeRunId = undefined;
    }
  }

  async releaseRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ) {
    const record = this.#owned(user, conversationId);
    if (record?.activeRunId === runId) {
      record.activeRunId = undefined;
    }
  }
}

class FakeChatAgent implements ChatAgent {
  readonly messages = new Map<string, ChatMessage[]>();
  failNext = false;

  async getMessages(threadId: string) {
    return this.messages.get(threadId) ?? [];
  }

  async sendMessage(threadId: string, content: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Synthetic model failure");
    }
    const history = this.messages.get(threadId) ?? [];
    history.push(
      { id: randomUUID(), role: "user", content },
      {
        id: randomUUID(),
        role: "assistant",
        content: `Test response: ${content}`,
      },
    );
    this.messages.set(threadId, history);
    return history;
  }
}

const authentication: RequestHandler = (incoming, _response, next) => {
  const selected = incoming.header("x-test-user") ?? "a";
  incoming.flowpilotUser = users[selected] ?? users.a;
  next();
};

describe("FlowPilot API", () => {
  let app: ReturnType<typeof createApp>;
  let repository: MemoryConversationRepository;
  let agent: FakeChatAgent;

  beforeEach(() => {
    repository = new MemoryConversationRepository();
    agent = new FakeChatAgent();
    const conversations = new ConversationService(repository, agent);
    app = createApp({ authentication, conversations });
  });

  it("exposes an unauthenticated health endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "flowpilot-api" });
  });

  it("returns only the authenticated user's safe identity fields", async () => {
    const response = await request(app).get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      subject: "user-a",
      tenantId: "tenant-1",
      displayName: "User A",
      scopes: ["ChatUser"],
    });
  });

  it("creates a conversation and returns persisted model messages", async () => {
    const created = await request(app).post("/api/conversations");
    const conversationId = created.body.id as string;

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "New conversation" });

    const replied = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "Investigate order 42" });

    expect(replied.status).toBe(200);
    expect(replied.body.title).toBe("Investigate order 42");
    expect(replied.body.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Investigate order 42",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Test response: Investigate order 42",
      }),
    ]);

    const loaded = await request(app).get(
      `/api/conversations/${conversationId}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.messages).toEqual(replied.body.messages);
  });

  it("does not disclose or mutate another identity's conversation", async () => {
    const created = await request(app).post("/api/conversations");
    const conversationId = created.body.id as string;

    const listAsOtherUser = await request(app)
      .get("/api/conversations")
      .set("x-test-user", "b");
    const readAsOtherUser = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set("x-test-user", "b");
    const writeAsOtherUser = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-test-user", "b")
      .send({ content: "Attempted cross-user access" });

    expect(listAsOtherUser.body).toEqual({ conversations: [] });
    expect(readAsOtherUser.status).toBe(404);
    expect(readAsOtherUser.body).toEqual({ error: "not_found" });
    expect(writeAsOtherUser.status).toBe(404);
    expect(writeAsOtherUser.body).toEqual({ error: "not_found" });
  });

  it("rejects invalid identifiers and message payloads", async () => {
    const invalidId = await request(app).get("/api/conversations/not-a-uuid");
    expect(invalidId.status).toBe(400);

    const created = await request(app).post("/api/conversations");
    const invalidMessage = await request(app)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({ content: "", provider: "untrusted-browser-choice" });
    expect(invalidMessage.status).toBe(400);
    expect(invalidMessage.body).toEqual({ error: "invalid_request" });
  });

  it("returns safe client errors for malformed and oversized JSON", async () => {
    const malformed = await request(app)
      .post("/api/conversations")
      .set("content-type", "application/json")
      .send('{"incomplete"');
    const oversized = await request(app)
      .post("/api/conversations")
      .set("content-type", "application/json")
      .send(JSON.stringify({ content: "x".repeat(300_000) }));

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: "invalid_request" });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: "payload_too_large" });
  });

  it("returns a safe model error and releases the conversation for retry", async () => {
    const created = await request(app).post("/api/conversations");
    const conversationId = created.body.id as string;
    agent.failNext = true;

    const failed = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "First attempt" });
    const retried = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "Second attempt" });

    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: "model_unavailable" });
    expect(retried.status).toBe(200);
  });

  it("rejects concurrent runs for the same conversation", async () => {
    const created = await request(app).post("/api/conversations");
    const conversationId = created.body.id as string;
    const record = repository.records.get(conversationId);
    if (!record) {
      throw new Error("Expected test conversation");
    }
    record.activeRunId = randomUUID();

    const response = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "Overlapping attempt" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "conversation_busy" });
  });
});
