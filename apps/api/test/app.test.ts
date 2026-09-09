import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage } from "@flowpilot/agent-core";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { ConversationPolicyService } from "../src/conversation-policy.js";
import { ConversationService } from "../src/conversations/service.js";
import type {
  ConversationRecord,
  ConversationRepository,
  RunAcquisition,
} from "../src/conversations/types.js";
import type { AuthenticatedUser } from "../src/types.js";
import { ReportJobService } from "../src/reports/service.js";
import type { ReportJobRecord, ReportJobRepository } from "../src/reports/types.js";

const users: Record<string, AuthenticatedUser> = {
  a: {
    subject: "user-a",
    tenantId: "tenant-1",
    displayName: "User A",
    scopes: ["ChatUser", "ToolOperator"],
  },
  b: {
    subject: "user-b",
    tenantId: "tenant-1",
    displayName: "User B",
    scopes: ["ChatUser", "ToolOperator"],
  },
  admin: {
    subject: "admin",
    tenantId: "tenant-1",
    displayName: "Admin",
    scopes: ["ChatUser", "ChatAdmin"],
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

  async create(user: AuthenticatedUser, maxConversations: number) {
    const ownedCount = [...this.records.values()].filter(
      (record) => record.tenantId === user.tenantId && record.subject === user.subject,
    ).length;
    if (ownedCount >= maxConversations) return undefined;
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

  async delete(user: AuthenticatedUser, conversationId: string) {
    const record = this.#owned(user, conversationId);
    if (!record) return "not_found" as const;
    if (record.activeRunId) return "busy" as const;
    this.records.delete(conversationId);
    return "deleted" as const;
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

  async improvePrompt(content: string) {
    return `Improved: ${content}`;
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

class MemoryReportJobRepository implements ReportJobRepository {
  readonly records = new Map<string, ReportJobRecord & { tenantId: string; subject: string; activeRunId?: string }>();

  async create(user: AuthenticatedUser, input: { title: string; reportPrompt: string; scheduledFor: Date; recurrenceRule?: string | null }) {
    const now = new Date();
    const record = { id: randomUUID(), ...input, recurrenceRule: input.recurrenceRule ?? null, tenantId: user.tenantId, subject: user.subject, status: "scheduled" as const, attemptCount: 0, finalReportHtml: null, errorLog: null, startedAt: null, completedAt: null, createdAt: now, updatedAt: now };
    this.records.set(record.id, record);
    return record;
  }

  async list(user: AuthenticatedUser) { return [...this.records.values()].filter((record) => record.tenantId === user.tenantId && record.subject === user.subject); }
  async findOwned(user: AuthenticatedUser, id: string) { const record = this.records.get(id); return record?.tenantId === user.tenantId && record.subject === user.subject ? record : undefined; }
  async acquireRun(user: AuthenticatedUser, id: string, runId: string) { const record = await this.findOwned(user, id); if (!record) return { status: "not_found" as const }; if (record.activeRunId) return { status: "busy" as const }; record.activeRunId = runId; record.status = "running"; return { status: "acquired" as const, job: record }; }
  async acquireScheduledRun(id: string, runId: string) { const record = this.records.get(id); if (!record) return { status: "not_found" as const }; if (record.activeRunId) return { status: "busy" as const }; record.activeRunId = runId; record.status = "running"; return { status: "acquired" as const, job: record, user: { tenantId: record.tenantId, subject: record.subject, scopes: ["ChatUser"] } }; }
  async completeRun() { /* execution is covered by report-job-service tests */ }
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
  let conversationPolicy: ConversationPolicyService;
  let reportJobs: MemoryReportJobRepository;

  beforeEach(() => {
    repository = new MemoryConversationRepository();
    agent = new FakeChatAgent();
    let policy = { maxConversationsPerUser: 50, maxRetainedTurns: 40 };
    conversationPolicy = {
      async get() { return policy; },
      async update(input) { policy = input; return policy; },
    };
    const conversations = new ConversationService(
      repository,
      agent,
      undefined,
      conversationPolicy,
    );
    reportJobs = new MemoryReportJobRepository();
    app = createApp({ authentication, conversations, conversationPolicy, reports: new ReportJobService(reportJobs, { async execute() { return { html: "<h1>Test report</h1>" }; } }), schedulerAuthentication: (_request, _response, next) => next() });
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
      scopes: ["ChatUser", "ToolOperator"],
    });
  });

  it("lets administrators read and update conversation retention limits", async () => {
    const forbidden = await request(app).get("/api/admin/conversation-policy");
    expect(forbidden.status).toBe(403);

    const read = await request(app)
      .get("/api/admin/conversation-policy")
      .set("x-test-user", "admin");
    expect(read.body).toEqual({ maxConversationsPerUser: 50, maxRetainedTurns: 40 });

    const update = await request(app)
      .put("/api/admin/conversation-policy")
      .set("x-test-user", "admin")
      .send({ maxConversationsPerUser: 75, maxRetainedTurns: 60 });
    expect(update.body).toEqual({ maxConversationsPerUser: 75, maxRetainedTurns: 60 });
  });

  it("enforces the configured conversation limit per authenticated user", async () => {
    await conversationPolicy.update({ maxConversationsPerUser: 1, maxRetainedTurns: 40 });
    expect((await request(app).post("/api/conversations")).status).toBe(201);

    const limited = await request(app).post("/api/conversations");
    expect(limited.status).toBe(409);
    expect(limited.body).toEqual({ error: "conversation_limit_reached" });
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

  it("improves an authenticated draft without creating a conversation", async () => {
    const response = await request(app)
      .post("/api/prompt-assist")
      .send({ content: "order 42 status" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ content: "Improved: order 42 status" });
  });

  it("creates and lists only the authenticated user's report jobs", async () => {
    const created = await request(app).post("/api/reports/jobs").send({
      title: "Morning integration summary",
      reportPrompt: "Summarize final status.",
      scheduledFor: "2026-09-10T08:00:00.000Z",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Morning integration summary", status: "scheduled" });

    const owned = await request(app).get("/api/reports/jobs");
    const other = await request(app).get("/api/reports/jobs").set("x-test-user", "b");
    expect(owned.body.jobs).toHaveLength(1);
    expect(other.body).toEqual({ jobs: [] });
  });

  it("requires an owned scheduled report job before it can run", async () => {
    const created = await request(app).post("/api/reports/jobs").send({
      title: "Run now report",
      reportPrompt: "Summarize final status.",
      scheduledFor: "2026-09-10T08:00:00.000Z",
    });

    const started = await request(app).post(`/api/reports/jobs/${created.body.id}/run`);
    const otherUser = await request(app).post(`/api/reports/jobs/${created.body.id}/run`).set("x-test-user", "b");
    expect(started.status).toBe(200);
    expect(otherUser.status).toBe(404);
  });

  it("accepts only a report-job identifier from the scheduler callback", async () => {
    const created = await request(app).post("/api/reports/jobs").send({ title: "Scheduled callback report", reportPrompt: "Summarize final status.", scheduledFor: "2026-09-10T08:00:00.000Z" });
    const dispatched = await request(app).post("/internal/reports/dispatch").send({ reportJobId: created.body.id });
    const invalid = await request(app).post("/internal/reports/dispatch").send({ reportJobId: created.body.id, reportPrompt: "do not accept prompts" });
    expect(dispatched.status).toBe(204);
    expect(invalid.status).toBe(400);
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
    const deleteAsOtherUser = await request(app)
      .delete(`/api/conversations/${conversationId}`)
      .set("x-test-user", "b");

    expect(listAsOtherUser.body).toEqual({ conversations: [] });
    expect(readAsOtherUser.status).toBe(404);
    expect(readAsOtherUser.body).toEqual({ error: "not_found" });
    expect(writeAsOtherUser.status).toBe(404);
    expect(writeAsOtherUser.body).toEqual({ error: "not_found" });
    expect(deleteAsOtherUser.status).toBe(404);
    expect(deleteAsOtherUser.body).toEqual({ error: "not_found" });
    expect(repository.records.has(conversationId)).toBe(true);
  });

  it("deletes an owned idle conversation", async () => {
    const created = await request(app).post("/api/conversations");

    const deleted = await request(app).delete(
      `/api/conversations/${created.body.id}`,
    );
    const loaded = await request(app).get(
      `/api/conversations/${created.body.id}`,
    );

    expect(deleted.status).toBe(204);
    expect(loaded.status).toBe(404);
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

  it("does not delete a conversation with an active run", async () => {
    const created = await request(app).post("/api/conversations");
    const record = repository.records.get(created.body.id);
    if (!record) throw new Error("Expected test conversation");
    record.activeRunId = randomUUID();

    const response = await request(app).delete(
      `/api/conversations/${created.body.id}`,
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "conversation_busy" });
    expect(repository.records.has(created.body.id)).toBe(true);
  });
});
