# ADR 0003: SAP Horizon UI with UI5 Web Components

- Status: Accepted
- Date: 2026-08-16

## Context

The authentication foundation uses a custom dark page with decorative gradients. FlowPilot is a standalone SAP BTP application and should look and behave like a standard SAP application instead of introducing a separate visual language.

## Decision

Use UI5 Web Components for React for the FlowPilot shell and chat interface. Use the built-in `sap_horizon` theme (Morning Horizon) as the initial theme.

Use UI5 components for application chrome, navigation, forms, buttons, message states, busy states, and accessibility behavior. Limit custom CSS to layout needs that the component library does not cover, and use SAP theme variables for those styles. Remove the current gradients and hard-coded decorative colors.

The first chat UI will use a standard shell structure:

- a shell bar containing the product identity and authenticated-user affordance;
- a conversation navigation area;
- a main message area;
- a message composer using standard form controls;
- standard busy, empty, warning, and error states.

Theme switching is not part of the first implementation, but the design must not prevent later support for Evening Horizon and high-contrast Horizon themes.

## Consequences

- The application gains a recognizable SAP Horizon appearance and UI5 accessibility behavior.
- `@ui5/webcomponents-react` and its required UI5 packages become frontend dependencies.
- Tests must account for web components and asynchronous component rendering.
- Custom CSS cannot introduce an independent color system or gradients.
- Any future custom component must use SAP theme variables and be reviewed in both normal and high-contrast themes.

## References

- [UI5 Web Components for React](https://github.com/UI5/webcomponents-react)
- [UI5 Web Components configuration and supported SAP themes](https://ui5.github.io/webcomponents/docs/advanced/configuration/)
- [UI5 Web Components styling and SAP theme variables](https://ui5.github.io/webcomponents/docs/development/styling/)
