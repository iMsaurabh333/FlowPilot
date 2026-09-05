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

function api(overrides: Partial<FlowPilotApi> = {}): FlowPilotApi {
  return {
    loadCurrentUser: vi.fn().mockResolvedValue(user),
    listConversations: vi.fn().mockResolvedValue([summary]),
    createConversation: vi.fn().mockResolvedValue(summary),
    loadConversation: vi.fn().mockResolvedValue(detail),
    sendMessage: vi.fn().mockResolvedValue(detail),
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

    expect(await screen.findByText("Check sales order")).toBeInTheDocument();
    expect(screen.getByText("Check order 42")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Start with the order status and latest integration log.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Conversation history" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
  });

  it("creates the first conversation and enables the composer", async () => {
    const createConversation = vi.fn().mockResolvedValue(summary);
    const client = api({
      listConversations: vi.fn().mockResolvedValue([]),
      createConversation,
    });
    renderApp(client);

    const start = await screen.findByText("Start a conversation");
    fireEvent.click(start);

    await waitFor(() => expect(createConversation).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Describe what you need to investigate"),
    ).toBeInTheDocument();
    expect(composer()).not.toHaveAttribute("disabled");
  });

  it("sends a trimmed message with the documented keyboard shortcut", async () => {
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
    const input = composer();
    Object.assign(input, { value: "  Check delivery  " });
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(summary.id, "Check delivery"),
    );
    expect(await screen.findByText("Checking.")).toBeInTheDocument();
    expect(input).toHaveProperty("value", "");
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
      profileId: "cloud-integration-monitoring" as const,
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

    renderApp(client);

    expect(
      await screen.findByRole("heading", { name: "MCP server registry" }),
    ).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("Ping")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(
      document.querySelector(
        'ui5-switch[accessible-name="Enable Cloud Integration monitoring"]',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Ping"));
    await waitFor(() =>
      expect(pingMcpServer).toHaveBeenCalledWith(server.serverId),
    );

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(upsertMcpServer).toHaveBeenCalledWith(
        server.serverId,
        expect.objectContaining({ enabled: false }),
      ),
    );
  });
});
