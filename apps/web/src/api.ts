export interface CurrentUser {
  subject: string;
  tenantId: string;
  displayName?: string;
  scopes: string[];
}

export type McpHealthState =
  "never_checked" | "healthy" | "unhealthy" | "stale";

export interface McpServerRecord {
  serverId: string;
  policyPresetId: "generic";
  displayName: string;
  endpointUrl: string;
  mcpPath: string;
  externalPort: number | null;
  authProfileRef: string;
  allowedToolNames: string[];
  requiredScopes: string[];
  enabled: boolean;
  healthState: McpHealthState;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  protocolVersion: "2026-07-28" | "2025-11-25" | null;
  discoveredToolCount: number | null;
  lastErrorCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerInput {
  policyPresetId?: McpServerRecord["policyPresetId"];
  displayName?: string;
  endpointUrl?: string;
  externalPort?: number | null;
  authProfileRef?: string;
  allowedToolNames?: string[];
  enabled?: boolean;
}

export interface ConversationPolicy {
  maxConversationsPerUser: number;
  maxRetainedTurns: number;
}

export type ReportJobStatus = "scheduled" | "running" | "succeeded" | "attention" | "failed";

export interface ReportJobSummary {
  id: string;
  title: string;
  sourceToolNames: string[];
  scheduleActive: boolean;
  actionPlanId: string | null;
  scheduledFor: string;
  recurrenceRule: string | null;
  status: ReportJobStatus;
  lastRunStatus: Extract<ReportJobStatus, "succeeded" | "attention" | "failed"> | null;
  finalReportHtml: string | null;
  errorLog: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateReportJobInput {
  title: string;
  reportPrompt: string;
  sourceToolNames?: string[];
  scheduledFor: string;
  recurrenceRule?: string | null;
  actionPlanId?: string | null;
}

export interface ReportActionPlanPreview {
  id: string;
  source: string;
  plan: string;
  revision: number;
  status: "draft" | "approved";
  steps: Array<{ tool: string; arguments: Record<string, unknown> }>;
}

export interface ApprovedPlanExecutionResult {
  html: string;
  status: "succeeded" | "attention";
}

export type ReportExportFormat = "html" | "markdown" | "xlsx";
export interface ReportSource { name: string; description: string; }
export interface ReportJobRun { id: string; reportJobId: string; status: "succeeded" | "attention" | "failed"; attemptCount: number; finalReportHtml: string | null; errorLog: string | null; startedAt: string | null; completedAt: string; }

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ label: string }>;
  tables?: Array<{
    title: string;
    columns: string[];
    rows: Array<Array<string | null>>;
  }>;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
  rolledOver?: boolean;
}

