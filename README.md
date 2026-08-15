# FlowPilot

FlowPilot is a standalone SAP BTP Cloud Foundry application for authenticated, natural-language troubleshooting and transaction monitoring. It will connect to SAP and third-party APIs directly and through standard Model Context Protocol (MCP) servers.

The project is also a reference implementation of a repeatable, platform-neutral AI-assisted development process. See [DevFlow.md](./DevFlow.md).

## Current milestone

The current milestone is the first vertical slice:

1. Serve a standalone web UI through SAP AppRouter.
2. Authenticate with XSUAA and BTP role collections.
3. Forward and validate the user token in the backend.
4. Return the authenticated user's non-sensitive identity to the UI.
5. Build the application as a Cloud Foundry MTA.
6. Deploy it to the authenticated trial `dev` space and run a smoke test.

LLM, PostgreSQL chat persistence, Destination-backed API calls, and MCP tools follow after this slice is proven.

## Repository layout

```text
apps/
  api/          TypeScript backend and future LangGraph runtime
  approuter/    SAP AppRouter and static UI entry point
  web/          React standalone UI
docs/
  decisions/    Architecture Decision Records
packages/       Reusable agent, model, connector, and MCP packages
servers/        Independently deployable MCP servers
```

## Prerequisites

- Node.js 24
- npm
- Cloud Foundry CLI v8
- Cloud MTA Build Tool (`mbt`)
- GNU Make (required by MBT)
- Cloud Foundry MultiApps CLI plugin
- An SAP BTP Cloud Foundry space with XSUAA and Destination service entitlements

## Local development

Install each application package:

```powershell
npm run install:all
```

Run the backend with mock local identity:

```powershell
npm run dev:api
```

In a second terminal, run the UI:

```powershell
npm run dev:web
```

The mock identity mode is refused when `NODE_ENV=production`. Production always uses a validated XSUAA token.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

## BTP build and deployment

```powershell
npm run mta:build
cf deploy mta_archives/flowpilot_0.1.0.mtar
```

Deployment commands will be run only against the explicitly selected Cloud Foundry org and space. Environment-specific credentials and service keys must never be committed.

After the first deployment, assign one of the predefined `FlowPilotUsers`, `FlowPilotOperators`, or `FlowPilotAdmins` role collections to the appropriate BTP users in the subaccount cockpit.

## Project documentation

- [Product scope](./docs/product.md)
- [Architecture](./docs/architecture.md)
- [Development guide](./docs/development.md)
- [Architecture decisions](./docs/decisions/README.md)
