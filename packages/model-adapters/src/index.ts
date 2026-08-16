import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const modelProviders = ["groq", "openai", "anthropic"] as const;
export type ModelProvider = (typeof modelProviders)[number];

const providerSchema = z.enum(modelProviders);

const integerSetting = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

const modelConfigSchema = z.object({
  provider: providerSchema.default("groq"),
  model: z.string().trim().min(1),
  temperature: z.coerce.number().min(0).max(2).default(0),
  maxOutputTokens: integerSetting(1024, 1, 8192),
  timeoutMs: integerSetting(30_000, 1_000, 120_000),
  maxRetries: integerSetting(2, 0, 5),
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
    return "llama-3.3-70b-versatile";
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
    timeoutMs: environment.MODEL_TIMEOUT_MS,
    maxRetries: environment.MODEL_MAX_RETRIES,
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

export function createChatModel(
  config: ModelConfig,
  credentials: ModelCredentials,
): BaseChatModel {
  const apiKey = requiredCredential(config.provider, credentials);
  const common = {
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxOutputTokens,
    maxRetries: config.maxRetries,
  };

  switch (config.provider) {
    case "groq":
      return new ChatGroq({
        ...common,
        apiKey,
        timeout: config.timeoutMs,
      });
    case "openai":
      return new ChatOpenAI({
        ...common,
        apiKey,
        timeout: config.timeoutMs,
      });
    case "anthropic":
      return new ChatAnthropic({
        ...common,
        apiKey,
        clientOptions: { timeout: config.timeoutMs },
      });
  }
}
