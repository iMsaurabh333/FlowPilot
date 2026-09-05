# FlowPilot Cloud Integration MCP server

This package is the independently runnable Streamable HTTP boundary for SAP Cloud
Integration. It exposes the reviewed, bounded `search_message_processing_logs`
tool through a Destination-backed connector. The connector is read-only and
accepts only the semantic fields defined by the pinned EDMX-derived contract.

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
- One tool, `search_message_processing_logs`, is registered. It performs only a
  bounded HTTP `GET` against the fixed `FLOWPILOT_CLOUD_INTEGRATION_MPL`
  destination and returns normalized Message Processing Log metadata. No
  resources, prompts, sampling, elicitation, roots, or subscriptions are exposed.

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

Production remains incomplete until a later approved task adds the dedicated XSUAA
scope/grant, service binding, public route metadata, and deployment configuration.
