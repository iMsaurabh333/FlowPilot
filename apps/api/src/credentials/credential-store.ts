import {
  constants,
  createDecipheriv,
  createPrivateKey,
  privateDecrypt,
} from "node:crypto";
import https from "node:https";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import {
  loadEnvironmentCredentials,
  type ModelCredentials,
  type ModelProvider,
} from "@flowpilot/model-adapters";

const credentialReferences: Record<
  ModelProvider,
  { namespace: string; type: "password"; name: string }
> = {
  groq: { namespace: "flowpilot", type: "password", name: "groq-api-key" },
  openai: {
    namespace: "flowpilot",
    type: "password",
    name: "openai-api-key",
  },
  anthropic: {
    namespace: "flowpilot",
    type: "password",
    name: "anthropic-api-key",
  },
};

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_TTL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class CredentialStoreConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialStoreConfigurationError";
  }
}

interface CredentialStoreBinding {
  url: string;
  username?: string;
  password?: string;
  certificate?: string;
  key?: string;
  encryption: {
    client_private_key: string;
  };
}

export interface CredentialStoreRequestOptions {
  url: string;
  headers: Record<string, string>;
  certificate?: string;
  key?: string;
  timeoutMs: number;
}

export interface CredentialStoreResponse {
  status: number;
  body: string;
}

export type CredentialStoreRequest = (
  options: CredentialStoreRequestOptions,
) => Promise<CredentialStoreResponse>;

export interface ProviderCredentialResolver {
  resolve(provider: ModelProvider): Promise<string>;
  clearCache(): void;
}

export interface CredentialStoreResolverOptions {
  request?: CredentialStoreRequest;
  cacheTtlMs?: number;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePem(value: string, label: string) {
  const normalized = value.replaceAll("\\n", "\n").trim();
  if (normalized.includes("-----BEGIN ")) {
    return normalized;
  }
  const compact = normalized.replaceAll(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g)?.join("\n") ?? compact;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an invalid encrypted payload",
    );
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(
    padded.padEnd(Math.ceil(padded.length / 4) * 4, "="),
    "base64",
  );
}

