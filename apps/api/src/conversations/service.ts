import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { ConversationRecord, ConversationRepository } from "./types.js";

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation not found");
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationBusyError extends Error {
  constructor() {
    super("Conversation already has an active run");
    this.name = "ConversationBusyError";
  }
}

export class ModelInvocationError extends Error {
  constructor(options?: ErrorOptions) {
    super("The configured model could not complete the request", options);
    this.name = "ModelInvocationError";
  }
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

function summary(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function conversationTitle(content: string) {
  const firstLine = content.trim().split(/\r?\n/, 1)[0];
  return firstLine.slice(0, 80) || "New conversation";
}

export class ConversationService {
  readonly #repository: ConversationRepository;
  readonly #agent: ChatAgent;

  constructor(repository: ConversationRepository, agent: ChatAgent) {
    this.#repository = repository;
    this.#agent = agent;
  }

  async create(user: AuthenticatedUser) {
    return summary(await this.#repository.create(user));
  }

  async list(user: AuthenticatedUser) {
    return (await this.#repository.list(user)).map(summary);
  }

  async get(user: AuthenticatedUser, conversationId: string) {
    const record = await this.#repository.findOwned(user, conversationId);
    if (!record) {
      throw new ConversationNotFoundError();
    }
    return {
      ...summary(record),
      messages: await this.#agent.getMessages(record.threadId),
    } satisfies ConversationDetail;
  }

  async sendMessage(
    user: AuthenticatedUser,
    conversationId: string,
    content: string,
  ) {
    const runId = randomUUID();
    const acquisition = await this.#repository.acquireRun(
      user,
      conversationId,
      runId,
    );
    if (acquisition.status === "not_found") {
      throw new ConversationNotFoundError();
    }
    if (acquisition.status === "busy") {
      throw new ConversationBusyError();
    }

    let messages: ChatMessage[];
    try {
      messages = await this.#agent.sendMessage(
        acquisition.conversation.threadId,
        content,
      );
    } catch (error) {
      try {
        await this.#repository.releaseRun(user, conversationId, runId);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "The model run and conversation lock release both failed",
        );
      }
      throw new ModelInvocationError({ cause: error });
    }

    await this.#repository.completeRun(
      user,
      conversationId,
      runId,
      conversationTitle(content),
    );
    const updated = await this.#repository.findOwned(user, conversationId);
    if (!updated) {
      throw new ConversationNotFoundError();
    }
    return { ...summary(updated), messages } satisfies ConversationDetail;
  }
}
