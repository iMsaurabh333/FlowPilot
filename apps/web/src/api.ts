export interface CurrentUser {
  subject: string;
  tenantId: string;
  displayName?: string;
  scopes: string[];
}

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
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export interface FlowPilotApi {
  loadCurrentUser(): Promise<CurrentUser>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  sendMessage(
    conversationId: string,
    content: string,
  ): Promise<ConversationDetail>;
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
  };
}

export const flowPilotApi = createApiClient();

export async function loadCurrentUser(
  fetcher: typeof fetch = fetch,
): Promise<CurrentUser> {
  return createApiClient(fetcher).loadCurrentUser();
}