function decryptPayload(privateKeyMaterial: string, payload: string) {
  const parts = payload.trim().split(".");
  if (parts.length !== 5) {
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an invalid encrypted payload",
    );
  }

  const [protectedHeader, encryptedKey, iv, ciphertext, authTag] = parts;
  let header: unknown;
  try {
    header = JSON.parse(decodeBase64Url(protectedHeader).toString("utf8"));
  } catch (error) {
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an invalid encrypted payload",
      { cause: error },
    );
  }
  if (
    !isRecord(header) ||
    header.alg !== "RSA-OAEP-256" ||
    header.enc !== "A256GCM"
  ) {
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an unsupported encrypted payload",
    );
  }

  try {
    const key = createPrivateKey({
      key: normalizePem(privateKeyMaterial, "PRIVATE KEY"),
      format: "pem",
    });
    const contentEncryptionKey = privateDecrypt(
      {
        key,
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      decodeBase64Url(encryptedKey),
    );
    if (contentEncryptionKey.length !== 32) {
      throw new Error("Unexpected content-encryption-key length");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      contentEncryptionKey,
      decodeBase64Url(iv),
    );
    decipher.setAAD(Buffer.from(protectedHeader, "ascii"));
    decipher.setAuthTag(decodeBase64Url(authTag));
    return Buffer.concat([
      decipher.update(decodeBase64Url(ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new CredentialStoreConfigurationError(
      "Credential Store payload decryption failed",
      { cause: error },
    );
  }
}

function parseBindingCredentials(value: unknown): CredentialStoreBinding {
  if (!isRecord(value)) {
    throw new CredentialStoreConfigurationError(
      "Credential Store binding is missing credentials",
    );
  }

  const nested = isRecord(value.credentials) ? value.credentials : value;
  const url = nonEmptyString(nested.url);
  const clientPrivateKey = isRecord(nested.encryption)
    ? nonEmptyString(nested.encryption.client_private_key)
    : undefined;
  if (!url || !clientPrivateKey) {
    throw new CredentialStoreConfigurationError(
      "Credential Store binding is missing required encryption details",
    );
  }
  try {
    if (new URL(url).protocol !== "https:") {
      throw new Error("Credential Store URL must use HTTPS");
    }
  } catch (error) {
    throw new CredentialStoreConfigurationError(
      "Credential Store binding has an invalid URL",
      { cause: error },
    );
  }

  const certificate = nonEmptyString(nested.certificate);
  const key = nonEmptyString(nested.key);
  if (Boolean(certificate) !== Boolean(key)) {
    throw new CredentialStoreConfigurationError(
      "Credential Store mTLS binding must include both certificate and key",
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    username: nonEmptyString(nested.username),
    password: nonEmptyString(nested.password),
    certificate,
    key,
    encryption: { client_private_key: clientPrivateKey },
  };
}

export function parseCredentialStoreBinding(
  rawBindings: string | undefined,
): CredentialStoreBinding | undefined {
  if (!rawBindings?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBindings);
  } catch (error) {
    throw new CredentialStoreConfigurationError(
      "VCAP_SERVICES is not valid JSON",
      { cause: error },
    );
  }
  if (!isRecord(parsed)) {
    throw new CredentialStoreConfigurationError(
      "VCAP_SERVICES has an invalid shape",
    );
  }

  const direct = parsed.credstore;
  const candidates = Array.isArray(direct)
    ? direct
    : Object.values(parsed).flatMap((value) =>
        Array.isArray(value) ? value : [],
      );
  const service =
    candidates.find(
      (candidate) =>
        isRecord(candidate) &&
        (candidate.label === "credstore" ||
          candidate.name === "flowpilot-credentials"),
    ) ?? (Array.isArray(direct) ? direct[0] : undefined);
  if (!service || !isRecord(service)) {
    return undefined;
  }
  return parseBindingCredentials(service.credentials);
}

async function defaultRequest(
  options: CredentialStoreRequestOptions,
): Promise<CredentialStoreResponse> {
  const endpoint = new URL(options.url);
  if (endpoint.protocol !== "https:") {
    throw new CredentialStoreConfigurationError(
      "Credential Store requests must use HTTPS",
    );
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "GET",
        headers: options.headers,
        cert: options.certificate,
        key: options.key,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(
        new CredentialStoreConfigurationError(
          "Credential Store request timed out",
        ),
      );
    });
    request.on("error", reject);
    request.end();
  });
}

function requestHeaders(binding: CredentialStoreBinding, namespace: string) {
  const headers: Record<string, string> = {
    Accept: "application/jose",
    "Cache-Control": "no-cache",
    "Content-Type": "application/jose",
    "sapcp-credstore-namespace": namespace,
  };
  if (binding.certificate && binding.key) {
    return headers;
  }
  if (!binding.username || !binding.password) {
    throw new CredentialStoreConfigurationError(
      "Credential Store binding has no supported authentication credentials",
    );
  }
  headers.Authorization = `Basic ${Buffer.from(`${binding.username}:${binding.password}`).toString("base64")}`;
  return headers;
}

async function readProviderCredential(
  binding: CredentialStoreBinding,
  provider: ModelProvider,
  request: CredentialStoreRequest,
) {
  const reference = credentialReferences[provider];
  const endpoint = new URL(`${binding.url}/${reference.type}`);
  endpoint.searchParams.set("name", reference.name);
  const mutualTls = Boolean(binding.certificate && binding.key);
  const response = await request({
    url: endpoint.toString(),
    headers: requestHeaders(binding, reference.namespace),
    certificate:
      mutualTls && binding.certificate
        ? normalizePem(binding.certificate, "CERTIFICATE")
        : undefined,
    key:
      mutualTls && binding.key
        ? normalizePem(binding.key, "PRIVATE KEY")
        : undefined,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new CredentialStoreConfigurationError(
      `Credential Store returned HTTP ${response.status}`,
    );
  }

  let credential: unknown;
  try {
    credential = JSON.parse(
      decryptPayload(binding.encryption.client_private_key, response.body),
    );
  } catch (error) {
    if (error instanceof CredentialStoreConfigurationError) {
      throw error;
    }
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an invalid credential",
      { cause: error },
    );
  }
  const value = isRecord(credential)
    ? nonEmptyString(credential.value)
    : undefined;
  if (!value) {
    throw new CredentialStoreConfigurationError(
      "Credential Store returned an empty provider credential",
    );
  }
  return value;
}

function boundedTtl(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CACHE_TTL_MS;
  }
  return Math.min(
    Math.max(Math.trunc(value ?? DEFAULT_CACHE_TTL_MS), 1_000),
    MAX_CACHE_TTL_MS,
  );
}

