# Onboarding a FlowPilot MCP Server

This procedure is the approval gate for adding a new MCP server to FlowPilot.
It applies to a new server, a new connector deployed behind an existing server,
and any material change to a server's tool set or authentication boundary.

## 1. Define the boundary before implementation

Record the business purpose, data classification, system owner, and exact
read/write operations. Start with the smallest useful, read-only tool set. A
tool must have a bounded input schema, a bounded response, and a clear account
of which identities may invoke it. Do not rely on the model to make this
decision.

Decide whether the connector needs a separate deployment lifecycle. A separate
MCP server is required when it has a different credential, destination, data
classification, tool operator group, or release owner from an existing server.

## 2. Build a fail-closed server

Implement the server under `servers/` with the shared Streamable HTTP pattern:

- expose only `/mcp` and the OAuth protected-resource metadata endpoint;
- validate a technical client token and require the server's invocation scope;
- bind credentials and destinations only to the MCP server, never to the web
  module or browser;
- use an allowlist for upstream hosts, paths, methods, and tool names;
- set short upstream timeouts, response-size limits, and safe error categories;
- do not return tokens, authorization headers, destination exports, raw
  upstream failures, or customer data outside the approved result shape.

New tools must validate all arguments server-side. Their schemas must not allow
arbitrary URLs, raw query languages, file paths, or write operations by
default. Add focused tests for unauthenticated access, wrong scopes, malformed
arguments, timeout/error redaction, and each allowed operation.

## 3. Provision the least-privilege runtime boundary

Create or review a dedicated technical OAuth client and destination or
Credential Store reference. Secrets belong in BTP-managed services; commit
only reference names and non-secret configuration. The API's authentication
profile must identify that dedicated client, for example
`technical:flowpilot-mcp`, or an approved `destination:<name>` reference.

For a Cloud Foundry route, configure the canonical HTTPS `/mcp` URL. Never use
an internal, private, metadata, credential-bearing, redirected, or browser
supplied endpoint. The server must declare its public host and origin allowlists
when it binds publicly.

## 4. Register disabled, then prove capabilities

A `ChatAdmin` registers the server in **MCP registry** with:

1. A stable lowercase server ID and human-readable name.
2. The exact HTTPS endpoint and approved authentication profile.
3. An explicit tool allowlist containing only reviewed tool names.
4. `Enabled` left off for the initial save.

Use **Ping** to run the server-side authenticated capability probe. Check the
protocol version, latency, safe health status, and the discovered tool names.
Compare the discovered list with the approved allowlist. An administrator may
enable the record only after the probe succeeds; FlowPilot saves a failed enable
attempt as disabled. A healthy probe alone is not authorization to add newly
advertised tools.

## 5. Release and monitor

Before release, run the server test suite, API tests, and a production MTA
build. In the target space, verify the technical authentication path, a
`ToolOperator` chat path, a chat-only identity with no tools, disabled-server
behaviour, and the tool's safe failure mode. Record the deployed MTAR version,
route, approved tool names, credential owner, and verification date in the
release evidence.

Disable the registry record immediately if the server or an upstream dependency
is compromised, its allowlist changes unexpectedly, its health becomes stale,
or its scope boundary changes. Rotation, destination changes, and a tool
allowlist expansion require the same review and re-probe process.

## Review checklist

- [ ] Read-only or separately approved write boundary is documented.
- [ ] Dedicated technical identity, destination, and secret ownership are
      established.
- [ ] Input, response, timeout, and upstream-host bounds are tested.
- [ ] No secret or raw upstream error can reach the browser or model.
- [ ] The registry record is disabled until its exact allowlist passes Ping.
- [ ] Chat-only users receive no tool and `ToolOperator` users receive only the
      namespaced allowlisted tools.
- [ ] Deployment and post-deployment verification evidence is recorded.
