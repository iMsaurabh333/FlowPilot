# FlowPilot Product Scope

## Problem statement

Operational users need one secure interface for troubleshooting and monitoring transactions across SAP and third-party systems. Existing APIs expose the necessary information, but users must understand individual products, endpoints, credentials, and payloads. FlowPilot will provide a standalone web application and a natural-language interface that can use approved tools without exposing one user's sessions or history to another user.

## Target users

- BTP subaccount users assigned the FlowPilot chat role.
- Operators assigned additional roles for approved operational tools.
- Administrators who configure models, destinations, and MCP server registrations.

## Initial capabilities

- Standalone browser application deployed to SAP BTP Cloud Foundry.
- XSUAA authentication and role-based authorization.
- Per-user conversation and session isolation.
- Direct calls to SAP and third-party APIs through BTP destinations.
- Provider-configurable LangGraph chat agent.
- Standard remote MCP client with a controlled server registry.
- Reusable MCP server template generated from reviewed OpenAPI operations.

## Non-functional requirements

- Backend authorization is mandatory; UI checks are not security controls.
- Conversation ownership is derived from validated identity, never client input.
- Runtime instances remain stateless so they can scale horizontally.
- Secrets stay in BTP-managed services or approved CI secret stores.
- Tool access follows least privilege and read-only defaults.
- Model and tool calls have timeouts, size limits, audit metadata, and safe errors.
- Repository commands and documentation are portable across AI development tools.

## MVP boundary

The MVP includes authenticated chat, PostgreSQL-backed isolated history, one configurable model provider, one Destination-backed read-only SAP API, and one MCP server created from an OpenAPI specification.

The MVP excludes end-user registration of arbitrary MCP URLs, state-changing transaction tools, a vector database, cross-subaccount SaaS tenancy, and a production administration console.

## Success criteria

- Two simultaneous users cannot read or address each other's conversations.
- A model can be changed among installed provider adapters through configuration.
- A reviewed MCP server can be enabled through registry configuration without changing the graph.
- A clean checkout can be built, tested, packaged, deployed, and smoke-tested using documented commands.
- Every milestone produces a reusable lesson or process update in `DevFlow.md`.
