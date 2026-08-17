# Repeatable AI-Assisted Development Flow

## Purpose

This document is a living, platform-neutral playbook for building software with AI assistants such as Claude, Cursor, Codex, or future tools. It defines the repeatable process, required artifacts, quality gates, and human/AI responsibilities that should carry across projects.

The objective is not only to ship an application. It is to create a development system that makes future applications easier to plan, build, verify, operate, and hand over.

## Core principles

1. **The repository is the source of truth.** Important requirements, decisions, commands, and progress must live in version-controlled files rather than only in an AI chat.
2. **Human intent stays explicit.** The human owns goals, priorities, risk acceptance, credentials, permissions, and final product decisions.
3. **AI work must be reviewable.** Ask the AI to make scoped changes, explain important tradeoffs, run relevant checks, and report exactly what changed.
4. **Build vertical slices early.** Prove one end-to-end path before adding breadth or infrastructure.
5. **Use evidence-based gates.** A phase is complete only when its acceptance criteria are demonstrated by tests, deployed behavior, or reviewed artifacts.
6. **Prefer reversible decisions.** Use interfaces, configuration, and small commits where requirements are likely to change.
7. **Security and operations are design inputs.** Authentication, authorization, isolation, secrets, logging, recovery, and cost controls must not be deferred until the end.
8. **Record learning continuously.** Capture mistakes, successful prompts, useful commands, rejected approaches, and reusable patterns while they are fresh.

## The reusable lifecycle

```text
Frame -> Discover -> Decide -> Scaffold -> Prove -> Iterate -> Harden -> Release -> Learn
                         ^                    |                         |
                         +--------------------+-------------------------+
```

Every phase ends with a gate. If the evidence for a gate is missing, keep the phase open or explicitly record the accepted risk.

## Phase 0: Frame the problem

### Goal

Turn the initial idea into a bounded problem with measurable outcomes.

### Required artifacts

- One-paragraph problem statement.
- Target users and their main jobs.
- In-scope and out-of-scope lists.
- Functional requirements.
- Non-functional requirements such as security, latency, availability, privacy, and expected scale.
- Success measures.
- Known constraints and assumptions.

### AI workflow

- Ask the AI to identify ambiguities, conflicting requirements, hidden dependencies, and likely risks.
- Ask it to restate the requirements as testable outcomes.
- Do not ask for implementation until the important unknowns are visible.

### Gate

- [ ] The problem and target user are clear.
- [ ] The initial release boundary is explicit.
- [ ] Success can be evaluated objectively.
- [ ] Major assumptions are recorded.

## Phase 1: Discover the environment

### Goal

Confirm the real constraints of the target platform, repository, APIs, data, team, and deployment environment.

### Required artifacts

- Environment and dependency inventory.
- API and integration inventory.
- Authentication and authorization matrix.
- Data classification and retention needs.
- Platform entitlements, quotas, and cost assumptions.
- List of unresolved questions with owners.

### AI workflow

- Let the AI inspect the repository and available configuration before proposing changes.
- Require current primary documentation for changing platform capabilities.
- Separate verified facts from assumptions and recommendations.
- Never paste production secrets into prompts or repository files.

### Gate

- [ ] Required services and permissions are available.
- [ ] External dependencies and authentication flows are understood.
- [ ] Blocking unknowns have owners or experiments.
- [ ] Secret-management and local-development approaches are defined.

## Phase 2: Decide the architecture

### Goal

Choose the smallest architecture that satisfies the requirements and leaves intentional extension points.

### Required artifacts

- System-context and component diagrams.
- Technology decision table.
- Data ownership and trust boundaries.
- Deployment topology.
- Failure-mode and scaling assumptions.
- Architecture Decision Records for important or difficult-to-reverse choices.

### AI workflow

- Ask for two or three viable options with concrete tradeoffs.
- Challenge unnecessary services, frameworks, and abstractions.
- Ask how identity, data, failures, retries, and observability move across component boundaries.
- Record the chosen option and rejected alternatives in an ADR.

### Gate

- [ ] Every requirement maps to an architectural component or policy.
- [ ] Trust boundaries and data ownership are explicit.
- [ ] Major technology choices have written rationale.
- [ ] The first vertical slice is identified.

## Phase 3: Establish the repository and delivery foundation

### Goal

Create a reproducible project that another developer or AI assistant can understand and run.

### Recommended baseline

- `README.md` for purpose, setup, run, test, and deployment instructions.
- `DevFlow.md` for this lifecycle and project progress.
- `docs/architecture.md` for the current design.
- `docs/decisions/` for ADRs.
- `docs/product.md` for requirements and release scope.
- `.env.example` containing names and safe examples, never secrets.
- Automated format, lint, type-check, test, build, and security commands.
- A deterministic dependency lockfile.
- CI that runs the same checks used locally.

### AI workflow

- Ask the AI to inspect existing conventions before scaffolding.
- Prefer standard framework generators and documented platform conventions.
- Require one command for each common operation where practical.
- Verify generated files; do not treat generation as evidence that the application works.

### Gate

- [ ] A clean checkout can be configured from documented steps.
- [ ] Local checks run through documented commands.
- [ ] CI runs equivalent checks.
- [ ] No secrets, generated build output, or machine-specific files are committed.

## Phase 4: Prove one vertical slice

### Goal

Deliver the thinnest end-to-end path through the real architecture.

The first slice should normally include the user entry point, authentication, backend request, persistence or integration where applicable, error handling, logging, tests, and deployment.

### AI workflow

- Give the AI one user-visible outcome at a time.
- Ask it to state the files it expects to touch and the verification it will run.
- Use mocks only at boundaries that cannot yet be reached; clearly mark them.
- Test the deployed path, not only local functions.
- For authentication changes, test the complete provider redirect and callback with a real user; an initial login redirect alone is not proof of a working flow.

### Gate

- [ ] A real user can complete one useful workflow.
- [ ] Authorization is enforced on the backend.
- [ ] Failure behavior is visible and understandable.
- [ ] The path has automated tests and a deployment smoke test.

## Phase 5: Iterate in small feature loops

For each feature, repeat this loop:

1. Define the user outcome and acceptance criteria.
2. Inspect the relevant code and documentation.
3. Identify design impact and risks.
4. Write or update the implementation plan.
5. Implement the smallest coherent change.
6. Run focused tests, then broader regression checks.
7. Review the diff for correctness, security, and unnecessary complexity.
8. Update documentation and decisions.
9. Commit a coherent change.
10. Demonstrate the feature against its acceptance criteria.

### Feature gate

- [ ] Acceptance criteria pass.
- [ ] Relevant tests exist and pass.
- [ ] Error, authorization, and edge cases were considered.
- [ ] Logs do not expose secrets or inappropriate user data.
- [ ] Documentation matches the implemented behavior.
- [ ] The change can be rolled back or disabled safely.

## Phase 6: Harden the system

### Security

- Threat-model authentication, authorization, session isolation, API access, uploads, agent tools, and administrative functions.
- Apply least privilege and server-side authorization.
- Keep credentials in the platform secret store or approved CI secret store.
- Add rate limits, timeouts, payload limits, dependency scanning, and audit events.
- Treat external API, model, and tool output as untrusted input.

### Reliability

- Define timeouts, retries, idempotency, circuit breakers, and degradation behavior.
- Ensure application instances are stateless where horizontal scaling is expected.
- Test dependency failures and partial outages.
- Verify backup, restore, migration, and rollback procedures.

### Quality

- Run unit, integration, contract, end-to-end, security, and load tests appropriate to the risks.
- Test user and tenant isolation explicitly.
- Check accessibility and supported browsers for user interfaces.

### Gate

