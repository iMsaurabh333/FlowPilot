# FlowPilot

FlowPilot is a standalone SAP BTP Cloud Foundry application for authenticated, natural-language troubleshooting and transaction monitoring. It will connect to SAP and third-party APIs directly and through standard Model Context Protocol (MCP) servers.

The project is also a reference implementation of a repeatable, platform-neutral AI-assisted development process. See [DevFlow.md](./DevFlow.md).

## Current milestone

The authentication foundation is deployed and proven. Checkpoint 2's private-chat backend, real BTP PostgreSQL isolation gate, and the Checkpoint 3 SAP Horizon chat interface are approved. Checkpoint 3A is establishing a guided, repeatable BTP environment bootstrap before the first live chat deployment; the deployed application remains the authentication-only page until Checkpoint 4. The milestone includes:

1. Replace the custom page with a standard SAP Horizon chat shell.
2. Store private conversations in BTP PostgreSQL.
3. Run a minimal LangGraph workflow with Groq as the default provider.
4. Retrieve the Groq API key securely through SAP Credential Store.
5. Prove conversation isolation with two-identity automated tests.
6. Deploy and smoke-test authenticated persistence in the trial space.

The work is divided into human-reviewed checkpoints. See the [private chat milestone](./docs/chat-milestone.md). Destination-backed API calls and MCP tools follow only after this slice is proven.

## Repository layout

```text
apps/
  api/          TypeScript backend and LangGraph runtime
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
- An SAP BTP Cloud Foundry space with XSUAA, Destination, and PostgreSQL service entitlements

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

Preview the complete environment-recovery sequence without executing an external command:

```powershell
npm run btp:bootstrap
```

Checkpoint 3A also provides `--mode verify` for read-only tool, target, Terraform, and MTAR checks. Apply, deploy, secret, backup, and restore modes remain disabled until their explicit phase approvals.

```powershell
npm run mta:build
cf deploy mta_archives/flowpilot_0.1.3.mtar
```

Deployment commands will be run only against the explicitly selected Cloud Foundry org and space. Environment-specific credentials and service keys must never be committed.

After the first deployment, validate and plan assignments for the predefined `FlowPilotUsers`, `FlowPilotOperators`, or `FlowPilotAdmins` role collections through the guarded Terraform interface. Applying an assignment still requires explicit review.

## Project documentation

- [Product scope](./docs/product.md)
- [Architecture](./docs/architecture.md)
- [Development guide](./docs/development.md)
- [Private chat milestone](./docs/chat-milestone.md)
- [Environment bootstrap and recovery](./docs/environment-bootstrap.md)
- [Role, secret, backup, and restore interfaces](./docs/recovery-interfaces.md)
- [Secure LLM provider configuration](./docs/llm-provider-configuration.md)
- [Architecture decisions](./docs/decisions/README.md)
