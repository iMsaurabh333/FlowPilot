import { createHash, randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
}

export interface ChatAgent {
  getMessages(threadId: string): Promise<ChatMessage[]>;
  sendMessage(threadId: string, content: string): Promise<ChatMessage[]>;
}

export interface ChatAgentOptions {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  systemPrompt?: string;
  maxContextMessages?: number;
}

const defaultSystemPrompt = `You are FlowPilot, a concise operational troubleshooting assistant.
State uncertainty clearly. Do not claim to have checked a system unless a tool result is present.
Do not invent transaction status, identifiers, logs, or remediation results.`;

function contentAsText(content: MessageContent) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("\n");
}

function stableMessageId(
  threadId: string,
  index: number,
  role: ChatMessageRole,
  content: string,
) {
  return createHash("sha256")
    .update(threadId)
    .update("\0")
    .update(String(index))
    .update("\0")
    .update(role)
    .update("\0")
    .update(content)
    .digest("hex");
}

function toChatMessage(
  message: BaseMessage,
  threadId: string,
  index: number,
): ChatMessage | undefined {
  const type = message.getType();
  const role =
    type === "human" ? "user" : type === "ai" ? "assistant" : undefined;
  if (!role) {
    return undefined;
  }
  const content = contentAsText(message.content);

  return {
    id: stableMessageId(threadId, index, role, content),
    role,
    content,
  };
}

export function createChatAgent(options: ChatAgentOptions): ChatAgent {
  const maxContextMessages = Math.max(2, options.maxContextMessages ?? 12);
  const systemPrompt = options.systemPrompt ?? defaultSystemPrompt;

  const callModel = async (
    state: typeof MessagesAnnotation.State,
    config: Parameters<BaseChatModel["invoke"]>[1],
  ) => {
    const recentMessages = state.messages.slice(-maxContextMessages);
    const response = await options.model.invoke(
      [new SystemMessage(systemPrompt), ...recentMessages],
      config,
    );
    response.id ??= randomUUID();
    return { messages: [response] };
  };

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("model", callModel)
    .addEdge(START, "model")
    .addEdge("model", END)
    .compile({ checkpointer: options.checkpointer });

  const graphConfig = (threadId: string) => ({
    configurable: { thread_id: threadId },
  });

  const readMessages = async (threadId: string) => {
    const snapshot = await graph.getState(graphConfig(threadId));
    const messages: BaseMessage[] = Array.isArray(snapshot.values.messages)
      ? (snapshot.values.messages as BaseMessage[])
      : [];
    return messages
      .map((message, index) => toChatMessage(message, threadId, index))
      .filter((message): message is ChatMessage => message !== undefined);
  };

  return {
    getMessages: readMessages,
    async sendMessage(threadId, content) {
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ id: randomUUID(), content: content.trim() }),
          ],
        },
        graphConfig(threadId),
      );
      return readMessages(threadId);
    },
  };
}
