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

## UI contract

## UI contract

- Keep FlowPilot in the SAP Horizon / UI5 visual language: calm enterprise surfaces, clear hierarchy, accessible controls, and responsive layouts.
- Add end-user guidance to the right side of the shell bar, beside the profile action. The guide must explain how to work with the application in plain operational language, not implementation details.
- Treat every primary-navigation view as a fixed-height workspace. Its page title and any view-level tabs, filters, or time-window controls remain fixed; only the view's content body scrolls. Do not use sticky headers within the same scrolling surface when a fixed header/body layout is possible.
- When adding a new primary view or tab, follow the same fixed-header plus independently scrollable-body pattern used by Health, Reports, and Settings.
- Keep Health diagnostics and Processing time as separate tab contents. The "Highest average processing time" insight belongs only to Processing time, never at the bottom of Diagnostics.
- Prefer user-focused labels and outcomes. Explain limitations, unavailable data, and next steps without exposing internal implementation or credentials.

## Verification

- For web UI changes, run the focused UI tests and `npm.cmd run build` from `apps/web` before handoff.

## Historical process log

Read `DevFlow.md` only when the task requires updating or inspecting the AI-assisted development process, milestone history, or that document itself. Do not include it in routine feature, troubleshooting, or execution context.
