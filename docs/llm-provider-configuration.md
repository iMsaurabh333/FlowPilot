# Secure Third-Party LLM Configuration on SAP BTP

## Purpose

This guide explains how FlowPilot will connect to Groq, OpenAI, Anthropic, or another reviewed external LLM provider without placing API keys in source control, frontend code, ordinary environment configuration, deployment descriptors, or logs.

It separates non-secret runtime selection from secret material:

```text
Non-secret BTP configuration        Secret storage
----------------------------        -----------------------------
MODEL_PROVIDER=groq                 SAP Credential Store
MODEL_NAME=llama-3.3-70b-versatile  namespace: flowpilot
MODEL_TIMEOUT_MS=30000              credential: groq-api-key
MODEL_MAX_RETRIES=2
```

## Security model

1. Only the backend calls the model provider.
2. The browser never receives a provider API key or provider base URL.
3. A server-side allowlist controls provider and model selection.
4. SAP Credential Store holds deployed provider keys and exposes them to the API through its REST API.
5. The Credential Store service binding gives the API credentials for accessing the store; it does not place the Groq key in application source.
6. Prompts, responses, bearer tokens, provider keys, and full XSUAA identities are excluded from normal application logs.
7. Automated tests use a fake model and require no provider credential.

SAP Credential Store is designed to store passwords and keys for BTP applications and supports Cloud Foundry service bindings. See [SAP Credential Store overview](https://help.sap.com/docs/credential-store/sap-credential-store/what-is-sap-credential-store) and [REST API documentation](https://help.sap.com/docs/credential-store/sap-credential-store/rest-api?locale=en-US).

## Trial setup for Groq

### 1. Create an environment-specific Groq project

In the Groq console:

1. Create a project named for the application and environment, such as `flowpilot-dev`.
2. Configure conservative project limits appropriate for development.
3. Generate a project-specific API key.
4. Copy the key only into the Credential Store credential form.
5. Do not send the key through chat, email, issue trackers, terminal output, screenshots, or repository files.

Groq projects separate API keys, rate limits, usage, and cost visibility by application or environment. See [Groq Projects](https://console.groq.com/docs/projects).

### 2. Provision SAP Credential Store

The current trial marketplace exposes the `credstore` service with a `trial` plan. The planned MTA resource is equivalent to:

```yaml
- name: flowpilot-credentials
  type: org.cloudfoundry.managed-service
  parameters:
    service: credstore
    service-plan: trial
```

The service will be bound only to `flowpilot-api`, not to AppRouter or the web build.

### 3. Store the provider credential

Open the Credential Store UI from the BTP Cloud Foundry space and create:

```text
Namespace: flowpilot
Credential type: Password
Credential name: groq-api-key
Username: groq
Password: <the Groq project API key>
```

The credential name is safe configuration; the password is not. Never add the password to `mta.yaml`, `.env.example`, GitHub Actions, source files, or documentation.

The environment-recovery contract records only this safe metadata in `config/environments/operations.local.json`; it never records or accepts the password. See [FlowPilot recovery interfaces](./recovery-interfaces.md).

Use the SAP procedure for [creating and updating a credential](https://help.sap.com/docs/credential-store/sap-credential-store/create-edit-and-delete-credential).

### 4. Configure non-secret model selection

The API module can safely receive these values through the MTA descriptor:

```yaml
properties:
  MODEL_PROVIDER: groq
  MODEL_NAME: llama-3.3-70b-versatile
  MODEL_TEMPERATURE: "0"
  MODEL_MAX_OUTPUT_TOKENS: "1024"
  MODEL_TIMEOUT_MS: "30000"
  MODEL_MAX_RETRIES: "2"
```

Changing an installed provider requires updating these non-secret settings and storing the corresponding key under its approved Credential Store name. The application maps provider names to fixed credential references; the browser cannot choose them.

## Application retrieval pattern

At first model use, the backend:

1. discovers the bound Credential Store service through `VCAP_SERVICES`;
2. authenticates to Credential Store with the binding credentials (mTLS or basic authentication, according to the binding);
3. requests only the configured password credential name in the `flowpilot` namespace;
4. decrypts the JWE response using the binding's client private key and accepts only the expected credential value;
5. keeps the returned provider key in process memory for a short configured cache period;
6. passes the key directly to the selected server-side model adapter;
7. never serializes or logs the key.

The API implementation uses Node's built-in HTTPS and cryptography primitives for this read path. It enforces the Credential Store payload algorithms `RSA-OAEP-256` and `A256GCM`, requires HTTPS, and does not log response bodies or binding values. The request is injectable in tests so encrypted-provider behavior can be verified without a live service or billable model call.

Cloud Foundry service bindings deliver credentials to the application runtime and require an application restart or restage when binding data changes. See [Cloud Foundry service bindings](https://docs.cloudfoundry.org/devguide/services/application-binding.html). SAP Credential Store contents can be rotated independently; FlowPilot's short-lived in-memory cache must refresh them without requiring a code deployment.

Do not use ordinary Cloud Foundry environment variables for provider keys. Cloud Foundry specifically advises using service bindings rather than environment variables for security-sensitive credentials. See the [Cloud Foundry manifest security guidance](https://docs.cloudfoundry.org/devguide/deploy-apps/manifest-attributes.html#env-block).

## Checkpoint 4 design lock

The following is the implementation contract for the first deployed LLM slice. It is intentionally provider-neutral and keeps the deployment boundary explicit.

### Binding contract

- The MTA will own one managed service named `flowpilot-credentials` (`credstore` / `trial`).
- Only `flowpilot-api` will require the service. AppRouter, the web module, and browser code will never receive this binding.
- The API will discover the binding from `VCAP_SERVICES` by service label and normalize the binding shape before calling Credential Store. It will not depend on a service-instance GUID or a trial-account-specific name.
- Authentication to Credential Store will use only credentials delivered by the binding. No Credential Store client secret, token, or endpoint will be committed to Git or copied into ordinary MTA properties.

### Provider-reference contract

`MODEL_PROVIDER` is the only provider selector. It must be one of the installed, server-side allowlisted adapters: `groq`, `openai`, or `anthropic`. Each provider maps to a fixed Credential Store reference; the browser cannot supply a provider, credential name, endpoint, or model ID.

| Provider | Namespace | Type | Credential name |
| --- | --- | --- | --- |
| `groq` | `flowpilot` | `Password` | `groq-api-key` |
| `openai` | `flowpilot` | `Password` | `openai-api-key` |
| `anthropic` | `flowpilot` | `Password` | `anthropic-api-key` |

The username is metadata only and is not used as the provider API key. The password value is held in memory only long enough for the model adapter and is never returned by an API, serialized, logged, hashed, or written to disk.

### Failure, cache, and local-development rules

- In Cloud Foundry, a missing binding, unreadable credential, unsupported provider, or expired Credential Store token is a fail-closed model configuration error. The API may remain available for authentication and health checks, but chat requests return a generic service-unavailable response without revealing the cause or secret.
- Each API instance may cache one resolved provider key in memory for a short bounded TTL (initial target: five minutes). Expiry causes a fresh Credential Store read; rotation must not require a code deployment.
- Cloud Foundry deployments must not use `GROQ_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` environment variables. Those names remain a local-only development/test seam and are rejected or ignored in the production runtime path.
- Automated tests inject credentials or a fake model directly; they never call a billable provider or Credential Store.

This contract is locked for implementation. Any change to service ownership, credential names, provider allowlisting, or failure behavior requires a new design decision and review.

## Local development

Local development may use an ignored `.env.local` file:

```text
MODEL_PROVIDER=groq
MODEL_NAME=llama-3.3-70b-versatile
GROQ_API_KEY=<local development key>
```

Rules:

- `.env.local` must be ignored by Git.
- `.env.example` lists variable names but contains no usable value.
- Use a development-only Groq project and key.
- Application startup must fail clearly when a required credential is missing.
- Tests inject a fake model instead of reading `GROQ_API_KEY`.

## Scaling and operational controls

### Separate environments and keys

Use separate Groq projects and keys for development, test, and production. Never reuse a personal development key in production. Project separation provides independent usage visibility and restrictive project limits.

### Cache secret retrieval safely

Credential Store is not called for every chat token or request. Each API instance uses a short in-memory cache, refreshes on expiry, and never writes the secret to disk. Cache duration balances Credential Store capacity with rotation speed.

### Enforce application limits

Provider limits are shared across horizontally scaled API instances. FlowPilot must enforce:

- per-user and global concurrency limits;
- maximum input and output size;
- a provider timeout;
- bounded retries honoring retryable status codes and `Retry-After`;
- a circuit breaker for repeated provider failures;
- a centrally coordinated rate limiter when the API scales beyond one instance.

The current BTP marketplace also exposes a Redis trial service, which is a candidate for distributed rate limiting when horizontal scaling is introduced. It is not required for the first single-instance chat slice.

### Control provider costs

- Set conservative Groq project limits.
- Configure spend limits and alerts where the account plan supports them.
- Record model ID, latency, input/output token counts, outcome, and opaque request ID.
- Do not record prompt or response bodies by default.
- Reject unbounded context and output requests before calling the provider.

See [Groq spend limits](https://console.groq.com/docs/spend-limits) and [Groq security onboarding](https://console.groq.com/docs/production-readiness/security-onboarding).

### Restrict model and network configuration

- Keep an allowlist of supported providers and models.
- Never accept an arbitrary model endpoint or base URL from the browser; this avoids credential disclosure and server-side request forgery.
- Use HTTPS provider endpoints and validate TLS normally.
- Treat model output as untrusted data before rendering it or passing it to a tool.
- Keep tools disabled until their authorization and argument-validation layers are reviewed.

## Key rotation runbook

1. Create a new provider key in the correct Groq environment project.
2. Update the Credential Store entry without logging the new value.
3. Wait for or invalidate the FlowPilot secret cache.
4. run a controlled model health check that does not expose the key;
5. revoke the previous Groq key;
6. inspect provider and application usage for unexpected calls;
7. record the rotation date and result, never the secret value.

If exposure is suspected, revoke the key immediately, rotate the Credential Store value, clear application caches or restart instances, and review access logs. Do not temporarily restore a compromised key.

## Provider switch example

To switch from Groq to an already installed Anthropic adapter:

1. Store an `anthropic-api-key` credential in the same approved namespace.
2. Change the server configuration to `MODEL_PROVIDER=anthropic` and an allowlisted Anthropic model ID.
3. restart or redeploy the API;
4. run adapter contract tests and the deployed chat smoke test;
5. keep the Groq credential until rollback is no longer needed, then remove it according to the retention policy.

The LangGraph workflow, conversation API, and UI do not change.
