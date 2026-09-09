import { describe, expect, it, vi } from "vitest";

import { McpReportExecutor } from "../src/reports/mcp-report-executor.js";
import type { ReportJobRecord } from "../src/reports/types.js";

const job: ReportJobRecord = {
  id: "11111111-1111-4111-8111-111111111111", title: "Message health", reportPrompt: "Summarize failed messages.", sourceToolNames: [], actionPlanId: null, scheduledFor: new Date(), recurrenceRule: null, status: "running", lastRunStatus: null, attemptCount: 1, finalReportHtml: null, errorLog: null, startedAt: new Date(), completedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe("McpReportExecutor", () => {
  it("allows only read-only MCP tools and renders escaped final HTML", async () => {
    const sendMessage = vi.fn().mockResolvedValue([{ id: "final", role: "assistant", content: "Found <two> failed messages.", sources: [{ label: "MPL" }] }]);
    const executor = new McpReportExecutor({
      agent: { sendMessage, getMessages: vi.fn(), trimOldestTurn: vi.fn(), improvePrompt: vi.fn() },
      resolveTools: vi.fn().mockResolvedValue([
        { name: "cloud__search_message_processing_logs", description: "read", inputSchema: {}, invoke: vi.fn() },
        { name: "cloud__deploy_integration_flow", description: "write", inputSchema: {}, invoke: vi.fn() },
      ]),
      user: () => ({ tenantId: "tenant", subject: "user", scopes: ["ChatUser", "ToolOperator"] }),
    });

    const result = await executor.execute(job);

    expect(sendMessage.mock.calls[0]?.[2].map((tool: { name: string }) => tool.name)).toEqual(["cloud__search_message_processing_logs"]);
    expect(result.html).toContain("Found &lt;two&gt; failed messages.");
    expect(result.html).not.toContain("<two>");
  });

  it("limits the report agent to the stored source selection", async () => {
    const sendMessage = vi.fn().mockResolvedValue([{ id: "final", role: "assistant", content: "Completed." }]);
    const executor = new McpReportExecutor({
      agent: { sendMessage, getMessages: vi.fn(), trimOldestTurn: vi.fn(), improvePrompt: vi.fn() },
      resolveTools: vi.fn().mockResolvedValue([
        { name: "cloud__list_a", description: "A", inputSchema: {}, invoke: vi.fn() },
        { name: "cloud__list_b", description: "B", inputSchema: {}, invoke: vi.fn() },
      ]),
    });
    await executor.execute({ ...job, sourceToolNames: ["cloud__list_b"] }, { tenantId: "tenant", subject: "user", scopes: ["ChatUser", "ToolOperator"] });
    expect(sendMessage.mock.calls[0]?.[2].map((tool: { name: string }) => tool.name)).toEqual(["cloud__list_b"]);
  });
});
