import { describe, expect, it, vi } from "vitest";

import { McpReportExecutor } from "../src/reports/mcp-report-executor.js";
import type { ReportJobRecord } from "../src/reports/types.js";

const job: ReportJobRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Message health",
  reportPrompt: "Summarize failed messages.",
  sourceToolNames: [],
  actionPlanId: null,
  scheduledFor: new Date(),
  recurrenceRule: null,
  status: "running",
  lastRunStatus: null,
  attemptCount: 1,
  finalReportHtml: null,
  errorLog: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("McpReportExecutor", () => {
  it("allows only read-only MCP tools and renders escaped final HTML", async () => {
    const sendMessage = vi.fn().mockResolvedValue([
      {
        id: "final",
        role: "assistant",
        content: "Found <two> failed messages.",
        sources: [{ label: "MPL" }],
      },
    ]);
    const executor = new McpReportExecutor({
      agent: {
        sendMessage,
        getMessages: vi.fn(),
        trimOldestTurn: vi.fn(),
        improvePrompt: vi.fn(),
      },
      resolveTools: vi.fn().mockResolvedValue([
        {
          name: "cloud__search_message_processing_logs",
          description: "read",
          inputSchema: {},
          invoke: vi.fn(),
        },
        {
          name: "cloud__deploy_integration_flow",
          description: "write",
          inputSchema: {},
          invoke: vi.fn(),
        },
      ]),
      user: () => ({
        tenantId: "tenant",
        subject: "user",
        scopes: ["ChatUser", "ToolOperator"],
      }),
    });

    const result = await executor.execute(job);

    expect(
      sendMessage.mock.calls[0]?.[2].map((tool: { name: string }) => tool.name),
    ).toEqual(["cloud__search_message_processing_logs"]);
    expect(result.html).toContain("Found &lt;two&gt; failed messages.");
    expect(result.html).not.toContain("<two>");
  });

  it("renders an HTML model response as report markup rather than escaped text", async () => {
    const executor = new McpReportExecutor({
      agent: {
        sendMessage: vi.fn().mockResolvedValue([
          {
            id: "final",
            role: "assistant",
            content:
              "<!DOCTYPE html><html><body><h1>Message overview</h1><p>One message found.</p><script>alert('unsafe')</script><table onclick=\"alert('unsafe')\"><tr><th>ID</th></tr><tr><td>42</td></tr></table></body></html>",
          },
        ]),
        getMessages: vi.fn(),
        trimOldestTurn: vi.fn(),
        improvePrompt: vi.fn(),
      },
      resolveTools: vi.fn().mockResolvedValue([{
        name: "cloud__search_message_processing_logs", description: "read", inputSchema: {}, invoke: vi.fn(),
      }]),
    });

    const result = await executor.execute(job, {
      tenantId: "tenant",
      subject: "user",
      scopes: ["ChatUser"],
    });

    expect(result.html).toContain("<h1>Message overview</h1>");
    expect(result.html).toContain(
      "<table><tr><th>ID</th></tr><tr><td>42</td></tr></table>",
    );
    expect(result.html).not.toContain("&lt;!DOCTYPE html&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("alert('unsafe')");
  });

  it("converts a Markdown model response to report HTML", async () => {
    const executor = new McpReportExecutor({
      agent: {
        sendMessage: vi
          .fn()
          .mockResolvedValue([
            {
              id: "final",
              role: "assistant",
              content:
                "# Message overview\n\n| Message ID | Status |\n| --- | --- |\n| 42 | Completed |\n\n- **No** unresolved exceptions",
            },
          ]),
        getMessages: vi.fn(),
        trimOldestTurn: vi.fn(),
        improvePrompt: vi.fn(),
      },
      resolveTools: vi.fn().mockResolvedValue([{
        name: "cloud__search_message_processing_logs", description: "read", inputSchema: {}, invoke: vi.fn(),
      }]),
    });

    const result = await executor.execute(job, {
      tenantId: "tenant",
      subject: "user",
      scopes: ["ChatUser"],
    });

    expect(result.html).toContain("<h1>Message overview</h1>");
    expect(result.html).toContain(
      "<table><thead><tr><th>Message ID</th><th>Status</th></tr></thead><tbody><tr><td>42</td><td>Completed</td></tr></tbody></table>",
    );
    expect(result.html).toContain(
      "<li><strong>No</strong> unresolved exceptions</li>",
    );
    expect(result.html).not.toContain("| Message ID |");
  });

  it("limits the report agent to the stored source selection", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue([
        { id: "final", role: "assistant", content: "Completed." },
      ]);
    const executor = new McpReportExecutor({
      agent: {
        sendMessage,
        getMessages: vi.fn(),
        trimOldestTurn: vi.fn(),
        improvePrompt: vi.fn(),
      },
      resolveTools: vi.fn().mockResolvedValue([
        {
          name: "cloud__list_a",
          description: "A",
          inputSchema: {},
          invoke: vi.fn(),
        },
        {
          name: "cloud__list_b",
          description: "B",
          inputSchema: {},
          invoke: vi.fn(),
        },
      ]),
    });
    await executor.execute(
      { ...job, sourceToolNames: ["cloud__list_b"] },
      {
        tenantId: "tenant",
        subject: "user",
        scopes: ["ChatUser", "ToolOperator"],
      },
    );
    expect(
      sendMessage.mock.calls[0]?.[2].map((tool: { name: string }) => tool.name),
    ).toEqual(["cloud__list_b"]);
  });

  it("bounds tool evidence passed to the model while rendering the complete structured source table", async () => {
    const observed: string[] = [];
    const largeResult = JSON.stringify({ items: Array.from({ length: 30 }, (_, index) => ({ messageId: `message-${index}`, status: "FAILED", error: "x".repeat(500) })) });
    const executor = new McpReportExecutor({
      agent: {
        sendMessage: vi.fn(async (_thread, _instruction, tools) => {
          observed.push(await tools![0].invoke({ fromUtc: "2026-09-14T00:00:00Z" }));
          return [{ id: "final", role: "assistant", content: "<h1>Summary</h1>" }];
        }), getMessages: vi.fn(), trimOldestTurn: vi.fn(), improvePrompt: vi.fn(),
      },
      resolveTools: vi.fn().mockResolvedValue([{ name: "cloud__search_message_processing_logs", description: "read", inputSchema: {}, invoke: vi.fn().mockResolvedValue(largeResult) }]),
    });

    const result = await executor.execute(job, { tenantId: "tenant", subject: "user", scopes: ["ChatUser", "ToolOperator"] });

    expect(observed[0]).toContain('"count":30');
    expect(observed[0].length).toBeLessThan(6_000);
    expect(result.html).toContain("message-29");
  });
});
