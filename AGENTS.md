# FlowPilot Codex instructions

This file is the concise, always-loaded guide for routine repository work. Keep it short.

## Context rules

- Start with `git status --short` and targeted `rg` searches; read only files relevant to the request.
- Do not read `DevFlow.md`, lockfiles, generated output, `node_modules`, `coverage`, `mta_archives`, or the whole repository unless the task explicitly requires them.
- Use this order when useful: target source, nearest tests, relevant config, then the smallest relevant doc.
- Preserve unrelated working-tree changes. Inspect focused diffs with `git diff -- <path>`.

## Task modes

- Feature: identify the owning area, inspect its source and tests, implement the smallest coherent change, then run focused checks.
- Troubleshooting: reproduce with the smallest relevant command, follow the exact error to its owning files, and avoid broad audits without evidence.
- Execution: carry out the explicit action and its stated scope; do not expand into an unrelated cleanup or architecture review.
- Ask for clarification only when a missing choice changes scope, behavior, data, or safety. Otherwise make a reasonable assumption and state it briefly.

## Project map

- `apps/api`: authenticated Express API, persistence, and runtime composition.
- `apps/web`: React and UI5 Web Components frontend.
- `packages/agent-core`: provider-neutral LangGraph workflow and context handling.
- `packages/model-adapters`: server-side provider configuration and adapters.
- `docs`: supporting product, architecture, and operations references.

## Invariants

- Keep provider/model selection and credentials server-side; identity and conversation ownership stay validated server-side.
- Never log prompts, responses, bearer tokens, provider keys, database URLs, or full identities.
- Keep model input/output bounded and telemetry content-free.
- Follow explicit user authorization before deployment, migrations, destructive actions, or external system changes.

## Verification

- Run the smallest relevant test or typecheck first.
- Run `npm run typecheck`, `npm test`, and `npm run build` together only for cross-cutting changes or when the user asks for a full verification.
- Report changed files, checks run, and any remaining limitation concisely.

## Historical process log

Read `DevFlow.md` only when the task requires updating or inspecting the AI-assisted development process, milestone history, or that document itself. Do not include it in routine feature, troubleshooting, or execution context.
