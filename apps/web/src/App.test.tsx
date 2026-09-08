import { ThemeProvider } from "@ui5/webcomponents-react/ThemeProvider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError, type FlowPilotApi } from "./api";

const user = {
  subject: "user-123",
  tenantId: "tenant-456",
  displayName: "Test User",
  scopes: ["ChatUser"],
};

const adminUser = {
  subject: "admin-123",
  tenantId: "tenant-456",
  displayName: "FlowPilot Admin",
  scopes: ["ChatUser", "ChatAdmin"],
};

const summary = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Check sales order",
  createdAt: "2026-08-17T08:00:00.000Z",
  updatedAt: "2026-08-17T08:05:00.000Z",
};

const detail = {
  ...summary,
  messages: [
    { id: "message-1", role: "user" as const, content: "Check order 42" },
    {
      id: "message-2",
      role: "assistant" as const,
      content: "Start with the order status and latest integration log.",
    },
  ],
};

const toolDetail = {
  ...detail,
  messages: [
    ...detail.messages,
    {
      id: "message-3",
      role: "assistant" as const,
      content: "One failed message was found.",
      sources: [
        { label: "Cloud Integration monitoring · Message Processing Logs" },
      ],
      tables: [
        {
          title: "Message Processing Logs",
          columns: ["Message ID", "Status", "Integration flow", "Started"],
          rows: [["message-1", "FAILED", "Orders", "2026-09-08T10:00:00.000Z"]],
        },
      ],
    },
  ],
};

