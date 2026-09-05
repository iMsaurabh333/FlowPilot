# FlowPilot Architecture

## System view

```mermaid
flowchart LR
  User["BTP user"] --> Router["SAP AppRouter"]
  Admin["FlowPilot administrator"] --> Router
  Router --> XSUAA["XSUAA"]
  Router --> UI["React UI"]
  Router --> API["TypeScript API and LangGraph"]
  API --> Postgres["PostgreSQL"]
  API --> Models["Model adapter"]
  API --> Registry["Multi-server MCP registry"]
  API --> Destination["BTP Destination service"]
  Registry --> MCP1["Cloud Integration monitoring MCP"]
  Registry --> MCP2["Future approved MCP servers"]
  MCP1 --> Destination
  MCP2 --> Destination
  Destination --> SAP["SAP APIs"]
  Destination --> External["Third-party APIs"]
```

## Trust boundaries

1. The browser is untrusted. It does not choose its user or authorization scopes.
2. AppRouter performs interactive login and forwards the XSUAA token to the API.
3. The API validates the token again and enforces scopes on every protected endpoint.
4. Conversation ownership uses a stable key derived from validated tenant and subject claims.
5. Model responses, MCP metadata, tool arguments, and tool results are untrusted data.
6. Destinations and Credential Store hold connection details and secrets outside source control.
7. Only validated `ChatAdmin` requests can change MCP registry state or trigger an immediate health check. Models and ordinary chat users cannot call the registry administration operations.
8. Registry endpoints are constrained by approved server profiles. Server-side validation blocks unsupported schemes, hosts, ports, paths, redirects, and private or metadata targets that are outside the approved deployment boundary.

## Deployment topology

The main MTA contains independently scalable Cloud Foundry modules:

- `flowpilot-approuter`: public entry point and static UI host.
- `flowpilot-api`: stateless backend and LangGraph runtime.
- `flowpilot-web`: build-only React artifact copied into AppRouter.

The current MTA declares XSUAA, Destination, application logging, BTP PostgreSQL, and SAP Credential Store. PostgreSQL and Credential Store are bound only to the API. Credential Store supplies server-side model credentials and is never bound to browser-facing modules; its provider payloads are decrypted inside the API.

MCP servers use the shared server framework but remain independently deployable so a new connector does not require redeploying the chat application.

## MCP registry and administration

- The registry supports multiple independently deployable MCP servers from its first implementation. Each record has a stable server ID, display name, Streamable HTTP endpoint, optional external port, authentication-profile reference, allowed tool names, required FlowPilot scopes, enabled state, and operational limits.
- PostgreSQL stores the non-secret runtime registry state and latest health metadata. Authentication profiles reference BTP-managed bindings or destinations; tokens, client secrets, and certificates are never stored in registry rows or returned to the browser.
- The administrator UI can edit only endpoints permitted by an approved server profile. For a Cloud Foundry-hosted server, the UI stores its HTTPS route and MCP path; the application still listens on the platform-assigned process port. An explicit port is available only for an approved external endpoint.
- Toggling a server off immediately removes its tools from new registry resolutions. Toggling it on requires a successful authenticated capability probe before its tools are exposed.
- The **Ping** action is an authenticated server-side MCP capability probe with a short timeout, not an ICMP request or browser fetch. It records safe status, latency, protocol compatibility, last-check time, and discovered allowlisted-tool count without returning raw upstream errors or credentials.
- Health states are `never_checked`, `healthy`, `unhealthy`, and `stale`. A bounded cache prevents a probe on every chat turn; stale health is refreshed before tools are offered, and a failed refresh excludes that server's tools without changing its administrator-selected enabled flag.
- Tool names are namespaced by server ID. The registry fails closed on duplicate names, unknown tools, missing scopes, missing authentication, incompatible protocol versions, disabled servers, and failed health checks.
- Milestone 5 restricts downstream SAP and Event Mesh connector operations to reviewed HTTP `GET` requests. MCP Streamable HTTP still uses the methods required by the pinned MCP protocol, and registry toggles remain authenticated state-changing application operations.

The first live record is the Cloud Integration monitoring server for bounded Message Processing Log metadata. The same control plane can later register a separate Cloud Integration content server and Event Mesh server, each with its own destination, credentials, allowlist, roles, and deployment lifecycle.

## Request identity

Production requests follow this path:

```text
Browser -> AppRouter/XSUAA -> forwarded bearer token -> API validation -> scope check
```

Local development can use explicit mock identity only when `AUTH_MODE=mock` and `NODE_ENV` is not `production`.

## Scaling model

- No chat or authorization state is stored in process memory.
- AppRouter and API instances can be scaled independently.
- PostgreSQL holds durable application and LangGraph checkpoint state.
- MCP servers use Streamable HTTP and scale independently.
- Timeouts and circuit breakers prevent a failing dependency from exhausting application capacity.

## Chat runtime

- The web application uses UI5 Web Components with the standard `sap_horizon` theme.
- The API derives conversation ownership from validated XSUAA tenant and subject claims.
- PostgreSQL stores the owned conversation catalog and LangGraph checkpoints.
- The API prefers the certificate-bearing PostgreSQL service binding over the buildpack's plain `DATABASE_URL`, validates the supplied CA, and shares one TLS-enabled pool with the repository and LangGraph checkpointer.
- LangGraph depends on a provider-neutral LangChain chat-model interface.
- Groq is the initial default; Groq, OpenAI, and Anthropic adapters sit behind the same server-side factory.
- SAP Credential Store holds deployed provider keys. The API resolves the selected provider's fixed credential reference lazily, decrypts the service's JWE response, and caches the value only in memory for a bounded period.
- Provider, model, limits, and timeouts are server configuration and cannot be selected by the browser.
