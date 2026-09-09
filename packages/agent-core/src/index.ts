import { createHash, randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage,
  RemoveMessage,
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
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { tool } from "@langchain/core/tools";
import { FLOWPILOT_PROMPT_GUIDELINES } from "./prompt-guidelines.js";

export type ChatMessageRole = "user" | "assistant";

export interface ChatSource {
  label: string;
}

export interface ChatTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | null>>;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  sources?: ChatSource[];
  tables?: ChatTable[];
}

export interface ChatAgent {
  getMessages(threadId: string): Promise<ChatMessage[]>;
  trimOldestTurn(threadId: string, maxTurns: number): Promise<boolean>;
  improvePrompt(content: string): Promise<string>;
  sendMessage(
    threadId: string,
    content: string,
    tools?: ChatTool[],
    ephemeralContext?: string,
  ): Promise<ChatMessage[]>;
}

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke(input: Record<string, unknown>): Promise<string>;
}

export interface ChatAgentOptions {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  systemPrompt?: string;
  maxContextMessages?: number;
}

export const DEFAULT_SYSTEM_PROMPT = `You are FlowPilot, a concise operational troubleshooting assistant.
State uncertainty clearly. Do not claim to have checked a system unless a tool result is present.
Do not invent transaction status, identifiers, logs, or remediation results.

${FLOWPILOT_PROMPT_GUIDELINES}`;

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
  // Tool-call requests are AI messages with no user-facing text. They stay in
  // the checkpoint for the model, but are not rendered as chat bubbles.
  if (role === "assistant" && content.trim().length === 0) {
    return undefined;
  }

  return {
    id: stableMessageId(threadId, index, role, content),
    role,
    content,
  };
}

function toolName(message: BaseMessage): string | undefined {
  const name = (message as BaseMessage & { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function toolSource(name: string): ChatSource {
  if (name.endsWith("search_message_processing_logs")) {
    return { label: "Cloud Integration monitoring · Message Processing Logs" };
  }
  return { label: `MCP tool: ${name.replaceAll("_", " ")}` };
}

function safeTableCell(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length <= 4_000 ? value : undefined;
}

function messageProcessingLogsTable(
  name: string,
  content: MessageContent,
): ChatTable | undefined {
  if (!name.endsWith("search_message_processing_logs")) return undefined;
  const text = contentAsText(content);
  try {
    const payload = JSON.parse(text) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("items" in payload) ||
      !Array.isArray(payload.items)
    ) {
      return undefined;
    }
    const rows = payload.items.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const row = [
        safeTableCell(record.messageId),
        safeTableCell(record.status),
        safeTableCell(record.integrationFlowName) ??
          safeTableCell(record.integrationFlowId),
        safeTableCell(record.startedAt),
      ];
      if (row.some((cell) => cell === undefined)) return [];
      return [[row[0]!, row[1]!, row[2]!, row[3]!]];
    });
    if (rows.length === 0) return undefined;
    return {
      title: "Message Processing Logs",
      columns: ["Message ID", "Status", "Integration flow", "Started"],
      rows,
    };
  } catch {
    return undefined;
  }
}

