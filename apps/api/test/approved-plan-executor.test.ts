import { describe, expect, it, vi } from "vitest";

import { ActionPlanValidationError, ApprovedPlanExecutor } from "../src/reports/approved-plan-executor.js";
import type { ActionPlan } from "../src/reports/action-plan-store.js";

const user = { tenantId: "tenant-a", subject: "user-a", scopes: ["ChatUser", "ToolOperator"] };
const plan: ActionPlan = {
  id: "11111111-1111-4111-8111-111111111111", source: "Deploy iflow1", plan: "Deploy iflow1", steps: [{ tool: "deploy_integration_flow", arguments: { integrationFlowId: "iflow1" } }], revision: 1, status: "approved", approvedAt: "2026-09-09T00:00:00.000Z", executionStatus: null, finalReportHtml: null, errorLog: null, executedAt: null, updatedAt: "2026-09-09T00:00:00.000Z",
};

function tool(invoke = vi.fn()) {
  return { name: "cloud-integration-content__deploy_integration_flow", description: "Deploy", inputSchema: { type: "object", required: ["integrationFlowId"], properties: { integrationFlowId: { type: "string", minLength: 1 } }, additionalProperties: false }, invoke };
}

describe("ApprovedPlanExecutor", () => {
  it("rejects an approved step that no longer matches the live MCP schema", async () => {
    const executor = new ApprovedPlanExecutor(vi.fn().mockResolvedValue([tool()]));
    await expect(executor.validate(user, [{ tool: "deploy_integration_flow", arguments: {} }])).rejects.toBeInstanceOf(ActionPlanValidationError);
  });

  it("retries each individual MCP operation and records only its final result", async () => {
    const invoke = vi.fn().mockResolvedValueOnce('{"error":"temporary"}').mockResolvedValueOnce("deployed");
    const executor = new ApprovedPlanExecutor(vi.fn().mockResolvedValue([tool(invoke)]));
    const result = await executor.execute(user, plan);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "succeeded", errorLog: null });
    expect(result.html).toContain("Completed");
    expect(result.html).not.toContain("attempt");
  });

  it("keeps only final failures in the separate roadblock log", async () => {
    const executor = new ApprovedPlanExecutor(vi.fn().mockResolvedValue([tool(vi.fn().mockResolvedValue('{"error":"unavailable"}'))]));
    const result = await executor.execute(user, plan);
    expect(result.status).toBe("attention");
    expect(result.errorLog).toContain("deploy_integration_flow");
  });
});
