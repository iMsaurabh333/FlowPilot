# Development Guide

## Session start

1. Read `DevFlow.md` and the current progress tracker.
2. Run `git status --short` and preserve unrelated changes.
3. Confirm the task objective, scope, acceptance criteria, and verification.
4. Inspect the relevant source and ADRs before editing.

## Required local commands

PowerShell may block `npm.ps1` on some Windows systems. Use `npm.cmd` directly if that occurs; npm scripts themselves remain portable.

```powershell
npm.cmd run install:all
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Cloud Foundry safety

Before any mutation, confirm the target:

```powershell
cf target
```

The expected development target at project creation is the trial org ending in `trial` and space `dev` on `us10-001`. Do not encode the org name, user email, API token, or service credentials in repository files.

## Branch and review loop

1. Create a short-lived `codex/`, `feature/`, or similarly clear branch.
2. Implement one coherent outcome.
3. Run focused tests and the repository verification commands.
4. Review the complete diff.
5. Update documentation and ADRs.
6. Commit and push only reviewed changes.

## Local authentication

Local mock authentication exists only to make UI and API development possible without copying BTP tokens. It must fail closed in production. Integration and deployment tests use real AppRouter/XSUAA authentication.
