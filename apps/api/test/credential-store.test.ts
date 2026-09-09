import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createProviderCredentialResolver,
  parseCredentialStoreBinding,
  type CredentialStoreRequestOptions,
} from "../src/credentials/credential-store.js";

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function encryptedCredential(publicKey: KeyObject, value: string) {
  const protectedHeader = base64Url(
    Buffer.from(
      JSON.stringify({
        alg: "RSA-OAEP-256",
        enc: "A256GCM",
        iat: Math.floor(Date.now() / 1_000),
      }),
      "utf8",
    ),
  );
  const contentEncryptionKey = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    contentEncryptionKey,
  );
  const cipher = createCipheriv("aes-256-gcm", contentEncryptionKey, iv);
  cipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  const ciphertext = Buffer.concat([
    cipher.update(
      Buffer.from(
        JSON.stringify({ name: "groq-api-key", username: "groq", value }),
        "utf8",
      ),
    ),
    cipher.final(),
  ]);
  return [
    protectedHeader,
    base64Url(encryptedKey),
    base64Url(iv),
    base64Url(ciphertext),
    base64Url(cipher.getAuthTag()),
  ].join(".");
}

function bindingEnvironment(
  privateKey: KeyObject,
  extra: Record<string, unknown> = {},
) {
  const privateKeyDer = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  return {
    NODE_ENV: "production",
    VCAP_SERVICES: JSON.stringify({
      credstore: [
        {
          credentials: {
            url: "https://credential-store.example/api/v1/credentials",
            username: "binding-user",
            password: "binding-password",
            encryption: { client_private_key: privateKeyDer },
            ...extra,
          },
        },
      ],
    }),
  };
}

describe("Credential Store provider resolver", () => {
  it("parses the direct credstore binding and decrypts a password response", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    const calls: CredentialStoreRequestOptions[] = [];
    const resolver = createProviderCredentialResolver(
      bindingEnvironment(privateKey),
      {
        request: async (options) => {
          calls.push(options);
          return {
            status: 200,
            body: encryptedCredential(publicKey, "gsk_test_secret"),
          };
        },
      },
    );

    await expect(resolver.resolve("groq")).resolves.toBe("gsk_test_secret");
    await expect(resolver.resolve("groq")).resolves.toBe("gsk_test_secret");

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/credentials/password");
    expect(new URL(calls[0].url).searchParams.get("name")).toBe("groq-api-key");
    expect(calls[0].headers["sapcp-credstore-namespace"]).toBe("flowpilot");
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("binding-user:binding-password").toString("base64")}`,
    );
    expect(calls[0].headers.Accept).toBe("application/jose");
  });

  it("refreshes the in-memory value after the bounded cache expires", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    let now = 0;
    let calls = 0;
    const resolver = createProviderCredentialResolver(
      bindingEnvironment(privateKey),
      {
        cacheTtlMs: 1_000,
        now: () => now,
        request: async () => {
          calls += 1;
          return {
            status: 200,
            body: encryptedCredential(publicKey, `gsk_test_secret_${calls}`),
          };
        },
      },
    );

    await expect(resolver.resolve("groq")).resolves.toBe("gsk_test_secret_1");
    now = 999;
    await expect(resolver.resolve("groq")).resolves.toBe("gsk_test_secret_1");
    now = 1_001;
    await expect(resolver.resolve("groq")).resolves.toBe("gsk_test_secret_2");
    expect(calls).toBe(2);
  });

  it("uses local environment credentials only outside production", async () => {
    const resolver = createProviderCredentialResolver({
      NODE_ENV: "development",
      GROQ_API_KEY: "local-development-key",
    });

    await expect(resolver.resolve("groq")).resolves.toBe(
      "local-development-key",
    );
  });

  it("fails closed when production has no Credential Store binding", async () => {
    const resolver = createProviderCredentialResolver({
      NODE_ENV: "production",
    });

    await expect(resolver.resolve("groq")).rejects.toThrow(
      "Credential Store binding is required in production",
    );
  });

  it("rejects malformed bindings without exposing binding values", () => {
    expect(() => parseCredentialStoreBinding("not-json")).toThrow(
      "VCAP_SERVICES is not valid JSON",
    );
    expect(() =>
      parseCredentialStoreBinding(
        JSON.stringify({ credstore: [{ credentials: { url: "http://bad" } }] }),
      ),
    ).toThrow(
      "Credential Store binding is missing required encryption details",
    );
  });

  it("uses mutual TLS binding fields without adding Basic authorization", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    const calls: CredentialStoreRequestOptions[] = [];
    const resolver = createProviderCredentialResolver(
      bindingEnvironment(privateKey, {
        certificate:
          "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
        key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
        username: "",
        password: "",
      }),
      {
        request: async (options) => {
          calls.push(options);
          return {
            status: 200,
            body: encryptedCredential(publicKey, "gsk_mtls_secret"),
          };
        },
      },
    );

    await expect(resolver.resolve("groq")).resolves.toBe("gsk_mtls_secret");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].certificate).toContain("BEGIN CERTIFICATE");
    expect(calls[0].key).toContain("BEGIN PRIVATE KEY");
  });
});