- [ ] Threats and mitigations are reviewed.
- [ ] Critical failure modes have tests or runbooks.
- [ ] Performance is acceptable at expected load.
- [ ] Backup, restore, and rollback paths are known.

## Phase 7: Release deliberately

### Required artifacts

- Versioned release candidate.
- Release notes.
- Environment-specific configuration checklist.
- Database migration and rollback plan.
- Deployment verification checklist.
- Operational dashboard and alert list.
- Known limitations.

### Gate

- [ ] CI is green on the exact release revision.
- [ ] Required approvals are recorded.
- [ ] Production configuration contains no development defaults.
- [ ] Smoke tests pass after deployment.
- [ ] Rollback criteria and responsible person are known.

## Phase 8: Operate and learn

### Goal

Use production evidence to improve both the product and the development process.

Track:

- User outcomes and adoption.
- Errors, latency, availability, and dependency health.
- Security and audit events.
- AI token usage and cost where applicable.
- Escaped defects and their root causes.
- Manual work that should become automation.

After each milestone, update the learning log:

```markdown
### YYYY-MM-DD — Milestone or incident

- What worked:
- What did not work:
- Evidence:
- Decision or process change:
- Reusable pattern:
- Follow-up owner:
```

## Platform-neutral AI collaboration protocol

### Start every AI work session with a task brief

```markdown
## Objective

What concrete outcome should exist when this task is done?

## Context

Which repository, feature, documentation, and prior decisions matter?

## Scope

What may the AI read, change, run, or deploy?

## Constraints

What technologies, compatibility, security, and style rules must be followed?

## Acceptance criteria

What observable evidence proves completion?

## Verification

Which tests, builds, reviews, or deployed checks are required?

## Exclusions

What must not be changed?
```

### Require this operating behavior from any AI assistant

1. Inspect before editing.
2. State assumptions and important risks.
3. Preserve unrelated work.
4. Keep changes within the authorized scope.
5. Use existing project conventions and primary documentation.
6. Run relevant verification after changes.
7. Report changed files, tests, remaining risks, and manual steps.
8. Never claim success without evidence.

### End every AI work session with a handoff

```markdown
## Completed

- User-visible and technical outcomes.

## Changed

- Files, configuration, dependencies, and infrastructure.

## Verified

- Commands and results.

## Decisions

- New ADRs or important tradeoffs.

## Remaining

- Open work, risks, and blockers.

## Recommended next step

- The smallest useful next action.
```

This handoff format makes work portable between AI platforms because the project state is written into the repository instead of depending on one assistant's conversation history.

### Maintain a problem-solving audit trail

For every material problem, incident, or blocked implementation, maintain a dated problem record in this file while the work is happening. The record must give the human reviewer a clear window into the observable evidence, alternatives considered, actions taken, and reasons for each decision. It must not depend on access to a particular AI chat or expose credentials, tokens, personal data, or private hidden model reasoning.

Use this structure:

```markdown
### YYYY-MM-DD — Problem title

- Objective:
- Initial symptom:
- Constraints and approval boundary:
- Evidence collected:

| Sequence | Hypothesis or question | Action or experiment | Result | Decision or next step |
| -------- | ---------------------- | -------------------- | ------ | --------------------- |
| 1        |                        |                      |        |                       |

- Root cause:
- Final change:
- Verification:
- Incorrect or incomplete assumptions corrected:
- Reusable lessons:
- Remaining risks or follow-up:
```

Audit-trail rules:

1. Record failed attempts as well as successful ones; do not rewrite history to make the solution appear linear.
2. Distinguish facts, hypotheses, inferences, and user-provided information.
3. Record relevant commands, deployment versions, files, and external primary sources when they make the result reproducible.
4. State when a diagnostic method was invalid or inconclusive and how that was discovered.
5. Never claim a root cause until the final behavior or a focused experiment supports it.
6. Keep the record platform-neutral where possible, and move broadly reusable lessons into the lifecycle rules.
7. Update the record in the background as part of the currently approved task; do not wait until details have been lost.

### Require human approval between phases

Finishing one phase, milestone, or feature does not authorize the AI assistant to begin the next one. At every transition, the assistant must stop and provide:

- what was completed and the evidence;
- important decisions and corrected assumptions;
- unresolved questions, risks, and dependencies;
- the proposed scope and acceptance criteria for the next phase;
- questions that need human input.

The next codebase phase or feature starts only after explicit human approval. Read-only inspection or discussion requested by the human is allowed, but must not silently expand into implementation. Documentation, verification, and audit-trail updates needed to finish the already approved task remain part of that task.

## Git working agreement

- Keep the default branch releasable.
- Use short-lived branches for coherent changes.
- Prefer small commits with clear intent.
- Do not combine unrelated formatting, refactoring, and feature work.
- Review the staged diff before committing.
- Reference requirements, issues, or ADRs when useful.
- Do not commit secrets, local credentials, generated packages, or AI chat transcripts containing sensitive information.

Suggested commit prefixes:

```text
feat:     user-visible capability
fix:      defect correction
docs:     documentation only
test:     test changes
refactor: behavior-preserving code change
build:    dependencies or build system
ci:       delivery automation
chore:    maintenance
```

## Definition of Done

A task is done only when:

- The requested behavior is implemented.
- Acceptance criteria are demonstrated.
- Relevant automated checks pass.
- Authorization, privacy, errors, and edge cases were considered.
- Documentation and configuration examples are current.
- No secrets or unrelated changes are included.
- The result is understandable to a new developer or a different AI assistant.
- Remaining limitations and risks are explicitly recorded.

## BTPApp progress tracker

| Phase                | Status                  | Evidence or next gate                                                                                                                                                                                                   |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Frame             | Complete                | Product scope, users, constraints, MVP boundary, and success criteria are in `docs/product.md`.                                                                                                                         |
| 1. Discover          | In progress             | BTP Cloud Foundry target and core trial services verified; target API authentication, model access, and the first OpenAPI YAML remain.                                                                                  |
| 2. Decide            | Complete for foundation | Architecture and initial XSUAA decisions are recorded in ADRs 0001 and 0002.                                                                                                                                            |
| 3. Foundation        | Complete for foundation | GitHub remote, modules, locked dependencies, MTA build, CI workflow, initial commit, and push are established.                                                                                                          |
| 4. Vertical slice    | In progress             | Checkpoints 1 and 2 are approved. The Checkpoint 3 SAP Horizon chat interface, CSRF-aware client, responsive behavior, and accessibility tests are complete and awaiting human review; deployment remains Checkpoint 4. |
| 5. Iterate           | Not started             | Begin after the first deployed vertical slice.                                                                                                                                                                          |
| 6. Harden            | Not started             | Threat model and production checks pending.                                                                                                                                                                             |
| 7. Release           | Not started             | Release process pending.                                                                                                                                                                                                |
| 8. Operate and learn | Not started             | Metrics and milestone retrospectives pending.                                                                                                                                                                           |

## FlowPilot application startup runbook

This is the living boot/start procedure for restoring the deployed FlowPilot application after SAP BTP trial-account cleanup or an intentional application stop. Update this section whenever a checkpoint adds, removes, renames, binds, or changes the startup order of a runtime dependency. Do not assume that commands from an earlier checkpoint still describe the deployed system.

**Last verified:** 2026-08-17, against Cloud Foundry organization `7d472741trial`, space `dev`, API endpoint `https://api.cf.us10-001.hana.ondemand.com`.

### Current deployment boundary

The live deployment is still the authentication-only application from MTA 0.1.3. The completed Checkpoint 2 backend exists in the repository but has not been deployed. Consequently, the live application has two Cloud Foundry runtime applications and does not yet depend on PostgreSQL at runtime.

### Daily startup procedure

