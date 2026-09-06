# MCP Servers

Each MCP server uses the shared protocol and registry conventions but remains
independently buildable, deployable, configurable, and scalable. The registry is
designed for multiple servers from day one, including later Cloud Integration
content and Event Mesh servers.

`flowpilot-mcp-cloud-integration` is the first independently runnable server. It
provides the authenticated Streamable HTTP boundary plus the first reviewed,
bounded GET-only `search_message_processing_logs` tool derived from the pinned
SAP OData contract. The FlowPilot administrator registry now models multiple
approved servers through one generic secure policy preset, with admin-only
endpoint, Destination credential reference, explicit tool allowlist,
enable/disable state, and protocol-aware Ping health checks. The preset fixes
the Streamable HTTP path and invocation scope so later reviewed Cloud
Integration content and Event Mesh servers do not need product-specific
registry code. A reviewed minimal OpenAPI projection may be derived from the
pinned EDMX if the implementation toolchain requires it; the projection must
retain the vendor contract hash as provenance.
