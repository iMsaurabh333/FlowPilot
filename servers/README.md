# MCP Servers

Each MCP server uses the shared protocol and registry conventions but remains
independently buildable, deployable, configurable, and scalable. The registry is
designed for multiple servers from day one, including later Cloud Integration
content and Event Mesh servers.

`flowpilot-mcp-cloud-integration` is the first independently runnable server. It
provides the authenticated Streamable HTTP boundary plus the first reviewed,
bounded GET-only `search_message_processing_logs` tool derived from the pinned
SAP OData contract. The FlowPilot administrator registry now models multiple
approved servers, with admin-only endpoint/profile controls, enable/disable
state, and protocol-aware Ping health checks. Cloud Integration content and
Event Mesh profiles are reserved for later reviewed tools; they cannot expose
unapproved tools through the registry today. A reviewed minimal OpenAPI
projection may be derived from the pinned EDMX if the implementation toolchain
requires it; the projection must retain the vendor contract hash as provenance.
