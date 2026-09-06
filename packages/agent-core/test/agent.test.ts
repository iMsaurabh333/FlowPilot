import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { createChatAgent, estimateMessagesTokens } from "../src/index.js";

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

  it("bounds model context while preserving the full conversation history", async () => {
    const model = new FakeListChatModel({
      responses: Array.from({ length: 10 }, () => "Short answer"),
    });
    const invokeSpy = vi.spyOn(model, "invoke");
    const agent = createChatAgent({
      checkpointer: new MemorySaver(),
      maxContextTokens: 2_000,
      maxSummaryTokens: 128,
      model,
    });

    for (let index = 0; index < 10; index += 1) {
      await agent.sendMessage(
        "thread-a",
        `Question ${index} ${"x".repeat(900)}`,
      );
    }

    const lastPrompt = invokeSpy.mock.calls.at(-1)?.[0];
    expect(Array.isArray(lastPrompt)).toBe(true);
    expect(estimateMessagesTokens(lastPrompt as never[])).toBeLessThan(2_200);
    expect(
      (lastPrompt as Array<{ getType(): string; content: unknown }>).some(
        (message) =>
          message.getType() === "system" &&
          String(message.content).includes("untrusted prior conversation"),
      ),
    ).toBe(true);
    expect(await agent.getMessages("thread-a")).toHaveLength(20);
  });

  it("reports content-free model usage telemetry", async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = createChatAgent({
      checkpointer: new MemorySaver(),
      model: new FakeListChatModel({ responses: ["Answer"] }),
      provider: "groq",
      modelName: "test-model",
      onModelRun: (event) => events.push(event),
    });

    await agent.sendMessage("thread-a", "Question");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "groq",
      model: "test-model",
      status: "succeeded",
    });
    expect(events[0]).not.toHaveProperty("prompt");
    expect(events[0]).not.toHaveProperty("response");
  });
});
