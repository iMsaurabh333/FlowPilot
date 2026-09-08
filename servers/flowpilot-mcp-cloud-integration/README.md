# FlowPilot Cloud Integration MCP server

This package is the independently runnable Streamable HTTP boundary for SAP Cloud
Integration. It exposes reviewed, bounded Message Processing Log tools through
a Destination-backed connector. The connector is read-only and accepts only the
semantic fields defined by the pinned EDMX-derived contract.

## Current protocol and security contract

- MCP TypeScript SDK v2.0.0.
- Current protocol `2026-07-28`, with explicit stateless compatibility for
  `2025-11-25`.
- One `/mcp` endpoint with a fresh MCP server instance for every request.
- Bearer authentication before MCP request handling, requiring local XSUAA scope
  `McpInvoke`.
- RFC 9728 Protected Resource Metadata at
  `/.well-known/oauth-protected-resource/mcp`; authentication challenges point
  clients to this document.
- Production tokens must validate through the bound XSUAA service and use the
  `client_credentials` grant.
- Host and Origin validation are automatic for loopback. Non-loopback binds fail
  configuration unless both allowlists are supplied.
- JSON requests are capped at 32 KB. Malformed and oversized bodies return stable,
  credential-safe JSON errors.
- `/health` is an unauthenticated, non-sensitive process-liveness endpoint. Registry
  **Ping** must use the authenticated MCP protocol endpoint instead: authenticated
  `server/discover` for the 2026 protocol and initialize plus `ping` for the 2025
  compatibility path.
- Two tools are registered:
  - `search_message_processing_logs` performs a bounded HTTP `GET` against the
    fixed `FLOWPILOT_CLOUD_INTEGRATION_MPL` destination and returns normalized
    Message Processing Log metadata.
  - `get_message_processing_log_error_information` returns bounded plain-text
    error details only when supplied the MessageGuid and a non-completed status
    from an approved log search. Completed and discarded messages are not
    queried.
- No resources, prompts, sampling, elicitation, roots, or subscriptions are
  exposed.

## Local verification

Install and run the deterministic suite:

```text
npm install --prefix servers/flowpilot-mcp-cloud-integration
npm test --prefix servers/flowpilot-mcp-cloud-integration
npm run typecheck --prefix servers/flowpilot-mcp-cloud-integration
npm run build --prefix servers/flowpilot-mcp-cloud-integration
```

For a manual local process, set `MCP_AUTH_MODE=mock` and set `MCP_MOCK_TOKEN` to a
throwaway value of at least 32 characters. Mock mode refuses to start when
`NODE_ENV=production`. A live tool call additionally requires a bound Destination
service and the `FLOWPILOT_CLOUD_INTEGRATION_MPL` destination. Never reuse or
commit a real token.

Default listener: `127.0.0.1:4100`. A public listener requires:

- `MCP_HOST`
- `MCP_ALLOWED_HOSTS` as comma-separated hostnames without schemes or ports
- `MCP_ALLOWED_ORIGINS` with the same hostname-only format
- `MCP_PUBLIC_URL` as the canonical HTTPS URL ending in `/mcp`
- `PORT`

`MCP_AUTHORIZATION_SERVER_URL` can override the authorization-server URL advertised
in metadata. XSUAA mode otherwise derives it from the validated service binding.

## Production deployment

The FlowPilot MTA deploys this package as `flowpilot-mcp-cloud-integration` with
its own public HTTPS route and sets `MCP_PUBLIC_URL`, `MCP_ALLOWED_HOSTS`, and
`MCP_ALLOWED_ORIGINS` from that route. The module binds to the dedicated
`flowpilot-mcp-auth` XSUAA instance. Its `McpInvoke` scope is granted only to
technical clients; it is intentionally absent from all user role collections.

The MCP XSUAA descriptor grants `McpInvoke` only to FlowPilot's existing API
XSUAA application, which explicitly accepts that authority. The API obtains a
short-lived client-credentials token only for the fixed
`technical:flowpilot-mcp` registry profile. It reads its own bound XSUAA client
at runtime, so the client secret is never stored in a registry row, application
property, service key, or source file. Before a cloud deployment, obtain
approval for the MTA mutation. After deployment, register the public MCP route
with that technical profile and perform an authenticated registry Ping.
