import { FakeListChatModel } from "@langchain/core/utils/testing";
import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { createChatAgent } from "../src/index.js";

describe("FlowPilot chat graph", () => {
  it("persists independent message histories by server thread id", async () => {
    const agent = createChatAgent({
      checkpointer: new MemorySaver(),
      model: new FakeListChatModel({
        responses: ["First answer", "Second answer", "Other thread answer"],
      }),
    });

    await agent.sendMessage("thread-a", "First question");
    await agent.sendMessage("thread-a", "Second question");
    await agent.sendMessage("thread-b", "Other question");

    const firstRead = await agent.getMessages("thread-a");
    const secondRead = await agent.getMessages("thread-a");

    expect(firstRead).toEqual([
      expect.objectContaining({ role: "user", content: "First question" }),
      expect.objectContaining({ role: "assistant", content: "First answer" }),
      expect.objectContaining({ role: "user", content: "Second question" }),
      expect.objectContaining({ role: "assistant", content: "Second answer" }),
    ]);
    expect(secondRead.map((message) => message.id)).toEqual(
      firstRead.map((message) => message.id),
    );
    expect(new Set(firstRead.map((message) => message.id)).size).toBe(
      firstRead.length,
    );
    expect(await agent.getMessages("thread-b")).toEqual([
      expect.objectContaining({ role: "user", content: "Other question" }),
      expect.objectContaining({
        role: "assistant",
        content: "Other thread answer",
      }),
    ]);
  });

  it("runs only the per-request registered namespaced tools", async () => {
    const invoked: Record<string, unknown>[] = [];
    const model = fakeModel()
      .respondWithTools([
        { name: "monitoring__search_logs", args: { query: "failed" } },
      ])
      .respond(
        new AIMessage("The approved monitoring tool found no failures."),
      );
    const agent = createChatAgent({ checkpointer: new MemorySaver(), model });

    const messages = await agent.sendMessage("operator-thread", "Check logs", [
      {
        name: "monitoring__search_logs",
        description: "Search approved monitoring logs.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        async invoke(input) {
          invoked.push(input);
          return "No failures";
        },
      },
    ]);

    expect(invoked).toEqual([{ query: "failed" }]);
    expect(messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "The approved monitoring tool found no failures.",
      }),
    );
  });
});
