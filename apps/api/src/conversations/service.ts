import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage, ChatTool } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { ConversationPolicyService } from "../conversation-policy.js";
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

export class ConversationLimitError extends Error {
  constructor() {
    super("The configured conversation limit has been reached");
    this.name = "ConversationLimitError";
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
  rolledOver?: boolean;
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
  readonly #tools:
    { resolve(user: AuthenticatedUser): Promise<ChatTool[]> } | undefined;
  readonly #policy: ConversationPolicyService | undefined;

  constructor(
    repository: ConversationRepository,
    agent: ChatAgent,
    tools?: { resolve(user: AuthenticatedUser): Promise<ChatTool[]> },
    policy?: ConversationPolicyService,
  ) {
    this.#repository = repository;
    this.#agent = agent;
    this.#tools = tools;
    this.#policy = policy;
  }

  async create(user: AuthenticatedUser) {
    const limit = (await this.#policy?.get())?.maxConversationsPerUser ?? 50;
    const record = await this.#repository.create(user, limit);
    if (!record) throw new ConversationLimitError();
    return summary(record);
  }

  async list(user: AuthenticatedUser) {
    return (await this.#repository.list(user)).map(summary);
  }

  async delete(user: AuthenticatedUser, conversationId: string) {
    const result = await this.#repository.delete(user, conversationId);
    if (result === "not_found") throw new ConversationNotFoundError();
    if (result === "busy") throw new ConversationBusyError();
  }

  async improvePrompt(content: string) {
    try {
      const improvePrompt = (
        this.#agent as ChatAgent & {
          improvePrompt?: (draft: string) => Promise<string>;
        }
      ).improvePrompt;
      if (!improvePrompt) throw new Error("Prompt assistance is unavailable");
      return await improvePrompt.call(this.#agent, content);
    } catch (error) {
      throw new ModelInvocationError({ cause: error });
    }
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
    let rolledOver = false;
    try {
      messages = await this.#agent.sendMessage(
        acquisition.conversation.threadId,
        content,
        await this.#tools?.resolve(user),
      );
      const maxTurns = (await this.#policy?.get())?.maxRetainedTurns ?? 40;
      const trimOldestTurn = (
        this.#agent as ChatAgent & {
          trimOldestTurn?: (threadId: string, limit: number) => Promise<boolean>;
        }
      ).trimOldestTurn;
      rolledOver = trimOldestTurn
        ? await trimOldestTurn.call(
            this.#agent,
            acquisition.conversation.threadId,
            maxTurns,
          )
        : false;
      if (rolledOver) {
        messages = await this.#agent.getMessages(acquisition.conversation.threadId);
      }
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
    return { ...summary(updated), messages, rolledOver } satisfies ConversationDetail;
  }
}
