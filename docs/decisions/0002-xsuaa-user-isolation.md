# ADR 0002: Dedicated XSUAA Tenancy and Server-Side User Isolation

- Status: Accepted
- Date: 2026-08-15

## Context

FlowPilot is initially consumed by authorized users within one BTP subaccount. Each user must have private sessions and chat history. Cross-subaccount SaaS subscription is outside the MVP.

## Decision

Use XSUAA with `tenant-mode: dedicated`. AppRouter performs interactive authentication, while the backend independently validates forwarded tokens and scopes.

Derive conversation ownership from validated tenant and subject claims. Never accept an owner identity from the browser and never use email as the durable ownership key. Add database row-level protection when persistence is introduced.

## Consequences

- Access is managed through BTP role collections.
- User isolation does not depend on AppRouter browser sessions alone.
- The application must migrate to shared tenancy and SaaS Provisioning if it later serves other subaccounts.
- Isolation requires explicit negative tests using two identities.
