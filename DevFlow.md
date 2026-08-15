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

| Phase                | Status                  | Evidence or next gate                                                                                                                  |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Frame             | Complete                | Product scope, users, constraints, MVP boundary, and success criteria are in `docs/product.md`.                                        |
| 1. Discover          | In progress             | BTP Cloud Foundry target and core trial services verified; target API authentication, model access, and the first OpenAPI YAML remain. |
| 2. Decide            | Complete for foundation | Architecture and initial XSUAA decisions are recorded in ADRs 0001 and 0002.                                                           |
| 3. Foundation        | In progress             | GitHub remote, modules, locked dependencies, MTA build, and CI workflow established; initial commit and push pending.                  |
| 4. Vertical slice    | In progress             | MTA 0.1.0 deployed; health, API rejection, and login redirect verified. Role assignment and authenticated browser smoke test remain.   |
| 5. Iterate           | Not started             | Begin after the first deployed vertical slice.                                                                                         |
| 6. Harden            | Not started             | Threat model and production checks pending.                                                                                            |
| 7. Release           | Not started             | Release process pending.                                                                                                               |
| 8. Operate and learn | Not started             | Metrics and milestone retrospectives pending.                                                                                          |

## How to maintain this document

- Review it at the beginning and end of each major phase.
- Add lessons that are broadly reusable; keep application-specific details in project documentation.
- Change a rule when evidence shows a better process, and record why.
- Keep phase gates stable enough to compare projects over time.
- Periodically copy the generic sections into a personal template repository.
