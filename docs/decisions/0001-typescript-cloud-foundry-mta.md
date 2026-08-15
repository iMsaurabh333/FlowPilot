# ADR 0001: TypeScript Modular Application on Cloud Foundry

- Status: Accepted
- Date: 2026-08-15

## Context

FlowPilot needs a standalone UI, authenticated backend, LangGraph agent, SAP connectivity, and extensible MCP clients and servers. It must deploy to SAP BTP Cloud Foundry and keep reusable components portable.

## Decision

Use Node.js 24 and TypeScript for the UI, backend, agent packages, MCP integration, and MCP server framework. Package the main application as an MTA with separate AppRouter, API, and UI build modules.

Use Express for the initial API instead of CAP because FlowPilot is primarily an integration and agent application and does not initially expose a domain-heavy OData service.

## Consequences

- SAP Cloud SDK, LangGraph.js, and the official MCP TypeScript SDK share one language and package ecosystem.
- AppRouter and API can scale separately.
- MTA tooling is required for builds and deployments.
- A build step is required for TypeScript.
- CAP can be introduced later only if its domain-service capabilities provide clear value.