export function createProviderCredentialResolver(
  environment: NodeJS.ProcessEnv = process.env,
  options: CredentialStoreResolverOptions = {},
): ProviderCredentialResolver {
  let binding: CredentialStoreBinding | undefined;
  let bindingError: CredentialStoreConfigurationError | undefined;
  try {
    binding = parseCredentialStoreBinding(environment.VCAP_SERVICES);
  } catch (error) {
    bindingError =
      error instanceof CredentialStoreConfigurationError
        ? error
        : new CredentialStoreConfigurationError(
            "Credential Store binding could not be read",
            { cause: error },
          );
  }

  const request = options.request ?? defaultRequest;
  const ttlMs = boundedTtl(options.cacheTtlMs);
  const now = options.now ?? Date.now;
  const localCredentials = loadEnvironmentCredentials(environment);
  const production =
    environment.NODE_ENV?.trim().toLowerCase() === "production";
  let cache:
    { provider: ModelProvider; value: string; expiresAt: number } | undefined;

  return {
    async resolve(provider) {
      const timestamp = now();
      if (cache && cache.provider === provider && cache.expiresAt > timestamp) {
        return cache.value;
      }
      if (bindingError) {
        throw bindingError;
      }

      let value: string;
      if (binding) {
        try {
          value = await readProviderCredential(binding, provider, request);
        } catch (error) {
          if (error instanceof CredentialStoreConfigurationError) {
            throw error;
          }
          throw new CredentialStoreConfigurationError(
            "Credential Store credential retrieval failed",
            { cause: error },
          );
        }
      } else {
        if (production) {
          throw new CredentialStoreConfigurationError(
            "Credential Store binding is required in production",
          );
        }
        value = localCredentials[provider]?.trim() ?? "";
        if (!value) {
          throw new CredentialStoreConfigurationError(
            `No local credential is configured for model provider ${provider}`,
          );
        }
      }

      cache = { provider, value, expiresAt: timestamp + ttlMs };
      return value;
    },
    clearCache() {
      cache = undefined;
    },
  };
}

function messageContent(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .flatMap((block) => {
      if (isRecord(block) && typeof block.text === "string") {
        return [block.text];
      }
      return [];
    })
    .join("\n");
}

class LazyCredentialChatModel extends SimpleChatModel {
  readonly #createModel: () => Promise<BaseChatModel>;

  constructor(createModel: () => Promise<BaseChatModel>) {
    super({});
    this.#createModel = createModel;
  }

  _llmType() {
    return "flowpilot-lazy-provider";
  }

  async _call(messages: BaseMessage[], options: this["ParsedCallOptions"]) {
    const model = await this.#createModel();
    const response = await model.invoke(messages, options);
    return messageContent(response.content);
  }
}

export function createLazyCredentialChatModel(
  createModel: () => Promise<BaseChatModel>,
): BaseChatModel {
  return new LazyCredentialChatModel(createModel);
}

export function modelCredentialsFor(
  provider: ModelProvider,
  value: string,
): ModelCredentials {
  return { [provider]: value } as ModelCredentials;
}
