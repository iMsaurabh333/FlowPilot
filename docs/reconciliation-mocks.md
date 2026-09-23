# Reconciliation mock systems

The MTA deploys two independently runnable, read-only MCP systems for manual
reconciliation demos:

- **ABC Warehouse** (`flowpilot-mcp-abc-warehouse`)
- **XYZ TMS** (`flowpilot-mcp-xyz-tms`)
- **Mock Jira** (`flowpilot-mcp-jira-mock`)

Each advertises the compatible `get_application_message` tool. The records are
deterministic and intentionally small; no customer data is present. To test
business-value mapping, use the same value with each system's preferred input:

- **ABC Warehouse:** `{ "orderNumber": "861822" }`
- **XYZ TMS:** `{ "salesOrderNumber": "861822" }`

`applicationMessageId` remains accepted by both servers so existing
configurations continue to work. The returned record exposes the corresponding
`orderNumber` or `salesOrderNumber` field for extraction-path selection.

| Application Message ID | ABC Warehouse | XYZ TMS |
| --- | --- | --- |
| `MSG-000001` | Dispatched | In transit |
| `MSG-000002` | On hold | Awaiting handoff |
| `MSG-000003` | Delivered to carrier | Not found |
| `MSG-000004` | Not found | Delivered |
| `575990` | Packed | Awaiting pickup |
| `763968` | Dispatched | In transit |
| `861822` | On hold | Exception |
| `399085` | Delivered to carrier | Delivered |

The last four IDs mirror the supplied Cloud Integration Application Message IDs.
When Integration Monitoring is selected and has matching CPI logs, the report
shows its live CPI status alongside these deterministic mock-system statuses.

After deployment, use the MCP Registry as a `ChatAdmin` to add and Ping both
systems. Use the app routes reported by `cf apps` (without `/mcp`) and these
values:

| Registry field | ABC Warehouse | XYZ TMS |
| --- | --- | --- |
| Server ID | `abc-warehouse` | `xyz-tms` |
| Display name | `ABC Warehouse` | `XYZ TMS` |
| Authentication profile | `technical:flowpilot-mcp` | `technical:flowpilot-mcp` |
| Allowed tool names | `get_application_message` | `get_application_message` |
| Enabled | Yes, after a successful Ping | Yes, after a successful Ping |

For local development, start each server on a distinct port with
`MCP_AUTH_MODE=mock`, an identical 32-or-more-character `MCP_MOCK_TOKEN`, and
`MCP_MOCK_SYSTEM` set to the corresponding system. Configure the API with the
matching `MCP_REGISTRY_AUTH_TECHNICAL_FLOWPILOT_MCP` bearer token, then register
the loopback endpoints and Ping them.

## Mock Jira defects

Mock Jira is a read-only MCP server for use in Conversation. Register it with
server ID `mock-jira`, the `technical:flowpilot-mcp` profile, and the allowed
tool `get_jira_defect`. Look up a Jira defect using its defect ID; the response
includes the linked transaction ID. It provides deterministic defect records for:

- CPI transaction `611889`: purchasing organization missing for the purchase order.
- CPI transaction `173470`: duplicate business partner record detected.
- TMS/Warehouse transactions `575990` and `861822`, derived from the existing
  mock transport and warehouse statuses.

After enabling Mock Jira and the relevant ABC Warehouse, XYZ TMS, or CPI MCP
server in the registry, a user can ask a Conversation for a defect such as
`CPI-611889`. The agent returns its transaction ID, and the user can then ask
for that transaction's status or failure reason in the relevant system.