function api(overrides: Partial<FlowPilotApi> = {}): FlowPilotApi {
  return {
    loadCurrentUser: vi.fn().mockResolvedValue(user),
    listConversations: vi.fn().mockResolvedValue([summary]),
    createConversation: vi.fn().mockResolvedValue(summary),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    loadConversation: vi.fn().mockResolvedValue(detail),
    sendMessage: vi.fn().mockResolvedValue(detail),
    improvePrompt: vi.fn().mockResolvedValue("Improved prompt"),
    listAttachments: vi.fn().mockResolvedValue([]),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderApp(client: FlowPilotApi) {
  return render(
    <ThemeProvider>
      <App client={client} />
    </ThemeProvider>,
  );
}

function composer() {
  const element = document.querySelector("ui5-textarea");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected the UI5 message composer");
  }
  return element;
}

describe("FlowPilot chat interface", () => {
  it("loads the authenticated user's latest private conversation", async () => {
    renderApp(api());

    expect(
      await screen.findByRole("heading", { name: "Check sales order" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Check order 42")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Start with the order status and latest integration log.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Conversation history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chat/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
    expect(document.querySelector(".flowpilot-logo svg")).toBeInTheDocument();
  });

  it("creates the first conversation and enables the composer", async () => {
    const createConversation = vi.fn().mockResolvedValue(summary);
    const client = api({
      listConversations: vi.fn().mockResolvedValue([]),
      createConversation,
    });
    const { container } = renderApp(client);

    const start = await screen.findByText("Start a conversation");
    fireEvent.click(start);

    await waitFor(() => expect(createConversation).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Describe what you need to investigate"),
    ).toBeInTheDocument();
    expect(composer()).not.toHaveAttribute("disabled");
  });

  it("uploads private evidence without sending it to the model", async () => {
    const uploadAttachment = vi.fn().mockResolvedValue({
      id: "attachment-1",
      fileName: "failed-messages.txt",
      contentType: "text/plain",
      byteSize: 13,
      createdAt: "2026-09-08T10:00:00.000Z",
      expiresAt: "2026-10-08T10:00:00.000Z",
    });
    const sendMessage = vi.fn();
    renderApp(api({ uploadAttachment, sendMessage }));

    await screen.findByText("Check order 42");
    const input = screen.getByLabelText("Attach file");
    const file = new File(["MPL-42 failed"], "failed-messages.txt", {
      type: "text/plain",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(uploadAttachment).toHaveBeenCalledWith(summary.id, file),
    );
    expect(await screen.findByText("failed-messages.txt")).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByText(/not sent to the model automatically/i),
    ).toBeInTheDocument();
  });

  it("copies a starter prompt into a new conversation draft without sending", async () => {
    const createConversation = vi.fn().mockResolvedValue(summary);
    const sendMessage = vi.fn();
    renderApp(
      api({
        listConversations: vi.fn().mockResolvedValue([]),
        createConversation,
        sendMessage,
      }),
    );

    fireEvent.click(await screen.findByText("Start a conversation"));
    await screen.findByRole("group", { name: "Starter prompts" });
    fireEvent.click(screen.getByText("Investigate a failed message"));

    expect(composer()).toHaveProperty(
      "value",
      "Investigate a failed message. I can provide its correlation ID, integration flow ID, or application message ID.",
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends a trimmed message when Enter is pressed", async () => {
    const response = {
      ...detail,
      messages: [
        ...detail.messages,
        { id: "message-3", role: "user" as const, content: "Check delivery" },
        { id: "message-4", role: "assistant" as const, content: "Checking." },
      ],
    };
    const sendMessage = vi.fn().mockResolvedValue(response);
    renderApp(api({ sendMessage }));

    await screen.findByText("Check order 42");
    const messageRegion = screen.getByRole("region", { name: "Chat content" });
    Object.defineProperty(messageRegion, "scrollHeight", {
      configurable: true,
      value: 480,
    });
    messageRegion.scrollTop = 0;
    const input = composer();
    Object.assign(input, { value: "  Check delivery  " });
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(summary.id, "Check delivery"),
    );
    expect(await screen.findByText("Checking.")).toBeInTheDocument();
    expect(input).toHaveProperty("value", "");
    expect(messageRegion.scrollTop).toBe(480);
  });

  it("keeps Shift+Enter available for a newline without sending", async () => {
    const sendMessage = vi.fn();
    renderApp(api({ sendMessage }));

    await screen.findByText("Check order 42");
    const input = composer();
    Object.assign(input, { value: "First line" });
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the draft and presents a safe provider failure", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new ApiError(502, "model_unavailable"));
    renderApp(api({ sendMessage }));

    await screen.findByText("Check order 42");
    const input = composer();
    Object.assign(input, { value: "Retryable message" });
    fireEvent.input(input);
    fireEvent.submit(screen.getByRole("form", { name: "Send a message" }));

    expect(
      await screen.findByText(/assistant is temporarily unavailable/i),
    ).toBeInTheDocument();
    expect(input).toHaveProperty("value", "Retryable message");
  });

  it("shows the MCP source and an accessible MPL result table", async () => {
    renderApp(api({ loadConversation: vi.fn().mockResolvedValue(toolDetail) }));

    expect(
      await screen.findByText(/Source: Cloud Integration monitoring/),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Message Processing Logs",
    });
    expect(table).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Status" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "FAILED" })).toBeInTheDocument();
  });

  it("asks for confirmation before deleting the active conversation", async () => {
    const deleteConversation = vi.fn().mockResolvedValue(undefined);
    renderApp(api({ deleteConversation }));

    await screen.findByText("Check order 42");
    const deleteButton = document.querySelector(".conversation-delete");
    if (!(deleteButton instanceof HTMLElement)) {
      throw new Error("Expected the conversation delete button");
    }
    fireEvent.click(deleteButton);

    expect(
      screen.getByRole("alertdialog", { name: "Delete this conversation?" }),
    ).toBeInTheDocument();
    expect(deleteConversation).not.toHaveBeenCalled();

    const confirmButton = screen
      .getByRole("alertdialog")
      .querySelectorAll("ui5-button")[1];
    if (!(confirmButton instanceof HTMLElement)) {
      throw new Error("Expected the deletion confirmation button");
    }
    fireEvent.click(confirmButton);
    await waitFor(() =>
      expect(deleteConversation).toHaveBeenCalledWith(summary.id),
    );
    expect(
      screen.getByText("Start a focused troubleshooting session"),
    ).toBeInTheDocument();
  });

  it("exposes landmarks and has no serious automated accessibility violations", async () => {
    const { container } = renderApp(api());
    await screen.findByText("Check order 42");

    expect(screen.getByRole("main")).toHaveAccessibleName("Check sales order");
    expect(
      screen.getByRole("form", { name: "Send a message" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Conversation messages" }),
    ).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const seriousViolations = results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
    expect(seriousViolations).toEqual([]);
  });

  it("shows admin registry controls and invokes Ping and Save", async () => {
    const server = {
      serverId: "cloud-integration",
      policyPresetId: "generic" as const,
      displayName: "Cloud Integration monitoring",
      endpointUrl: "https://mcp.example.test",
      mcpPath: "/mcp",
      externalPort: null,
      authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_MPL",
      allowedToolNames: ["search_message_processing_logs"],
      requiredScopes: ["McpInvoke"],
      enabled: false,
      healthState: "healthy" as const,
      lastCheckedAt: "2026-09-05T12:00:00.000Z",
      latencyMs: 12,
      protocolVersion: "2026-07-28" as const,
      discoveredToolCount: 1,
      lastErrorCategory: null,
      createdAt: "2026-09-05T11:00:00.000Z",
      updatedAt: "2026-09-05T12:00:00.000Z",
    };
    const pingMcpServer = vi.fn().mockResolvedValue(server);
    const upsertMcpServer = vi.fn().mockResolvedValue(server);
    const client = api({
      loadCurrentUser: vi.fn().mockResolvedValue(adminUser),
      listMcpServers: vi.fn().mockResolvedValue([server]),
      pingMcpServer,
      upsertMcpServer,
    });

    const { container } = renderApp(client);

    fireEvent.click(await screen.findByRole("button", { name: /MCP servers/ }));
    expect(
      await screen.findByRole("heading", { name: "MCP servers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Generic secure MCP")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("Ping server")).toBeInTheDocument();
    expect(screen.getByText("Save registration")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Enable Cloud Integration monitoring",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Ping server"));
    await waitFor(() =>
      expect(pingMcpServer).toHaveBeenCalledWith(server.serverId),
    );

    fireEvent.click(screen.getByText("Save registration"));
    await waitFor(() =>
      expect(upsertMcpServer).toHaveBeenCalledWith(
        server.serverId,
        expect.objectContaining({
          policyPresetId: "generic",
          enabled: false,
        }),
      ),
    );

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("opens the reports workspace placeholder", async () => {
    renderApp(api());

    fireEvent.click(await screen.findByRole("button", { name: /Reports/ }));

    expect(
      await screen.findByRole("heading", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Planned jobs")).toBeInTheDocument();
    expect(screen.getByText("Evidence collection")).toBeInTheDocument();
    expect(screen.getByText("Generated reports")).toBeInTheDocument();
  });
});