1. Log in to Cloud Foundry using SSO:

   ```powershell
   cf login --sso -a https://api.cf.us10-001.hana.ondemand.com
   ```

2. Select and verify the expected organization and space:

   ```powershell
   cf target -o 7d472741trial -s dev
   cf target
   ```

3. Inspect application state before changing anything:

   ```powershell
   cf apps
   ```

4. Start the API first, followed by the AppRouter. These commands are safe to run when the applications are already started:

   ```powershell
   cf start flowpilot-api
   cf start flowpilot-approuter
   ```

5. Confirm that both applications show requested state `started` and process state `web:1/1`:

   ```powershell
   cf apps
   ```

6. Open the application and complete the real authentication callback:

   ```text
   https://7d472741trial-dev-flowpilot-approuter.cfapps.us10-001.hana.ondemand.com
   ```

The BTP cockpit alternative is **Subaccount -> Cloud Foundry -> Spaces -> dev -> Applications**. Start `flowpilot-api`, then `flowpilot-approuter`, and confirm that each has one running instance.

### Current resource startup matrix

| Resource                 | Current role                             | Daily startup action           | Reason or verification                                                                                                      |
| ------------------------ | ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `flowpilot-api`          | Cloud Foundry API runtime                | `cf start flowpilot-api`       | Trial cleanup stops applications daily. Verify `web:1/1`.                                                                   |
| `flowpilot-approuter`    | Authenticated UI entry point and routing | `cf start flowpilot-approuter` | Trial cleanup stops applications daily. Verify `web:1/1`.                                                                   |
| `flowpilot-web`          | Build-time static web content            | None                           | It is packaged into the AppRouter and is not a separate Cloud Foundry runtime application.                                  |
| `flowpilot-auth`         | Managed XSUAA service                    | None                           | Managed service instances are not started with `cf start`; verify their broker operation with `cf services` when necessary. |
| `flowpilot-destination`  | Managed Destination service              | None                           | Managed service; no daily application-start command.                                                                        |
| `flowpilot-logs`         | Managed Application Logging service      | None                           | Managed service; no daily application-start command.                                                                        |
| `flowpilot-postgres`     | Retained PostgreSQL trial service        | None at the current checkpoint | It is healthy but unbound, and the live MTA 0.1.3 application does not use it yet.                                          |
| `demo-api`, `demo-iflow` | Unrelated Integration Suite resources    | None for FlowPilot             | They are not bound to the current FlowPilot applications and are not part of its boot sequence.                             |

Inspect managed-service provisioning state with:

```powershell
cf services
cf service flowpilot-postgres
```

`flowpilot-postgres` should currently report `create succeeded`. There is no `cf start flowpilot-postgres` operation: `cf start` controls Cloud Foundry applications, while PostgreSQL is broker-managed. Once a deployed checkpoint binds the API to PostgreSQL, this runbook must add database-readiness verification before accepting API health.

### Failure triage

If an application is requested as `started` but does not reach `web:1/1`, inspect its logs before redeploying:

```powershell
cf logs flowpilot-api --recent
cf logs flowpilot-approuter --recent
```

Then retry only the affected runtime application:

```powershell
cf restart flowpilot-api
cf restart flowpilot-approuter
```

Use this decision boundary:

- `stopped`: start the two runtime applications.
- `started` with `web:0/1`, `crashed`, or repeated restarts: collect recent logs and diagnose the dependency or startup failure.
- managed service present with a successful last operation: do not attempt an application-style start.
- managed service missing or showing a failed broker operation: treat this as service recovery, not normal daily startup, and do not recreate or delete it without reviewing data-loss and binding consequences.
- application missing: treat this as deployment recovery. Do not blindly deploy the latest repository state because it may contain a later checkpoint with additional configuration and secret requirements.
- trial account suspended or expired: restore or extend the trial account in the BTP cockpit; application start commands cannot repair an invalid account.

### Mandatory update rule for future checkpoints

At every deployment-affecting checkpoint, update this runbook in the same approved task and record:

1. The exact deployed MTA or application version and verification date.
2. Every runtime application and the required startup order.
3. Every required managed service, binding, route, destination, credential source, and external dependency.
4. Which services are manually startable, broker-managed, automatically resumed, or subject to lifecycle expiry.
5. The minimum health and smoke tests that prove the complete application is usable.
6. Failure-specific diagnostic commands and the safe recovery boundary.
7. Any newly discovered hurdle, unsuccessful diagnostic, corrected assumption, and final verified solution in the dated problem-solving audit trail.

