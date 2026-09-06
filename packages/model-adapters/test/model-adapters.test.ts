import { describe, expect, it } from "vitest";

import {
  createChatModel,
  loadModelConfig,
  ModelConfigurationError,
} from "../src/index.js";

describe("model adapter configuration", () => {
  it("defaults to the approved Groq production model", () => {
    expect(loadModelConfig({})).toEqual({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      maxOutputTokens: 1024,
      maxContextTokens: 6_000,
      maxSummaryTokens: 512,
      timeoutMs: 30_000,
      maxRetries: 2,
      reasoningEffort: "medium",
      verbosity: "low",
    });
  });

  it("uses GPT-5.6 Terra as the OpenAI default", () => {
    expect(loadModelConfig({ MODEL_PROVIDER: "openai" })).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      verbosity: "low",
    });
  });

  it("requires an explicit model when another provider is selected", () => {
    expect(() => loadModelConfig({ MODEL_PROVIDER: "anthropic" })).toThrow(
      ModelConfigurationError,
    );
  });

  it.each([
    ["groq", "llama-3.3-70b-versatile"],
    ["openai", "configured-openai-model"],
    ["anthropic", "configured-anthropic-model"],
  ] as const)("creates the installed %s adapter", (provider, model) => {
    const chatModel = createChatModel(
      loadModelConfig({ MODEL_PROVIDER: provider, MODEL_NAME: model }),
      { [provider]: "test-only-placeholder" },
    );

    expect(chatModel).toBeDefined();
  });

  it("fails closed when the selected provider credential is missing", () => {
    const config = loadModelConfig({});
    expect(() => createChatModel(config, {})).toThrow(ModelConfigurationError);
  });

  it("configures reasoning models without temperature", () => {
    const chatModel = createChatModel(
      loadModelConfig({
        MODEL_PROVIDER: "openai",
        MODEL_NAME: "gpt-5.6-terra",
      }),
      { openai: "test-only-placeholder" },
    ) as unknown as {
      reasoning?: { effort?: string };
      temperature?: number;
    };

    expect(chatModel.reasoning).toEqual({ effort: "medium" });
    expect(chatModel.temperature).toBeUndefined();
  });
});