export function createChatAgent(options: ChatAgentOptions): ChatAgent {
  const maxContextMessages = Math.max(2, options.maxContextMessages ?? 12);
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const createGraph = (chatTools: ChatTool[] = []) => {
    const langChainTools = chatTools.map((chatTool) =>
      tool(chatTool.invoke, {
        name: chatTool.name,
        description: chatTool.description,
        schema: chatTool.inputSchema,
      }),
    );
    const model =
      langChainTools.length === 0
        ? options.model
        : options.model.bindTools?.(langChainTools);
    if (!model) {
      throw new Error("Configured model does not support tool invocation");
    }
    const callModel = async (
      state: typeof MessagesAnnotation.State,
      config: Parameters<BaseChatModel["invoke"]>[1],
    ) => {
      const recentMessages = state.messages.slice(-maxContextMessages);
      const response = await model.invoke(
        [new SystemMessage(systemPrompt), ...recentMessages],
        config,
      );
      response.id ??= randomUUID();
      return { messages: [response] };
    };
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("model", callModel)
      .addEdge(START, "model");
    if (langChainTools.length === 0) {
      graph.addEdge("model", END);
    } else {
      graph
        .addNode(
          "tools",
          new ToolNode(langChainTools, { handleToolErrors: true }),
        )
        .addConditionalEdges("model", toolsCondition, ["tools", END])
        .addEdge("tools", "model");
    }
    return graph.compile({ checkpointer: options.checkpointer });
  };

  const graph = createGraph();

  const graphConfig = (threadId: string) => ({
    configurable: { thread_id: threadId },
  });

  const readMessages = async (threadId: string) => {
    const snapshot = await graph.getState(graphConfig(threadId));
    const messages: BaseMessage[] = Array.isArray(snapshot.values.messages)
      ? (snapshot.values.messages as BaseMessage[])
      : [];
    const pendingToolOutputs: Array<{ name: string; table?: ChatTable }> = [];
    const chatMessages: ChatMessage[] = [];
    messages.forEach((message, index) => {
      if (message.getType() === "tool") {
        const name = toolName(message);
        if (name) {
          pendingToolOutputs.push({
            name,
            table: messageProcessingLogsTable(name, message.content),
          });
        }
        return;
      }
      const chatMessage = toChatMessage(message, threadId, index);
      if (!chatMessage) return;
      if (chatMessage.role === "assistant" && pendingToolOutputs.length > 0) {
        const sourceLabels = new Set<string>();
        const sources = pendingToolOutputs
          .map(({ name }) => toolSource(name))
          .filter(({ label }) => {
            if (sourceLabels.has(label)) return false;
            sourceLabels.add(label);
            return true;
          });
        const tables = pendingToolOutputs.flatMap(({ table }) =>
          table ? [table] : [],
        );
        chatMessage.sources = sources;
        if (tables.length > 0) chatMessage.tables = tables;
        pendingToolOutputs.length = 0;
      }
      chatMessages.push(chatMessage);
    });
    return chatMessages;
  };

  const trimOldestTurn = async (threadId: string, maxTurns: number) => {
    const snapshot = await graph.getState(graphConfig(threadId));
    const messages: BaseMessage[] = Array.isArray(snapshot.values.messages)
      ? (snapshot.values.messages as BaseMessage[])
      : [];
    const humanIndexes = messages
      .map((message, index) => (message.getType() === "human" ? index : -1))
      .filter((index) => index >= 0);
    if (humanIndexes.length <= maxTurns) return false;
    const end = humanIndexes[1] ?? messages.length;
    const removals = messages
      .slice(0, end)
      .flatMap((message) =>
        message.id ? [new RemoveMessage({ id: message.id })] : [],
      );
    if (removals.length === 0) return false;
    await graph.updateState(graphConfig(threadId), { messages: removals });
    return true;
  };

  return {
    getMessages: readMessages,
    trimOldestTurn,
    async improvePrompt(content) {
      const response = await options.model.invoke([
        new SystemMessage(
          "Rewrite the user's operational request for clarity. Preserve stated facts, do not invent identifiers or results, and return only the improved request.",
        ),
        new HumanMessage(content.trim()),
      ]);
      return contentAsText(response.content).trim().slice(0, 4_000);
    },
    async sendMessage(threadId, content, tools, ephemeralContext) {
      const invocationGraph = tools?.length ? createGraph(tools) : graph;
      const contextMessage = ephemeralContext?.trim()
        ? new SystemMessage({
            id: randomUUID(),
            content: ephemeralContext.trim(),
          })
        : undefined;
      await invocationGraph.invoke(
        {
          messages: [
            new HumanMessage({ id: randomUUID(), content: content.trim() }),
            ...(contextMessage ? [contextMessage] : []),
          ],
        },
        graphConfig(threadId),
      );
      if (contextMessage?.id) {
        await invocationGraph.updateState(graphConfig(threadId), {
          messages: [new RemoveMessage({ id: contextMessage.id })],
        });
      }
      return readMessages(threadId);
    },
  };
}
