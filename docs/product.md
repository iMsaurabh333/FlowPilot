# FlowPilot Product Scope

## Problem statement

Operational users need one secure interface for troubleshooting and monitoring transactions across SAP and third-party systems. Existing APIs expose the necessary information, but users must understand individual products, endpoints, credentials, and payloads. FlowPilot will provide a standalone web application and a natural-language interface that can use approved tools without exposing one user's sessions or history to another user.

## Target users

- BTP subaccount users assigned the FlowPilot chat role.
- Operators assigned additional roles for approved operational tools.
- Administrators who configure models, destinations, and MCP server registrations.

## Initial capabilities

- Standalone browser application deployed to SAP BTP Cloud Foundry.
- SAP Horizon user experience built with UI5 Web Components.
- XSUAA authentication and role-based authorization.
- Per-user conversation and session isolation.
- Direct calls to SAP and third-party APIs through BTP destinations.
- Provider-configurable LangGraph chat agent.
- Standard remote MCP clients with a controlled multi-server registry.
- A narrow `ChatAdmin`-only graphical MCP registry for approved endpoint configuration, activation, and health checks.
- Reusable MCP server template generated from reviewed OpenAPI operations.

## Non-functional requirements

- Backend authorization is mandatory; UI checks are not security controls.
- Conversation ownership is derived from validated identity, never client input.
- Runtime instances remain stateless so they can scale horizontally.
- Secrets stay in BTP-managed services or approved CI secret stores.
- Tool access follows least privilege and read-only defaults.
- The first connector release permits downstream business-API `GET` operations only. This restriction does not apply to MCP's own protocol transport or authenticated administrative registry mutations.
- MCP endpoint changes are validated server-side against approved schemes, hosts, ports, paths, and authentication profiles; the browser never probes a server directly.
- Model and tool calls have timeouts, size limits, audit metadata, and safe errors.
- Repository commands and documentation are portable across AI development tools.

## MVP boundary

The MVP includes authenticated chat, PostgreSQL-backed isolated history, a Groq-default provider-neutral model runtime, one Destination-backed read-only SAP API, one MCP server created from a reviewed vendor contract, and a multi-server registry/control surface proven with approved test servers.

The MVP includes only a narrow administrator MCP registry screen. It excludes end-user registration of arbitrary MCP URLs, an unrestricted network target editor, state-changing business tools, a vector database, cross-subaccount SaaS tenancy, and a general-purpose production administration console.

## Success criteria

- Two simultaneous users cannot read or address each other's conversations.
- A model can be changed among installed provider adapters through configuration.
- Multiple reviewed MCP servers can be registered, namespaced, enabled, disabled, and health-checked without changing the graph.
- An administrator can configure an approved MCP endpoint route and optional external port, while Cloud Foundry-hosted servers use their platform route rather than a manually assigned process port.
- Disabled, unauthorized, unhealthy, or stale MCP servers do not contribute tools to a chat session.
- A clean checkout can be built, tested, packaged, deployed, and smoke-tested using documented commands.
- Every milestone produces a reusable lesson or process update in `DevFlow.md`.
