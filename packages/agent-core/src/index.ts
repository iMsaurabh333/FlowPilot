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
  sentAt?: string;
  /** The request ended before an assistant response was persisted. */
  delivery?: "failed";
  /** A tool call failed, so its outcome could not be shown as evidence. */
  toolFailure?: string;
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
  ): Promise<ChatMessage[]>;
}

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Configured system display name for user-facing source labels. */
  systemName?: string;
  invoke(input: Record<string, unknown>): Promise<string>;
}

export interface ChatAgentOptions {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  systemPrompt?: string;
  maxContextMessages?: number;
  /** Apply the minimal-output policy for interactive conversations only. */
  compactResponses?: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = `You are FlowPilot, a concise operational troubleshooting assistant.
State uncertainty clearly. Do not claim to have checked a system unless a tool result is present.
Do not invent transaction status, identifiers, logs, or remediation results.
Tool-routing policy:
- Treat requests to look up, find, check, show, explain, or give details for an identifier as a lookup request, even when the user uses conversational wording.
- When a relevant read-only tool is available, invoke the tool before replying. Choose it from its name and description, using any named system (for example Jira, CPI, warehouse, or TMS) as a routing hint.
- Preserve identifiers exactly as supplied. Do not ask the user to restate an identifier that is already present.
- Examples: “check defect ID CPI-611889”, “give me details of defect ID CPI-611889 in Jira” are all lookup requests and must use the matching available tool.
- If no relevant tool is available, say that the requested system is unavailable; do not infer the result from the wording alone.

${FLOWPILOT_PROMPT_GUIDELINES}`;

const compactResponsePrompt = `
When a tool returns structured evidence, return no narrative text: FlowPilot renders the evidence itself.
For a failed, empty, or unavailable lookup, guidance is optional and may contain at most two sentences of 30 characters each. Do not add explanations, lists, headings, tables, or next-step prose.`;

const MAX_GUIDANCE_SENTENCES = 2;
const MAX_GUIDANCE_SENTENCE_LENGTH = 30;

/** Enforce the chat's compact guidance contract even when a model ignores it. */
function compactGuidance(content: string) {
  return content
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^\s*[|*#>-]+\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .match(/[^.!?]+[.!?]?/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, MAX_GUIDANCE_SENTENCES)
    .map((sentence) => {
      if (sentence.length <= MAX_GUIDANCE_SENTENCE_LENGTH) return sentence;
      return `${sentence.slice(0, MAX_GUIDANCE_SENTENCE_LENGTH - 1).trimEnd()}.`;
    })
    .filter(Boolean)
    .join(" ") ?? "";
}

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
  contentOverride?: string,
): ChatMessage | undefined {
  const type = message.getType();
  const role =
    type === "human" ? "user" : type === "ai" ? "assistant" : undefined;
  if (!role) {
    return undefined;
  }
  const content = contentOverride ?? contentAsText(message.content);
  // Tool-call requests are AI messages with no user-facing text. They stay in
  // the checkpoint for the model, but are not rendered as chat bubbles.
  if (role === "assistant" && content.trim().length === 0 && contentOverride === undefined) {
    return undefined;
  }

  return {
    id: stableMessageId(threadId, index, role, content),
    role,
    content,
    sentAt: typeof message.additional_kwargs?.sentAt === "string" ? message.additional_kwargs.sentAt : undefined,
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
        safeTableCell(record.integrationFlowName) ?? safeTableCell(record.integrationFlowId),
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

function structuredItemsTable(content: MessageContent): ChatTable | undefined {
  try {
    const parsed = JSON.parse(contentAsText(content)) as { items?: unknown };
    if (!Array.isArray(parsed.items) || parsed.items.length === 0 || !parsed.items.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) return undefined;
    const columns = [...new Set(parsed.items.flatMap((item) => Object.keys(item as Record<string, unknown>)))].slice(0, 8);
    if (!columns.length) return undefined;
    return {
      title: "Result",
      columns,
      rows: parsed.items.slice(0, 50).map((item) => columns.map((column) => {
        const value = (item as Record<string, unknown>)[column];
        return value === null || value === undefined ? null : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value).slice(0, 500);
      })),
    };
  } catch { return undefined; }
}

export function createChatAgent(options: ChatAgentOptions): ChatAgent {
  const maxContextMessages = Math.max(2, options.maxContextMessages ?? 12);
  const systemPrompt =
    options.systemPrompt ??
    `${DEFAULT_SYSTEM_PROMPT}${options.compactResponses ? compactResponsePrompt : ""}`;

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
      // Keep the checkpoint as compact as the UI. This prevents an ignored
      // prompt instruction from becoming repeated input-token overhead on
      // later conversation turns.
      const requestedTool = Array.isArray(
        (response as { tool_calls?: unknown }).tool_calls,
      ) && (response as { tool_calls: unknown[] }).tool_calls.length > 0;
      if (options.compactResponses && !requestedTool) {
        const hasStructuredEvidence = recentMessages.some(
          (message) =>
            message.getType() === "tool" &&
            Boolean(messageProcessingLogsTable(toolName(message) ?? "", message.content) ?? structuredItemsTable(message.content)),
        );
        response.content = hasStructuredEvidence
          ? ""
          : compactGuidance(contentAsText(response.content));
      }
      response.id ??= randomUUID();
      response.additional_kwargs = { ...response.additional_kwargs, sentAt: new Date().toISOString() };
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

  const readMessages = async (threadId: string, sourceGraph = graph) => {
    const snapshot = await sourceGraph.getState(graphConfig(threadId));
    const messages: BaseMessage[] = Array.isArray(snapshot.values.messages)
      ? (snapshot.values.messages as BaseMessage[])
      : [];
    const pendingToolOutputs: Array<{ name: string; table?: ChatTable; failed?: boolean }> = [];
    const chatMessages: ChatMessage[] = [];
    messages.forEach((message, index) => {
      if (message.getType() === "tool") {
        const name = toolName(message);
        if (name) {
          const content = contentAsText(message.content);
          pendingToolOutputs.push({
            name,
            table: messageProcessingLogsTable(name, message.content) ?? structuredItemsTable(message.content),
            failed: /^Error:/iu.test(content) || /^MCP tool (?:did not return|returned no)/iu.test(content),
          });
        }
        return;
      }
      const tables = pendingToolOutputs.flatMap(({ table }) =>
        table ? [table] : [],
      );
      // Structured evidence is rendered directly; discard model prose.
      // Otherwise only compact, bounded guidance may reach the UI.
      const compacted = compactGuidance(contentAsText(message.content));
      const contentOverride =
        message.getType() !== "ai" || !options.compactResponses
          ? undefined
          : tables.length > 0
            ? ""
            : compacted || undefined;
      const chatMessage = toChatMessage(
        message,
        threadId,
        index,
        contentOverride,
      );
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
        chatMessage.sources = sources;
        if (tables.length > 0) chatMessage.tables = tables;
        if (pendingToolOutputs.some((output) => output.failed)) {
          chatMessage.toolFailure = "A tool lookup failed; no evidence was returned for it.";
        }
        pendingToolOutputs.length = 0;
      }
      chatMessages.push(chatMessage);
    });
    // Some tool-capable models stop immediately after a successful tool call
    // when the compact-response policy tells them that no prose is needed.
    // Preserve the evidence as a real assistant turn instead of presenting a
    // successful lookup as an incomplete user request.
    if (pendingToolOutputs.length > 0) {
      const sources = pendingToolOutputs.map(({ name }) => toolSource(name));
      const uniqueSources = sources.filter(
        ({ label }, index) => sources.findIndex((source) => source.label === label) === index,
      );
      const tables = pendingToolOutputs.flatMap(({ table }) => (table ? [table] : []));
      const failed = pendingToolOutputs.some((output) => output.failed);
      const index = messages.length;
      chatMessages.push({
        id: stableMessageId(threadId, index, "assistant", tables.length ? "" : failed ? "Tool result unavailable." : "No matching records were returned."),
        role: "assistant",
        content: tables.length ? "" : failed ? "Tool result unavailable." : "No matching records were returned.",
        sentAt: new Date().toISOString(),
        sources: uniqueSources,
        ...(tables.length ? { tables } : {}),
        ...(failed ? { toolFailure: "A tool lookup failed; no evidence was returned for it." } : {}),
      });
      pendingToolOutputs.length = 0;
    }
    // A failed model or MCP call can occur after the human message is saved in
    // the checkpoint. Always supply an assistant turn for that case. This is
    // deliberately reconstructed at read time so it also repairs existing
    // conversations that contain an orphaned user message.
    const latest = chatMessages.at(-1);
    if (latest?.role === "user") {
      const asksForJira = /\bjira\b/iu.test(latest.content);
      const content = asksForJira
        ? "I couldn’t complete the Jira lookup because the Jira tool could not be selected for this response. Check that Mock Jira is enabled and healthy, then try again."
        : "I couldn’t complete that request because no assistant response was produced. Please try again.";
      chatMessages.push({
        id: stableMessageId(threadId, messages.length, "assistant", content),
        role: "assistant",
        content,
        sentAt: latest.sentAt,
      });
    }
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
    const removals = messages.slice(0, end).flatMap((message) =>
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
    async sendMessage(threadId, content, tools) {
      const invocationGraph = tools?.length ? createGraph(tools) : graph;
      await invocationGraph.invoke(
        {
          messages: [
            new HumanMessage({ id: randomUUID(), content: content.trim(), additional_kwargs: { sentAt: new Date().toISOString() } }),
          ],
        },
        graphConfig(threadId),
      );
      // The tool set is request-specific. Read the checkpoint through the
      // same compiled graph that executed this request so its tool outputs
      // and the following assistant turn are available to the conversation.
      return readMessages(threadId, invocationGraph);
    },
  };
}
