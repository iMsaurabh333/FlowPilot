# FlowPilot project instructions

## UI contract

- Keep FlowPilot in the SAP Horizon / UI5 visual language: calm enterprise surfaces, clear hierarchy, accessible controls, and responsive layouts.
- Add end-user guidance to the right side of the shell bar, beside the profile action. The guide must explain how to work with the application in plain operational language, not implementation details.
- Treat every primary-navigation view as a fixed-height workspace. Its page title and any view-level tabs, filters, or time-window controls remain fixed; only the view's content body scrolls. Do not use sticky headers within the same scrolling surface when a fixed header/body layout is possible.
- When adding a new primary view or tab, follow the same fixed-header plus independently scrollable-body pattern used by Health, Reports, and Settings.
- Keep Health diagnostics and Processing time as separate tab contents. The "Highest average processing time" insight belongs only to Processing time, never at the bottom of Diagnostics.
- Prefer user-focused labels and outcomes. Explain limitations, unavailable data, and next steps without exposing internal implementation or credentials.

## Verification

- For web UI changes, run the focused UI tests and `npm.cmd run build` from `apps/web` before handoff.
