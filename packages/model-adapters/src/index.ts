import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const modelProviders = ["groq", "openai", "anthropic"] as const;
export type ModelProvider = (typeof modelProviders)[number];

const providerSchema = z.enum(modelProviders);
const reasoningEffortSchema = z
  .enum(["none", "low", "medium", "high", "xhigh", "max"])
  .default("medium");
const verbositySchema = z.enum(["low", "medium", "high"]).default("low");

const integerSetting = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

const modelConfigSchema = z.object({
  provider: providerSchema.default("groq"),
  model: z.string().trim().min(1),
  temperature: z.coerce.number().min(0).max(2).default(0),
  maxOutputTokens: integerSetting(1024, 1, 8192),
  maxContextTokens: integerSetting(6_000, 2_000, 32_768),
  maxSummaryTokens: integerSetting(512, 128, 4_096),
  timeoutMs: integerSetting(30_000, 1_000, 120_000),
  maxRetries: integerSetting(2, 0, 5),
  reasoningEffort: reasoningEffortSchema,
  verbosity: verbositySchema,
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelCredentials = Partial<Record<ModelProvider, string>>;

export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

function defaultModel(provider: ModelProvider) {
  if (provider === "groq") {
    return "openai/gpt-oss-120b";
  }

  if (provider === "openai") {
    return "gpt-5.6-terra";
  }

  throw new ModelConfigurationError(
    `MODEL_NAME is required when MODEL_PROVIDER is ${provider}`,
  );
}

export function loadModelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const provider = providerSchema.parse(environment.MODEL_PROVIDER ?? "groq");
  return modelConfigSchema.parse({
    provider,
    model: environment.MODEL_NAME?.trim() || defaultModel(provider),
    temperature: environment.MODEL_TEMPERATURE,
    maxOutputTokens: environment.MODEL_MAX_OUTPUT_TOKENS,
    maxContextTokens: environment.MODEL_MAX_CONTEXT_TOKENS,
    maxSummaryTokens: environment.MODEL_MAX_SUMMARY_TOKENS,
    timeoutMs: environment.MODEL_TIMEOUT_MS,
    maxRetries: environment.MODEL_MAX_RETRIES,
    reasoningEffort: environment.MODEL_REASONING_EFFORT,
    verbosity: environment.MODEL_VERBOSITY,
  });
}

export function loadEnvironmentCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): ModelCredentials {
  return {
    groq: environment.GROQ_API_KEY,
    openai: environment.OPENAI_API_KEY,
    anthropic: environment.ANTHROPIC_API_KEY,
  };
}

function requiredCredential(
  provider: ModelProvider,
  credentials: ModelCredentials,
) {
  const value = credentials[provider]?.trim();
  if (!value) {
    throw new ModelConfigurationError(
      `No server-side credential is configured for model provider ${provider}`,
    );
  }
  return value;
}

function isOpenAIReasoningModel(model: string) {
  return /^(gpt-6(?:-|$)|gpt-5(?:\.\d+)?(?:-|$)|o\d)/i.test(model);
}

export function createChatModel(
  config: ModelConfig,
  credentials: ModelCredentials,
): BaseChatModel {
  const apiKey = requiredCredential(config.provider, credentials);
  const common = {
    model: config.model,
    maxTokens: config.maxOutputTokens,
    maxRetries: config.maxRetries,
  };

  switch (config.provider) {
    case "groq":
      return new ChatGroq({
        ...common,
        temperature: config.temperature,
        apiKey,
        timeout: config.timeoutMs,
      });
    case "openai":
      return new ChatOpenAI({
        ...common,
        ...(isOpenAIReasoningModel(config.model)
          ? {
            reasoning: { effort: config.reasoningEffort },
          }
          : { temperature: config.temperature }),
        verbosity: config.verbosity,
        apiKey,
        timeout: config.timeoutMs,
      });
    case "anthropic":
      return new ChatAnthropic({
        ...common,
        temperature: config.temperature,
        apiKey,
        clientOptions: { timeout: config.timeoutMs },
      });
  }
}
