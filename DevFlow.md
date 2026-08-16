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

| Phase                | Status                  | Evidence or next gate                                                                                                                                                                                                                  |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Frame             | Complete                | Product scope, users, constraints, MVP boundary, and success criteria are in `docs/product.md`.                                                                                                                                        |
| 1. Discover          | In progress             | BTP Cloud Foundry target and core trial services verified; target API authentication, model access, and the first OpenAPI YAML remain.                                                                                                 |
| 2. Decide            | Complete for foundation | Architecture and initial XSUAA decisions are recorded in ADRs 0001 and 0002.                                                                                                                                                           |
| 3. Foundation        | Complete for foundation | GitHub remote, modules, locked dependencies, MTA build, CI workflow, initial commit, and push are established.                                                                                                                         |
| 4. Vertical slice    | In progress             | Authentication and Checkpoint 1 design are approved. Checkpoint 2 backend, LangGraph, model adapters, protected APIs, and BTP PostgreSQL isolation are complete and awaiting human review; UI and deployment remain later checkpoints. |
| 5. Iterate           | Not started             | Begin after the first deployed vertical slice.                                                                                                                                                                                         |
| 6. Harden            | Not started             | Threat model and production checks pending.                                                                                                                                                                                            |
| 7. Release           | Not started             | Release process pending.                                                                                                                                                                                                               |
| 8. Operate and learn | Not started             | Metrics and milestone retrospectives pending.                                                                                                                                                                                          |

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