Primary operational references: [SAP BTP trial accounts and free tier](https://help.sap.com/docs/btp/sap-business-technology-platform/trial-accounts-and-free-tier?locale=en-) and [Start, Stop, and Restart Applications](https://help.sap.com/docs/btp/sap-business-technology-platform/start-stop-and-restart-applications).

### 2026-08-17 — Trial-account daily startup requirements

- Objective: Establish a definitive daily recovery procedure for the currently deployed FlowPilot application without confusing Cloud Foundry applications with broker-managed services.
- Initial symptom: SAP BTP trial cleanup can stop runtime applications daily, and it was unclear whether the retained PostgreSQL trial instance also needed a manual start.
- Constraints and approval boundary: Inspect and document the current environment only; do not redeploy FlowPilot, change service bindings, expose credentials, or begin the next checkpoint.
- Evidence collected: SAP's current trial documentation states that applications stop automatically each day and require manual restart. Live Cloud Foundry inspection showed `flowpilot-api` and `flowpilot-approuter` at `web:1/1`; `flowpilot-postgres` reported `create succeeded` and no bound applications.

| Sequence | Hypothesis or question                                                          | Action or experiment                                                                                             | Result                                                                                                                 | Decision or next step                                                                                           |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1        | Which FlowPilot resources are runtime applications that trial cleanup can stop? | Ran `cf apps` against the confirmed organization and space.                                                      | Exactly two FlowPilot runtime applications were present: `flowpilot-api` and `flowpilot-approuter`, both at `web:1/1`. | Put only these applications in the current daily `cf start` sequence.                                           |
| 2        | Does the web module require a separate start?                                   | Compared the live application list with the MTA module responsibilities already verified during deployment.      | No `flowpilot-web` runtime application exists; its output is packaged into the AppRouter.                              | Explicitly exclude `flowpilot-web` from startup commands.                                                       |
| 3        | Does PostgreSQL require a daily `cf start`?                                     | Ran `cf services` and `cf service flowpilot-postgres`; compared the resource type with CF application controls.  | PostgreSQL is a managed service with `create succeeded`, no bound apps, and no application-style start operation.      | Do not run or invent `cf start` for PostgreSQL; inspect broker state instead.                                   |
| 4        | Is PostgreSQL currently required for the user-visible deployed app?             | Compared the live MTA 0.1.3 deployment boundary with the completed but undeployed Checkpoint 2 repository state. | The live authentication-only application is not bound to PostgreSQL; the new private-chat backend is not deployed.     | Do not make PostgreSQL a current daily boot prerequisite; add readiness checks when the backend is deployed.    |
| 5        | What evidence distinguishes a successful start from requested state alone?      | Reviewed SAP's application operations guidance and the live `cf apps` process counts.                            | Requested state can be `started` while an instance is unhealthy; `web:1/1` is required for this deployment.            | Require both requested state and running process count, followed by a real browser authentication smoke test.   |
| 6        | Can the normal Markdown formatting check validate the runbook update?           | Tried global `npx prettier --check DevFlow.md`, then invoked the repository-installed Prettier directly.         | The global `npx` launcher referenced a missing module; the repository-local formatter wrote and validated the file.    | Treat the first error as a machine-level launcher fault and use the locked repository tool for reproducibility. |

- Root cause: There was no application-specific operational runbook distinguishing daily-stopped CF applications from managed services and build-only modules.
- Final change: Added the living FlowPilot startup runbook, current resource matrix, exact CLI and cockpit sequence, health criteria, failure boundaries, and mandatory checkpoint update rule.
- Verification: Current CF target, applications, bindings, and PostgreSQL broker status were inspected without mutation; the documented application names and states match the live `dev` space. Repository-local Prettier and `git diff --check` pass.
- Incorrect or incomplete assumptions corrected: A provisioned PostgreSQL trial service is not another Cloud Foundry application and cannot be started with `cf start`. A requested state of `started` is not by itself proof that an application instance is healthy.
- Reusable lessons: Generate startup procedures from the deployed topology rather than the repository's newest code. Separate daily application startup, managed-service inspection, and deployment recovery into distinct operational paths. Prefer the repository's locked formatter over a machine-global launcher.
- Remaining risks or follow-up: The runbook must change when Checkpoint 2 is deployed because the API will then require PostgreSQL and secure model-provider configuration. Trial-plan lifecycle expiry is separate from daily application stopping and requires monitoring and backup planning.

### 2026-08-17 — Checkpoint 3 SAP chat interface implementation

- Objective: Replace the custom authenticated status page with an accessible, responsive SAP Horizon chat interface that consumes the approved private-conversation API without deploying it to BTP.
- Initial symptom: The deployed-style frontend was a static custom-gradient page. It could verify `/api/me` but had no conversation navigation, message history, composer, provider-safe error states, AppRouter CSRF handling, or frontend interaction tests.
- Constraints and approval boundary: Implement Checkpoint 3 only. Use SAP UI5 Web Components for React and SAP theme variables, preserve complete-response messaging, keep model/provider selection server-side, do not configure secrets, and do not deploy or begin Checkpoint 4.
- Evidence collected: The approved milestone defined the UI states and API contract. Current UI5 documentation confirmed that `sap_horizon` is the default theme and that UI5 styling uses SAP CSS variables. Current AppRouter documentation confirmed that authenticated non-GET/HEAD routes require a fetched `X-CSRF-Token` by default.

| Sequence | Hypothesis or question                                                                       | Action or experiment                                                                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                | Decision or next step                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Which current SAP component version and theme contract should the UI use?                    | Verified the current UI5 Web Components React package, UI5 theme configuration, and CSS-variable guidance before changing dependencies.                                                                                                                            | UI5 React 2.25.0 was current; Morning Horizon (`sap_horizon`) remained the built-in default; SAP global theme tokens support responsive custom layout without a custom color system.                                                                                                  | Pin compatible 2.25.x UI5 packages, set `sap_horizon` explicitly, and use SAP variables for every application-level color, border, shadow, font, and radius.                                                                    |
| 2        | Why did the normal npm commands not give a reproducible dependency result?                   | Tried the normal `npm install`/`npm ls` path, inspected the launcher, and then called the installed npm CLI through the known Node executable.                                                                                                                     | The machine launcher redirected to a missing roaming `npm-cli.js`; the explicit installed CLI completed dependency installation and reported zero vulnerabilities.                                                                                                                    | Record this as a workstation launcher fault and use the explicit installed CLI for verification rather than changing application dependencies to work around it.                                                                |
| 3        | Why was `ShellBar` unavailable after installing the React wrapper?                           | Inspected the installed dependency tree and the wrapper's peer metadata.                                                                                                                                                                                           | `@ui5/webcomponents-fiori` is an optional peer dependency even though `ShellBar` imports its implementation, so it remained unmet.                                                                                                                                                    | Add the matching Fiori package explicitly instead of relying on an optional transitive installation.                                                                                                                            |
| 4        | Will browser POST requests work through the existing secure AppRouter route?                 | Reviewed the AppRouter CSRF contract and expanded the typed API client to fetch, cache, send, refresh, and retry a CSRF token once.                                                                                                                                | The previous GET-only frontend would have received `403` on protected POST requests. Unit tests proved initial-token use, expired-token refresh, one retry, safe error parsing, and encoded conversation paths.                                                                       | Keep AppRouter CSRF enabled and own the token lifecycle in the frontend API boundary.                                                                                                                                           |
| 5        | Do the main create, load, send, keyboard, failure, and accessibility states work under test? | Added React Testing Library, jsdom, and axe-core tests, then ran the focused suite.                                                                                                                                                                                | Nine of ten tests initially passed. The failure came from querying one `Test User` string even though the accessible UI intentionally rendered it in several contexts.                                                                                                                | Change the assertion to accept multiple legitimate occurrences; do not remove useful user context to satisfy an over-specific test.                                                                                             |
| 6        | Can UI5 run without an external runtime asset dependency?                                    | Observed UI5's test warning about falling back to a CDN for locale data and imported the UI5 main and Fiori asset registries in the production entry point.                                                                                                        | The warning disappeared and the build emitted local theme and locale resources, avoiding a runtime CDN dependency.                                                                                                                                                                    | Keep UI5 assets self-hosted in the application package; revisit supported-locale pruning only as a measured optimization.                                                                                                       |
| 7        | Does the production bundle stay within Vite's default chunk recommendation?                  | Built the UI, then replaced root-barrel UI5 imports with supported per-component exports and rebuilt.                                                                                                                                                              | The build succeeded, but the self-contained UI5 runtime entry remained about 946 KB uncompressed and Vite retained its 500 KB advisory. The change reduced accidental import coupling but did not materially reduce the entry chunk.                                                  | Accept the warning for this checkpoint because the compressed entry is about 220 KB and behavior is correct; keep bundle analysis/code splitting as a documented performance follow-up rather than hiding the warning.          |
| 8        | Did a quiet production-build retry expose a code failure?                                    | Invoked Vite from the repository root with the web config to reduce noisy asset output, then reran it from `apps/web`.                                                                                                                                             | The root invocation could not find `index.html` because Vite resolves its entry from the working directory; the module-directory invocation succeeded and reproduced only the known size advisory.                                                                                    | Classify the first command as an invalid verification invocation, not a product defect; run module-relative build tools from their owning module.                                                                               |
| 9        | Does the browser rendering match the intended desktop layout?                                | Started a deterministic local mock API and Vite preview, opened the actual page, inspected its DOM, geometry, and screenshots. The first full-page screenshot was visually ambiguous, so viewport geometry and a normal screenshot were used to confirm placement. | The Horizon components rendered, but conditional omission of the error strip caused CSS Grid auto-placement to put the message region and composer in the wrong rows, leaving excess composer height.                                                                                 | Assign explicit grid rows to the header, optional error strip, message region, and composer; verify again in the real browser.                                                                                                  |
| 10       | Does the corrected layout remain usable on a narrow screen?                                  | Rechecked desktop geometry, applied a temporary 390 x 844 viewport, inspected panel bounds and horizontal overflow, and captured the mobile rendering.                                                                                                             | Desktop message/composer proportions were corrected. Mobile stacked navigation and chat without horizontal overflow, and UI5 preserved touch-sized actions and accessible labels.                                                                                                     | Accept both breakpoints and reset the temporary browser viewport after verification.                                                                                                                                            |
| 11       | Can real browser automation operate the UI5 shadow-DOM composer and account menu?            | First used the semantic Playwright label locator, then used the browser's visible-DOM interaction path when `fill` could not target the internal textarea. Sent a message with Ctrl+Enter and opened the ShellBar profile action.                                  | The semantic tree exposed the textbox, but the direct fill locator returned no match for the shadow input. The visible-DOM path successfully typed and submitted; the mock response appeared, the draft cleared, and the account dialog showed authenticated-user and tenant context. | Keep semantic assertions in automated tests and use a shadow-DOM-aware interaction surface for browser smoke tests; do not treat an accessibility-tree match as proof that every automation locator can mutate a web component. |
| 12       | Why did the first full-repository gate report missing API test and TypeScript executables?   | Inspected `apps/api/node_modules` after the earlier production packaging attempt and compared it with the MTA commands.                                                                                                                                            | The MTA build deliberately runs `npm prune --omit=dev`; because it operates in the source module directory, the local development binaries had been removed.                                                                                                                          | Restore the API module from its lockfile with `npm ci --include=dev` before rerunning development gates; treat this as build-workspace mutation, not an application failure.                                                    |
| 13       | Was the API production-build failure a TypeScript or bundling defect?                        | Ran the full production build in the restricted workspace, inspected the `esbuild` access error, and repeated the exact API build with approved access.                                                                                                            | The restricted run could not traverse the parent workspace packages used by the API bundle. The unchanged command passed with the required filesystem access.                                                                                                                         | Keep the successful authorized build as the production result and record the first failure as a local sandbox boundary.                                                                                                         |
| 14       | Why did the first strict MTA invocation fail before building a module?                       | Read the MBT error, located the installed GNU Make executable, and repeated the build with `C:\Program Files (x86)\GnuWin32\bin` added only to that process's `PATH`.                                                                                              | MBT was installed, but GNU Make was not discoverable from the normal shell path. The scoped path correction allowed the module build to start.                                                                                                                                        | Do not change application code for a workstation tool-discovery fault; use the known Make path for strict local packaging.                                                                                                      |
| 15       | Did the first Make-enabled retry finish after its command wrapper stopped returning output?  | Monitored the exact build process and archive timestamp instead of assuming success, then validated and removed only MBT's generated temporary directory and Makefile after the process ended without a new archive.                                               | The wrapper lost the remaining output and no new MTAR was produced, so success could not be claimed.                                                                                                                                                                                  | Rerun the same strict build in a captured session and require its exit code and archive generation as evidence.                                                                                                                 |
| 16       | Why did the captured strict build fail while reinstalling the web module?                    | Inspected the `EPERM unlink` path and checked the two Node processes started for the browser smoke test.                                                                                                                                                           | The local Vite preview still held Rolldown's native Windows DLL open, preventing `npm ci` from replacing it.                                                                                                                                                                          | Stop only the two preview/mock processes started for this checkpoint, validate and remove only failed MBT artifacts, and rerun from a clean captured session.                                                                   |
| 17       | Could the local development dependencies be restored normally after successful packaging?    | Ran the locked API development install after MBT's production prune, then repeated the unchanged install with approved npm-cache access when the restricted run failed.                                                                                            | The restricted run received `EPERM` while reading one file in the user npm cache; the approved retry installed 211 packages, audited 212, and found zero vulnerabilities.                                                                                                             | Leave the workspace development-ready and record the cache permission failure as an environment limitation rather than weakening the locked install.                                                                            |
| 18       | Does the final deployable artifact pass the real strict packaging gate?                      | Ran the captured MBT build with strict mode after releasing the preview lock and watched all module builds, audits, metadata generation, archive creation, and cleanup to completion.                                                                              | API, web, and AppRouter modules all built successfully. MBT generated `mta_archives/flowpilot_0.1.3.mtar` (34,223,698 bytes), returned exit code 0, and cleaned its temporary build files.                                                                                            | Accept the MTA as the Checkpoint 3 packaging proof, retain it locally, and do not deploy it before Checkpoint 4 approval.                                                                                                       |

- Root cause: The original frontend implemented authentication status only. Additional implementation hurdles came from a broken machine-global npm launcher, an optional Fiori peer package, missing AppRouter CSRF-token handling, external UI5 locale fallback, CSS Grid auto-placement around conditional content, differing automation behavior across UI5 shadow-DOM surfaces, workstation Make discovery, production pruning of source-tree development dependencies, a preview-held native DLL, and restricted cache/package access during local verification.
- Final change: Added the SAP Horizon `ShellBar`, authenticated account popover, private conversation navigation, message history, empty/loading/busy/error states, responsive composer, Ctrl/Command+Enter submission, a typed CSRF-aware API client, locally bundled UI5 assets, and frontend behavior/accessibility tests. Removed the custom gradients and hard-coded color system in favor of SAP theme variables.
- Verification: All four module type-checks pass. The full deterministic suite passes 29 tests: 6 model-adapter, 1 agent-core, 12 API, and 10 web tests; the optional local PostgreSQL test remains skipped because no local database URL was supplied, while Checkpoint 2's real BTP PostgreSQL isolation gate is already approved. API and web production builds pass. The strict MTA build produced `flowpilot_0.1.3.mtar` with exit code 0. The frontend tests cover create/send/failure behavior, CSRF lifecycle, keyboard submission, landmarks, and an axe scan with no serious or critical violations. Real local browser checks passed desktop rendering, a 390 px layout with no horizontal overflow, message submission, response rendering, draft clearing, and account-menu behavior. Repository formatting and whitespace checks pass after the audit update.
- Incorrect or incomplete assumptions corrected: Installing the React wrapper alone does not guarantee Fiori components are present. A GET-only API client is insufficient when authenticated AppRouter routes protect POST requests. UI component tests do not prove grid placement. A semantic locator that reads a custom element may still be unable to fill its shadow input. Per-component imports do not by themselves eliminate the size of a self-contained UI5 runtime and asset set. A successful module build can mutate source-tree `node_modules`, and a stopped-looking command wrapper does not prove that an MTA build succeeded. A native build error can be caused by a preview-process file lock rather than the dependency lockfile.
- Reusable lessons: Verify routing security requirements when a UI evolves from reads to writes. Treat UI framework peer dependencies as explicit deployment inputs. Bundle localization assets locally when runtime CDN access is undesirable. Combine component tests, automated accessibility checks, geometry inspection, and real responsive interaction. Record invalid verification commands separately from product defects. Require an MTA exit code plus a newly generated archive, stop owned preview processes before clean installs, and restore development dependencies after production pruning.
- Remaining risks or follow-up: Checkpoint 3 needs human review. The new UI and Checkpoint 2 backend remain undeployed; no Groq call or Credential Store retrieval has occurred. The UI5 entry chunk exceeds Vite's advisory threshold and should be profiled if measured startup performance is unacceptable. Checkpoint 4 must bind services, configure the provider credential securely, deploy a versioned MTA, update the startup runbook, and perform the real authenticated persistence smoke test.

### 2026-08-16 — BTP authentication callback failure

- Objective: Complete SAP ID authentication through XSUAA and AppRouter, then prove that the authenticated browser can call the protected `/api/me` endpoint.
- Initial symptom: After authenticating, the browser displayed `Authorization Request Error` and reported that the OpenID provider could not process the request because of configuration issues.
- Constraints and approval boundary: Diagnose and fix the deployed authentication foundation in the user's BTP trial space; preserve OAuth security protections; do not begin the chat implementation.
- Evidence collected: Both Cloud Foundry applications were healthy; direct access to the API's protected endpoint returned `401`; the browser reached XSUAA and SAP ID but initially did not return through the AppRouter callback; the requested callback was `https://7d472741trial-dev-flowpilot-approuter.cfapps.us10-001.hana.ondemand.com/login/callback`.

| Sequence | Hypothesis or question                                                                                 | Action or experiment                                                                                                                                                                                                                                                   | Result                                                                                                                                                                                                                                                      | Decision or next step                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1        | The deployed applications or route might be unavailable.                                               | Checked Cloud Foundry application health, the API health endpoint, and direct protected API behavior.                                                                                                                                                                  | Both applications were running, health returned `200`, and direct `/api/me` correctly returned `401`.                                                                                                                                                       | Focus on the OAuth/OpenID redirect flow rather than application availability.          |
| 2        | AppRouter 23's default PKCE parameters might be incompatible with the trial subaccount's SAP ID trust. | Set `PKCE_ENABLED` to `false`, built and deployed MTA 0.1.1, and repeated login.                                                                                                                                                                                       | OAuth state remained present, but the same provider error occurred.                                                                                                                                                                                         | The PKCE hypothesis was not supported; do not accept this as the fix.                  |
| 3        | PKCE might still be present elsewhere in the provider chain.                                           | Inspected the live authorization URLs in the browser after SAP ID login.                                                                                                                                                                                               | XSUAA independently added a PKCE challenge on its request to SAP ID, and the failure occurred after provider authentication.                                                                                                                                | Restore AppRouter PKCE and investigate provider/client configuration.                  |
| 4        | The default SAP ID trust or trial control plane might be misconfigured.                                | Compared the behavior with SAP documentation and the trial cockpit; observed a cockpit console message referencing `cf-eu10` while the Cloud Foundry target was `us10-001`.                                                                                            | The region inconsistency was suspicious but did not prove the application login root cause.                                                                                                                                                                 | Record it as inconclusive and continue with application-specific OAuth configuration.  |
| 5        | XSUAA might be rejecting an unregistered non-local callback URI.                                       | Checked SAP's redirect-URI guidance and found that cloud callbacks must be explicitly registered.                                                                                                                                                                      | `xs-security.json` and the deployed MTA had no explicit AppRouter login callback registration.                                                                                                                                                              | Add an exact callback without hard-coding organization, space, route, or region.       |
| 6        | An MTA provided property could inject `${default-url}/login/callback` into XSUAA.                      | Added an AppRouter `provides` property and initially placed `oauth2-configuration` under the resource dependency's `requires.parameters`; tried the full `~{flowpilot-approuter-binding/redirect-uri}` reference.                                                      | Deployment could not resolve the expression, so the operation was aborted.                                                                                                                                                                                  | Recheck descriptor structure instead of weakening the callback pattern.                |
| 7        | A shorter property reference might resolve in that nesting.                                            | Changed the reference to `~{redirect-uri}`, built and deployed MTA 0.1.2, and retried authentication.                                                                                                                                                                  | The authentication error persisted. A later parameter-check script printed a blank URI, but the raw Cloud Foundry response showed that XSUAA does not support fetching instance parameters; the blank output was therefore an invalid diagnostic inference. | Correct the diagnostic record and compare the descriptor with an official SAP example. |
| 8        | The OAuth configuration was nested at the wrong MTA level.                                             | Compared the descriptor with SAP's official Cloud CAP MTA sample. Moved the provider dependency to the XSUAA resource's `requires` and moved `oauth2-configuration` to the resource's `parameters.config`; restored PKCE; used the fully qualified property reference. | Strict MTA build succeeded and MTA 0.1.3 deployed with both applications healthy.                                                                                                                                                                           | Perform a complete browser callback test before declaring success.                     |
| 9        | The corrected callback registration should complete the full flow.                                     | Started a fresh authorization request in the authenticated browser and observed the final UI state.                                                                                                                                                                    | SAP ID returned through XSUAA and AppRouter to FlowPilot. The UI displayed the authenticated user; that UI state is reached only after `/api/me` returns successfully.                                                                                      | Accept the callback registration as the supported root cause and final fix.            |

- Root cause: The AppRouter's non-local `/login/callback` URI was not registered in XSUAA. The first dynamic-registration attempts also placed `oauth2-configuration` at the wrong MTA level.
- Final change: MTA 0.1.3 keeps OAuth state and PKCE enabled, exposes the exact AppRouter callback as a provided property, declares the provider dependency under the XSUAA resource's `requires`, and injects the URI under `parameters.config.oauth2-configuration.redirect-uris`.
- Verification: Strict MTA build passed; both Cloud Foundry applications reported `1/1` healthy; the real SAP ID redirect and callback completed; the frontend reached its authenticated state after the protected `/api/me` request succeeded; formatting, type-checking, three automated tests, and production builds passed.
- Incorrect or incomplete assumptions corrected: Disabling AppRouter PKCE was not the fix. A blank value printed after parsing an unsupported service-parameter endpoint was not evidence of the stored XSUAA configuration.
- Reusable lessons: Test the complete identity-provider callback, not only the initial redirect. Check an API response for errors before reading expected fields. For MTA resources, keep dependencies under `requires` and service configuration under `parameters.config`. Compare unusual platform configuration with a current primary-source sample before deploying another variation.
- Remaining risks or follow-up: Preserve the real-user authentication smoke test when adding chat persistence and roles. User-to-user chat-history isolation still needs dedicated persistence and authorization tests in a later, explicitly approved phase.

### 2026-08-16 — Private-chat design constraints

- Objective: Define the first useful chat slice without starting implementation, incorporating SAP-standard theming, Groq as the default provider, secure third-party credentials, PostgreSQL persistence, and the trial account's single-user limitation.
- Initial symptom: The deployed application proved authentication but remained a custom-gradient status page with no chat, persistence, model call, or practical two-user cloud test path.
- Constraints and approval boundary: Produce Checkpoint 1 design and teaching material only. Do not provision services or implement feature code before human review.
- Evidence collected: The repository uses hard-coded colors and gradients; the targeted marketplace exposes `postgresql-db` with a `trial` plan and `credstore` with a `trial` plan; the user reported that a second trial user cannot be created; current Groq and LangChain documentation lists the Groq adapter and `llama-3.3-70b-versatile` as a production model.

| Sequence | Hypothesis or question                                                          | Action or experiment                                                                                                 | Result                                                                                                                                                                             | Decision or next step                                                                                                                            |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Which SAP-native UI approach fits the existing React application?               | Reviewed the current custom CSS and the official UI5 Web Components theme configuration.                             | UI5 Web Components supports React usage and includes `sap_horizon` as its standard default theme.                                                                                  | Adopt UI5 Web Components for React, remove gradients, and limit custom CSS to SAP theme variables.                                               |
| 2        | Can Groq remain the default without coupling LangGraph to Groq?                 | Checked the current LangChain Groq adapter and provider-neutral chat-model interfaces.                               | `@langchain/groq` implements the common chat-model contract used by LangGraph.                                                                                                     | Inject a provider-neutral model into the graph; support Groq, OpenAI, and Anthropic adapters behind one factory.                                 |
| 3        | Which Groq model is suitable as a configurable default?                         | Checked Groq's current production-model catalog and deprecation guidance.                                            | `llama-3.3-70b-versatile` is currently listed as a production model, but provider model IDs can be deprecated.                                                                     | Use it as the initial default while keeping the model ID in server configuration and checking deprecations before releases.                      |
| 4        | Should the API key be stored as an ordinary Cloud Foundry environment variable? | Compared Cloud Foundry credential guidance with SAP Credential Store capabilities and checked the trial marketplace. | Cloud Foundry advises service bindings for sensitive values; Credential Store is designed for BTP application passwords and keys and is available in the trial space.              | Store deployed provider keys in Credential Store; keep only non-secret model selection in MTA properties.                                        |
| 5        | Can privacy be proven without a second BTP trial identity?                      | Separated automated identity/isolation evidence from deployed real-user evidence.                                    | A real two-user trial smoke test is unavailable, but unit and PostgreSQL integration tests can execute the same authorization paths with two distinct validated-identity fixtures. | Require automated two-identity negative tests, a deployed single-user unknown-ID denial test, and explicitly defer the real two-user cloud test. |
| 6        | Is the intended persistence service actually available?                         | Queried the targeted Cloud Foundry marketplace.                                                                      | `postgresql-db` with a `trial` plan is available.                                                                                                                                  | Use BTP PostgreSQL for the conversation catalog and LangGraph checkpoint state.                                                                  |
| 7        | Can the normal repository formatter validate the local environment template?    | Included `.env.example` in a focused Prettier check.                                                                 | Prettier could not infer a parser for the environment file, while Markdown formatting and local-link checks passed.                                                                | Exclude environment templates from Prettier and validate them separately as uppercase key/value records.                                         |

- Root cause: Not applicable; this was a design checkpoint. The main constraints were an intentionally minimal authentication-only UI, provider-secret handling requirements, and the lack of a second trial identity.
- Final change: Added ADRs for SAP Horizon UI, Groq-first provider-neutral models, and PostgreSQL isolation; added the private-chat delivery plan and secure BTP LLM configuration guide; added safe local model placeholders; updated product, architecture, and repository milestone documentation.
- Verification: Cross-checked choices with the live BTP marketplace and current primary documentation from SAP, Cloud Foundry, LangChain, UI5, and Groq. Prettier passed for all formatted documents, all local Markdown links resolved, the environment template passed its separate key/value validation, and `git diff --check` passed.
- Incorrect or incomplete assumptions corrected: A real two-user BTP smoke test cannot be treated as an MVP trial gate. Ordinary environment variables are not the preferred location for provider API keys. Model portability means switching among installed and tested adapters without graph changes, not loading an arbitrary unreviewed provider from the browser.
- Reusable lessons: Separate cloud-environment evidence from automated security evidence; disclose missing production-grade tests. Store provider secrets behind a platform secret service, keep model selection server-side, and use provider projects and limits per environment. Treat model IDs as replaceable configuration because provider catalogs change.
- Remaining risks or follow-up: Checkpoint 2 requires explicit approval. The actual Credential Store retrieval contract, PostgreSQL row-level policies, model adapter behavior, and two-identity tests must be implemented and verified. A real deployed two-user test remains required before production use.

### 2026-08-16 — Checkpoint 2 private-chat backend implementation

- Objective: Implement the approved backend-only checkpoint: reusable model adapters, a minimal LangGraph workflow, PostgreSQL ownership and checkpoints, protected conversation APIs, and automated two-identity denial tests.
- Initial symptom: The API exposed only `/api/me`; no conversation, database, graph, or model runtime existed.
- Constraints and approval boundary: Do not implement the SAP chat UI or deploy the application. Use Groq by default, keep tests provider-free, use actual PostgreSQL for the database gate, and stop after Checkpoint 2 review.
- Evidence collected: Current API and MTA structure were inspected; Docker CLI is installed but its daemon is not running; no local PostgreSQL client or service is installed; BTP marketplace confirmed `postgresql-db/trial`; selected LangChain packages support Node 24 and share compatible `@langchain/core` versions. SAP documents that BTP PostgreSQL enforces SSL, and node-postgres documents that connection-string SSL parameters can override separately supplied settings.

| Sequence | Hypothesis or question                                                                                              | Action or experiment                                                                                                                                                                                                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                | Decision or next step                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | How can reusable TypeScript packages remain independently testable and still be packaged inside the API MTA module? | Added standalone `agent-core` and `model-adapters` packages, packed them into the API through local file dependencies with `install-links=true`, and bundled API-owned source with esbuild while leaving installed packages external.                                                                                                                                           | Package boundaries compile independently and the API can ship copied package contents rather than broken links outside its MTA module.                                                                                                                                | Keep package build/install ordering explicit in root and MTA commands.                                                                                        |
| 2        | Can privacy tests run against local PostgreSQL?                                                                     | Checked Docker, `psql`, and Windows services.                                                                                                                                                                                                                                                                                                                                   | Docker daemon, `psql`, and a local PostgreSQL service are unavailable.                                                                                                                                                                                                | Keep unit tests local but require the approved BTP PostgreSQL trial instance for the real RLS/checkpoint test.                                                |
| 3        | Why did the new standalone packages initially fail type-checking?                                                   | Ran package type-checks immediately after adding their sources.                                                                                                                                                                                                                                                                                                                 | Each package lacked its own Node type declarations; relying on the API's dev dependency does not work across a standalone package boundary.                                                                                                                           | Add `@types/node` and `types: ["node"]` to each owning package.                                                                                               |
| 4        | Can the approved BTP PostgreSQL service be provisioned for integration testing?                                     | Ran `cf create-service postgresql-db trial flowpilot-postgres`.                                                                                                                                                                                                                                                                                                                 | Cloud Foundry rejected the request because the CLI token expired; no service was created.                                                                                                                                                                             | Ask the user to repeat `cf login --sso`, continue safe local work, and leave the real database gate open.                                                     |
| 5        | Do adapter, graph, API, validation, and simulated isolation paths work without provider or database credentials?    | Added fake-model and in-memory repository tests and ran package/API suites.                                                                                                                                                                                                                                                                                                     | Groq/OpenAI/Anthropic construction, LangGraph thread separation, conversation flows, invalid input rejection, and two-identity list/read/write denial passed; the real PostgreSQL test was correctly skipped without `TEST_DATABASE_URL`.                             | Preserve fake dependencies for deterministic tests and run the separate PostgreSQL suite when CF authentication is restored.                                  |
| 6        | Why did the API bundle fail after tests and type-checks passed?                                                     | Anchored build paths to `build.mjs`, retried, then reran the same build outside the filesystem sandbox after repeated parent-directory read denials.                                                                                                                                                                                                                            | The build succeeded outside the sandbox. Esbuild's package resolution traverses parent directories that the managed sandbox blocks; the code itself was valid.                                                                                                        | Keep the more portable anchored paths and classify the remaining failure as a tool-sandbox constraint, not an application build defect.                       |
| 7        | Does the complete production MTA contain runnable copies of the local packages?                                     | Restored the GNU Make path, ran `mbt build --strict=true`, then inspected the API module's nested archive without extracting secrets or changing the artifact.                                                                                                                                                                                                                  | The strict build passed for API, web, and approuter. The API archive contains both `@flowpilot` packages, their manifests, and compiled `dist` files; all build-time npm audits reported zero vulnerabilities.                                                        | Keep the strict MTAR build and nested-package inspection as release evidence.                                                                                 |
| 8        | Can cloud database work resume after the expired-token failure?                                                     | Rechecked the target outside the restricted filesystem sandbox, confirmed the expected user/org/space, verified the service did not exist, and retried the approved `postgresql-db/trial` creation.                                                                                                                                                                             | The refreshed session was valid and the broker accepted the request. The `flowpilot-postgres` service is currently creating; the application remains undeployed.                                                                                                      | Wait for `create succeeded`, create a short-lived test service key, run the real isolation gate without printing credentials, then delete only that test key. |
| 9        | Will partial runtime startup failures release database resources?                                                   | Reviewed the production startup path after the successful build and added failure cleanup for both the application pool and LangGraph checkpointer. The first type-check exposed an optional-value capture inside the returned close callback.                                                                                                                                  | Startup cleanup now uses `Promise.allSettled`; retaining a narrowed local checkpointer reference corrected the TypeScript closure error, and the focused API type-check passed.                                                                                       | Include failure-path resource ownership in every startup review, and rerun the full build after this correction.                                              |
| 10       | Do malformed and oversized JSON requests remain safe client errors?                                                 | Reviewed the Express error path, found that body-parser failures would otherwise reach the generic `500`, added safe `400`/`413` mappings, and added malformed/oversized payload tests.                                                                                                                                                                                         | Both payload cases now return stable error codes without echoing the body or parser detail.                                                                                                                                                                           | Test framework and middleware errors in addition to schema-valid but invalid business input.                                                                  |
| 11       | Can the real database test use a temporary local service key?                                                       | Waited for `create succeeded`, created `flowpilot-checkpoint2-test`, retrieved only field names, and attempted the integration test without printing values. The first parser assumed direct credentials; the broker key actually wrapped them in `credentials`.                                                                                                                | The first attempt failed with `Invalid URL`. After nested parsing was added, both the SQL attempt and a separate TCP check timed out because the database endpoint is not reachable from the local machine. No schema was created, and the temporary key was deleted. | Support both direct and nested binding shapes; run the gate inside the Cloud Foundry network rather than weakening network controls.                          |
| 12       | Can an existing app provide a non-mutating tunnel?                                                                  | Checked SSH on the deployed API and AppRouter; both were disabled. The first `cf space-ssh-allowed` call omitted its required space argument, then the corrected `cf space-ssh-allowed dev` confirmed the space permits SSH.                                                                                                                                                    | Using an existing app would require enabling SSH and restarting it, crossing the no-FlowPilot-deployment boundary.                                                                                                                                                    | Leave both project apps untouched and create an isolated, no-route temporary runner bound only to PostgreSQL.                                                 |
| 13       | Will the first temporary runner execute the integration suite?                                                      | Pushed `flowpilot-checkpoint2-runner` with no route. Its keepalive opened no port, so the default health check stayed in `starting`; switched only the runner to process health. The first task then failed because CF's production environment made nested `npm ci` omit TypeScript/Vitest.                                                                                    | The runner became healthy after the process check. The next task used `--include=dev`, compiled both reusable packages, installed the API, and reached the database test.                                                                                             | Make task health semantics and development-tool installation explicit for disposable verification runners.                                                    |
| 14       | Why did the database reject the CF task as unencrypted?                                                             | Confirmed from SAP documentation that SSL is enforced. Added CA-backed TLS from `sslrootcert`/`sslcert`, shared one pool with LangGraph, and parsed the URL before applying SSL. Multiple tasks still attempted plaintext. A first safe `tsx` diagnostic failed because top-level await was emitted as CommonJS; the corrected diagnostic showed TLS was absent only inside CF. | The Node buildpack injects a plain `DATABASE_URL`; the resolver preferred it over the certificate-bearing `VCAP_SERVICES` binding. Reversing precedence activated CA validation.                                                                                      | Prefer a matching platform binding over buildpack convenience variables; retain `DATABASE_URL` as the local/fallback path and test precedence explicitly.     |
| 15       | Did the first encrypted end-to-end run fully preserve chat history?                                                 | Reran the cloud gate after the precedence correction. Migrations, RLS checks, cross-user denials, and checkpoint writes all executed, but the last reload assertion found a different assistant message ID.                                                                                                                                                                     | LangGraph's PostgreSQL rehydration did not preserve the fake assistant response ID consistently; generating a new random fallback made API IDs unstable across reads.                                                                                                 | Derive deterministic API message IDs from the private thread, position, role, and content; add stability/uniqueness regression checks.                        |
| 16       | Does the corrected backend pass the real gate without leaving test resources?                                       | Restaged only the disposable runner and ran `checkpoint2-postgres-6`. After success, collected redacted logs, deleted the runner, validated and removed its local temporary directory, and verified cloud cleanup.                                                                                                                                                              | The real test passed: schema setup, forced RLS, no-identity denial, two-subject isolation, LangGraph persistence, and stable reload. No service keys or runner remain; `flowpilot-postgres` is healthy, unbound, and retained for FlowPilot.                          | Accept the database gate, run final repository/MTA verification, and stop for Checkpoint 2 review.                                                            |
| 17       | Does the database suite still skip cleanly when no local database is configured?                                    | Ran the final root test suite after making pool creation TLS-aware. Vitest evaluated module-level pool creation before `describe.skipIf` could skip, so the suite failed while reading an absent config.                                                                                                                                                                        | Moving pool creation into the guarded `beforeAll` restored the intended no-database skip path without changing the already-passed cloud path.                                                                                                                         | Keep optional-integration resource creation inside test hooks, then rerun the entire verification sequence.                                                   |
| 18       | Does the final strict MTA command itself exit successfully?                                                         | Ran the strict final build after all tests. MBT generated a readable archive containing the API module, then Windows denied removal of the generated `flowpilot-api/data.zip`, so MBT exited nonzero during cleanup.                                                                                                                                                            | Verified the archive, validated and removed only `.BTPApp_mta_build_tmp` after the transient lock cleared, then reran the complete strict build. The retry built every module, generated the final archive, cleaned its temporary files, and exited `0`.              | Preserve both the cleanup failure and clean retry in the audit; accept only the successful retry as final build evidence.                                     |

- Root cause: The application had no chat runtime or persistence. The implementation-specific failures were independent: missing package-owned Node types; a restricted esbuild traversal; an expired CF token; a nested service-key shape; a CF-internal database endpoint; a temporary runner using the wrong health/dependency defaults; TLS certificates being bypassed by the buildpack's higher-precedence plain `DATABASE_URL`; and unstable randomly generated message IDs after checkpoint rehydration.
- Final change: Implemented reusable Groq-default model adapters, a provider-neutral LangGraph workflow with bounded model context, PostgreSQL migrations and forced row-level ownership, TLS-aware direct/nested binding discovery, one shared pool for repository/checkpoints, concurrency control, protected conversation APIs, safe request/provider error mappings, deterministic message IDs, MTA PostgreSQL configuration, and deterministic plus real database tests.
- Verification: Formatting, all package and application type-checks, 20 deterministic tests, the API production bundle, and the strict full MTAR build pass. The real bound BTP PostgreSQL test also passed schema setup, forced RLS, direct no-identity denial, two-subject list/read/write isolation, LangGraph checkpoint persistence, and stable reload. The archive contains compiled copies of both reusable packages; npm audits reported zero vulnerabilities. The temporary service key, CF runner, and local staging directory were removed; the healthy unbound PostgreSQL service remains.
- Incorrect or incomplete assumptions corrected: An installed Docker CLI does not prove Docker is usable. A package cannot rely on another package's development-only Node types. The esbuild failure was a sandbox traversal restriction, not unresolved application source. A service key and a VCAP binding can expose different nesting. A service key does not imply off-platform network reachability. A valid database URI alone is insufficient when SAP enforces TLS. On CF, buildpack-generated `DATABASE_URL` must not outrank a certificate-bearing service binding. Persisted message content does not guarantee that a framework preserves its optional message ID.
- Reusable lessons: Test every new package at its own boundary. Separate deterministic model/API tests from billable provider tests. Keep a real database gate for security features that an in-memory implementation cannot prove. Treat platform bindings as structured contracts and inspect field names without printing values. Prefer in-platform tasks for internal services. Verify encryption explicitly and define configuration precedence. Validate identifiers across persistence/reload boundaries, not just content. When a build tool reports access errors outside the workspace, rerun the exact command with authorized filesystem access before changing architecture.
- Remaining risks or follow-up: Checkpoint 2 needs human review. The FlowPilot application has not been redeployed with this backend, no Groq request has been made, and Credential Store retrieval and the SAP Horizon UI remain later checkpoints. The real two-user BTP test remains unavailable in the trial account and must be performed before production use; current evidence uses two independent validated-identity fixtures.

## How to maintain this document

- Review it at the beginning and end of each major phase.
- Add lessons that are broadly reusable; keep application-specific details in project documentation.
- Change a rule when evidence shows a better process, and record why.
- Keep phase gates stable enough to compare projects over time.
- Periodically copy the generic sections into a personal template repository.