export interface FlowPilotApi {
  loadCurrentUser(): Promise<CurrentUser>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  deleteConversation(conversationId: string): Promise<void>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  sendMessage(
    conversationId: string,
    content: string,
  ): Promise<ConversationDetail>;
  improvePrompt(content: string): Promise<string>;
  listMcpServers?(): Promise<McpServerRecord[]>;
  upsertMcpServer?(
    serverId: string,
    input: McpServerInput,
  ): Promise<McpServerRecord>;
  pingMcpServer?(serverId: string): Promise<McpServerRecord>;
  listMcpServerTools?(serverId: string): Promise<string[]>;
  getConversationPolicy?(): Promise<ConversationPolicy>;
  updateConversationPolicy?(input: ConversationPolicy): Promise<ConversationPolicy>;
  listReportJobs?(): Promise<ReportJobSummary[]>;
  createReportJob?(input: CreateReportJobInput): Promise<ReportJobSummary>;
  runReportJob?(jobId: string): Promise<ReportJobSummary>;
  previewReportActionPlan?(fileName: string, contentBase64: string): Promise<ReportActionPlanPreview>;
  updateReportActionPlan?(planId: string, plan: string): Promise<ReportActionPlanPreview>;
  approveReportActionPlan?(planId: string, revision: number): Promise<ReportActionPlanPreview>;
  executeApprovedActionPlan?(planId: string): Promise<ApprovedPlanExecutionResult>;
  regenerateReportActionPlan?(planId: string): Promise<ReportActionPlanPreview>;
  downloadReportJob?(jobId: string, format: ReportExportFormat): Promise<void>;
  listReportSources?(): Promise<ReportSource[]>;
  listReportJobRuns?(jobId: string): Promise<ReportJobRun[]>;
  deleteReportJob?(jobId: string): Promise<void>;
  setReportScheduleActive?(jobId: string, active: boolean): Promise<ReportJobSummary>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code = "request_failed") {
    super(`FlowPilot request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function errorCode(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return "request_failed";
}

async function responsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function createApiClient(fetcher: typeof fetch = fetch): FlowPilotApi {
  let csrfToken: string | undefined;

  const captureCsrfToken = (response: Response) => {
    const token = response.headers.get("x-csrf-token");
    if (token && token.toLowerCase() !== "required") {
      csrfToken = token;
    }
  };

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    allowCsrfRetry = true,
  ): Promise<T> => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    if (unsafeMethods.has(method) && !csrfToken) {
      const tokenResponse = await fetcher("/api/me", {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": "Fetch",
        },
      });
      captureCsrfToken(tokenResponse);
      if (!tokenResponse.ok) {
        throw new ApiError(
          tokenResponse.status,
          errorCode(await responsePayload(tokenResponse)),
        );
      }
    }

    if (unsafeMethods.has(method) && csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }

    const response = await fetcher(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
    captureCsrfToken(response);

    if (
      allowCsrfRetry &&
      unsafeMethods.has(method) &&
      response.status === 403 &&
      response.headers.get("x-csrf-token")?.toLowerCase() === "required"
    ) {
      csrfToken = undefined;
      return request<T>(path, init, false);
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new ApiError(response.status, errorCode(payload));
    }
    return payload as T;
  };

  return {
    async loadCurrentUser() {
      const response = await fetcher("/api/me", {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": "Fetch",
        },
      });
      captureCsrfToken(response);
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new ApiError(response.status, errorCode(payload));
      }
      return payload as CurrentUser;
    },
    async listConversations() {
      const payload = await request<{
        conversations: ConversationSummary[];
      }>("/api/conversations");
      return payload.conversations;
    },
    createConversation() {
      return request<ConversationSummary>("/api/conversations", {
        method: "POST",
      });
    },
    async deleteConversation(conversationId) {
      await request<void>(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
    },
    loadConversation(conversationId) {
      return request<ConversationDetail>(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
      );
    },
    sendMessage(conversationId, content) {
      return request<ConversationDetail>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
    },
    async improvePrompt(content) {
      const payload = await request<{ content: string }>("/api/prompt-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      return payload.content;
    },
    async listMcpServers() {
      const payload = await request<{ servers: McpServerRecord[] }>(
        "/api/admin/mcp-servers",
      );
      return payload.servers;
    },
    upsertMcpServer(serverId, input) {
      return request<McpServerRecord>(
        `/api/admin/mcp-servers/${encodeURIComponent(serverId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
    },
    pingMcpServer(serverId) {
      return request<McpServerRecord>(
        `/api/admin/mcp-servers/${encodeURIComponent(serverId)}/ping`,
        { method: "POST" },
      );
    },
    async listMcpServerTools(serverId) {
      const payload = await request<{ tools: string[] }>(`/api/admin/mcp-servers/${encodeURIComponent(serverId)}/tools`);
      return payload.tools;
    },
    getConversationPolicy() {
      return request<ConversationPolicy>("/api/admin/conversation-policy");
    },
    updateConversationPolicy(input) {
      return request<ConversationPolicy>("/api/admin/conversation-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    async listReportJobs() {
      const payload = await request<{ jobs: ReportJobSummary[] }>("/api/reports/jobs");
      return payload.jobs;
    },
    async listReportSources() {
      const payload = await request<{ sources: ReportSource[] }>("/api/reports/sources");
      return payload.sources;
    },
    async listReportJobRuns(jobId) { return (await request<{ runs: ReportJobRun[] }>(`/api/reports/jobs/${encodeURIComponent(jobId)}/runs`)).runs; },
    async deleteReportJob(jobId) { await request<void>(`/api/reports/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }); },
    setReportScheduleActive(jobId, active) { return request<ReportJobSummary>(`/api/reports/jobs/${encodeURIComponent(jobId)}/schedule-active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }); },
    createReportJob(input) {
      return request<ReportJobSummary>("/api/reports/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    runReportJob(jobId) {
      return request<ReportJobSummary>(`/api/reports/jobs/${encodeURIComponent(jobId)}/run`, {
        method: "POST",
      });
    },
    previewReportActionPlan(fileName, contentBase64) {
      return request<ReportActionPlanPreview>("/api/reports/action-plan-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, contentBase64 }),
      });
    },
    updateReportActionPlan(planId, plan) {
      return request<ReportActionPlanPreview>(`/api/reports/action-plans/${encodeURIComponent(planId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    },
    approveReportActionPlan(planId, revision) {
      return request<ReportActionPlanPreview>(`/api/reports/action-plans/${encodeURIComponent(planId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    },
    executeApprovedActionPlan(planId) {
      return request<ApprovedPlanExecutionResult>(`/api/reports/action-plans/${encodeURIComponent(planId)}/execute`, { method: "POST" });
    },
    regenerateReportActionPlan(planId) {
      return request<ReportActionPlanPreview>(`/api/reports/action-plans/${encodeURIComponent(planId)}/regenerate`, { method: "POST" });
    },
    async downloadReportJob(jobId, format) {
      const response = await fetcher(`/api/reports/jobs/${encodeURIComponent(jobId)}/export?format=${encodeURIComponent(format)}`, { credentials: "same-origin", headers: { Accept: "application/octet-stream" } });
      if (!response.ok) throw new ApiError(response.status, errorCode(await responsePayload(response)));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/u)?.[1] ?? `flowpilot-report.${format === "markdown" ? "md" : format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  };
}

export const flowPilotApi = createApiClient();

export async function loadCurrentUser(
  fetcher: typeof fetch = fetch,
): Promise<CurrentUser> {
  return createApiClient(fetcher).loadCurrentUser();
}
