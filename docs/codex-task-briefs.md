# Codex task briefs

This is an optional prompt aid. Codex does not need to read it unless the user asks for a task brief or wants help framing a request.

Use only the sections that matter; short, concrete requests are cheaper and easier to execute.

## Feature

```text
Goal: [user-visible outcome]
Scope: [area/files if known]
Acceptance: [observable behavior or tests]
Constraints: [compatibility, API, UI, security, or performance limits]
Please implement this, inspect only the relevant files, and run focused checks.
```

## Troubleshooting

```text
Symptom: [exact error or incorrect behavior]
Expected: [what should happen]
Reproduction: [smallest command or steps]
Recent change: [if known]
Please diagnose from the evidence first, then propose or implement the smallest fix.
```

## Execution

```text
Action: [exact command or repository task]
Scope: [allowed directories/resources]
Stop conditions: [what must not happen]
Validation: [specific check or expected result]
Please execute only this scope and summarize the result.
```
