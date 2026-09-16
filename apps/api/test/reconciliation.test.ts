import { describe, expect, it, vi } from "vitest";

import { reconciliationLookupTools } from "../src/reports/mcp-report-executor.js";
import { runReconciliation } from "../src/reports/reconciliation.js";

const user = { tenantId: "tenant", subject: "operator", scopes: ["ToolOperator"] };

describe("manual reconciliation", () => {
  it("keeps compatible lookup systems in separate result columns", async () => {
    const tools = [
      { name: "abc-warehouse__get_application_message", description: "ABC", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ status: "Dispatched", warehouseOrderId: "ABC-1" }] })) },
      { name: "xyz-tms__get_application_message", description: "XYZ", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ status: "In transit", shipmentId: "XYZ-1" }] })) },
    ];

    const result = await runReconciliation({ user, ids: ["MSG-000001"], sourceToolNames: tools.map((tool) => tool.name), fields: ["warehouseOrderId", "shipmentId"], resolveTools: vi.fn().mockResolvedValue(tools) });

    expect(result.rows[0]?.systems).toEqual({
      "abc-warehouse": { status: "Dispatched", fields: { warehouseOrderId: "ABC-1" } },
      "xyz-tms": { status: "In transit", fields: { shipmentId: "XYZ-1" } },
    });
  });

  it("exposes only read-only tools with an application message ID input", () => {
    const tools = [
      { name: "abc-warehouse__get_application_message", description: "compatible", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
      { name: "cloud__search_message_processing_logs", description: "compatible monitoring search", inputSchema: { properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
      { name: "xyz-tms__update_application_message", description: "write", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
    ];

    expect(reconciliationLookupTools(tools).map((tool) => tool.name)).toEqual(["abc-warehouse__get_application_message", "cloud__search_message_processing_logs"]);
  });
});
