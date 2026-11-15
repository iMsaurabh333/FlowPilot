import { describe, expect, it, vi } from "vitest";

import { reconciliationLookupTools } from "../src/reports/mcp-report-executor.js";
import { runReconciliation } from "../src/reports/reconciliation.js";

const user = { tenantId: "tenant", subject: "operator", scopes: ["ToolOperator"] };
const identifier = (id: string, systemId: string, toolName: string, path: string) => ({
  id,
  systemId,
  compositeKey: `${systemId}:Message:${path.split(".").at(-1)}`,
  status: "Active" as const,
  version: 1,
  retrieval: {
    serverId: systemId,
    toolName,
    parameters: { applicationMessageId: "{identifier}" },
    headers: {},
    requestBody: "",
    requestFormat: "none" as const,
    responseExtractionPath: path,
    expectedField: path,
    expectedValue: "",
  },
});

describe("manual reconciliation", () => {
  it("keeps compatible lookup systems in separate result columns", async () => {
    const tools = [
      { name: "abc-warehouse__get_application_message", description: "ABC", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ status: "Dispatched", warehouseOrderId: "ABC-1" }] })) },
      { name: "xyz-tms__get_application_message", description: "XYZ", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ status: "In transit", shipmentId: "XYZ-1" }] })) },
    ];

    const identifierTypes = [
      identifier("00000000-0000-4000-8000-000000000001", "abc-warehouse", "get_application_message", "$.items[0].warehouseOrderId"),
      identifier("00000000-0000-4000-8000-000000000002", "abc-warehouse", "get_application_message", "$.items[0].status"),
      identifier("00000000-0000-4000-8000-000000000003", "xyz-tms", "get_application_message", "$.items[0].shipmentId"),
      identifier("00000000-0000-4000-8000-000000000004", "xyz-tms", "get_application_message", "$.items[0].status"),
    ];
    const result = await runReconciliation({
      user,
      ids: ["MSG-000001"],
      sourceToolNames: ["abc-warehouse", "xyz-tms"],
      identifierSelections: [
        { lookupIdentifierTypeId: identifierTypes[0]!.id, responseIdentifierTypeId: identifierTypes[1]!.id },
        { lookupIdentifierTypeId: identifierTypes[2]!.id, responseIdentifierTypeId: identifierTypes[3]!.id },
      ],
      identifierTypes,
      fields: ["warehouseOrderId", "shipmentId"],
      resolveTools: vi.fn().mockResolvedValue(tools),
    });

    expect(result.rows[0]?.systems).toEqual({
      "abc-warehouse": { status: "Dispatched", lookupField: "applicationMessageId", responseField: "$.items[0].status", responseValue: "Dispatched", fields: { warehouseOrderId: "ABC-1" } },
      "xyz-tms": { status: "In transit", lookupField: "applicationMessageId", responseField: "$.items[0].status", responseValue: "In transit", fields: { shipmentId: "XYZ-1" } },
    });
  });

  it("exposes every safe callable tool for configured identifier types", () => {
    const tools = [
      { name: "abc-warehouse__get_application_message", description: "compatible", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
      { name: "cloud__search_message_processing_logs", description: "compatible monitoring search", inputSchema: { properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
      { name: "tms__fetch_shipment", description: "compatible custom lookup", inputSchema: { properties: {} }, invoke: vi.fn() },
      { name: "xyz-tms__update_application_message", description: "write", inputSchema: { required: ["applicationMessageId"], properties: { applicationMessageId: { type: "string" } } }, invoke: vi.fn() },
    ];

    expect(reconciliationLookupTools(tools).map((tool) => tool.name)).toEqual(["abc-warehouse__get_application_message", "cloud__search_message_processing_logs", "tms__fetch_shipment"]);
  });
});
