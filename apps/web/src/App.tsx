import { Avatar, type AvatarDomRef } from "@ui5/webcomponents-react/Avatar";
import { BusyIndicator } from "@ui5/webcomponents-react/BusyIndicator";
import { Button } from "@ui5/webcomponents-react/Button";
import { MessageStrip } from "@ui5/webcomponents-react/MessageStrip";
import { Popover } from "@ui5/webcomponents-react/Popover";
import { ShellBar } from "@ui5/webcomponents-react/ShellBar";
import { TextArea } from "@ui5/webcomponents-react/TextArea";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  ApiError,
  flowPilotApi,
  type ConversationAttachment,
  type ConversationDetail,
  type ConversationSummary,
  type CurrentUser,
  type FlowPilotApi,
} from "./api";
import { McpRegistryView } from "./McpRegistryView";
import "./styles.css";

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type PendingAction =
  | "creating"
  | "sending"
  | "improving"
  | "deleting"
  | "uploading"
  | "deleting_attachment"
  | undefined;

type AppView = "chat" | "registry" | "reports";

const starterPrompts = [
  {
    label: "Investigate a failed message",
    prompt:
      "Investigate a failed message. I can provide its correlation ID, integration flow ID, or application message ID.",
  },
  {
    label: "Check transaction status",
    prompt:
      "Check the status of a transaction and explain the relevant processing-log results.",
  },
  {
    label: "Summarize recent errors",
    prompt:
      "Summarize recent failed integration messages and identify the most useful next checks.",
  },
  {
    label: "Explain an integration flow",
    prompt:
      "Help me investigate an integration flow. I will provide the flow ID and the observed symptom.",
  },
] as const;

function ReportsPlaceholder() {
  return (
    <main className="reports-page" aria-labelledby="reports-title">
      <header className="reports-header">
        <p className="section-label">Reporting workspace</p>
        <h1 id="reports-title">Reports</h1>
        <p>
          Plan approved jobs, collect operational evidence, and generate a
          report from the resulting data.
        </p>
      </header>
      <section className="reports-plan" aria-labelledby="reports-plan-title">
        <p className="section-label">Planned next</p>
        <h2 id="reports-plan-title">
          Reporting capabilities are being prepared
        </h2>
        <div className="reports-capabilities">
          <article>
            <h3>Planned jobs</h3>
            <p>
              Start from a reviewed static prompt and make the job scope
              explicit before it runs.
            </p>
          </article>
          <article>
            <h3>Evidence collection</h3>
            <p>
              Collect bounded data through approved APIs and MCP servers, with a
              reviewable execution record.
            </p>
          </article>
          <article>
            <h3>Generated reports</h3>
            <p>
              Generate a report from the job's collected data after its sources
              and time range are confirmed.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}

function userInitials(user: CurrentUser) {
  const name = user.displayName?.trim() || user.subject;
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function newestFirst(conversations: ConversationSummary[]) {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function visibleError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "FlowPilot could not complete the request. Please try again.";
  }
  switch (error.code) {
    case "conversation_busy":
      return "This conversation is already processing a message. Wait a moment and retry.";
    case "conversation_limit_reached":
      return "You have reached the configured conversation limit. Delete a conversation before creating another one.";
    case "model_unavailable":
      return "The assistant is temporarily unavailable. Your message was not lost; retry when ready.";
    case "model_quota_exhausted":
      return error.retryAfterSeconds
        ? `The model provider's quota is exhausted. Try again in about ${formatRetryDelay(error.retryAfterSeconds)}.`
        : "The model provider's quota is exhausted. Try again after the provider quota is available.";
    case "model_rate_limited":
      return error.retryAfterSeconds
        ? `The model provider is rate-limiting requests. Try again in about ${formatRetryDelay(error.retryAfterSeconds)}.`
        : "The model provider is rate-limiting requests. Please try again shortly.";
    case "not_found":
      return "This conversation is no longer available. Refresh the conversation list.";
    case "invalid_request":
      return "The request was not accepted. Check the message and try again.";
    case "server_unhealthy":
      return "The MCP server must pass an authenticated Ping before it can be enabled.";
    case "registry_unavailable":
      return "The MCP registry is temporarily unavailable. Try again shortly.";
    default:
      return error.status === 401 || error.status === 403
        ? "Your session or permission is no longer valid. Refresh the page and sign in again."
        : "FlowPilot could not complete the request. Please try again.";
  }
}

function formatRetryDelay(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface AppProps {
  client?: FlowPilotApi;
}

export function App({ client = flowPilotApi }: AppProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [user, setUser] = useState<CurrentUser>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<ConversationDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>(
    [],
  );
  const [requestError, setRequestError] = useState<string>();
  const [conversationToDelete, setConversationToDelete] =
    useState<ConversationSummary>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("chat");
  const detailRequest = useRef(0);
  const profileRef = useRef<AvatarDomRef>(null);
  const messageRegionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++detailRequest.current;
    setState({ status: "loading" });
    setRequestError(undefined);

    void (async () => {
      try {
        const currentUser = await client.loadCurrentUser();
        const available = newestFirst(await client.listConversations());
        if (cancelled) return;

        setUser(currentUser);
        setConversations(available);
        if (available[0]) {
          setDetailLoading(true);
          const detail = await client.loadConversation(available[0].id);
          if (cancelled || requestId !== detailRequest.current) return;
          setActiveConversation(detail);
        } else {
          setActiveConversation(undefined);
        }
        setState({ status: "ready" });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          message: visibleError(error),
        });
      } finally {
        if (!cancelled && requestId === detailRequest.current) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  useEffect(() => {
    const conversationId = activeConversation?.id;
    if (!conversationId) {
      setAttachments([]);
      setSelectedAttachmentIds([]);
      return;
    }
    let cancelled = false;
    setAttachmentsLoading(true);
    void client
      .listAttachments(conversationId)
      .then((available) => {
        if (!cancelled) setAttachments(available);
      })
      .catch((error) => {
        if (!cancelled) setRequestError(visibleError(error));
      })
      .finally(() => {
        if (!cancelled) setAttachmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, client]);

  const signedInName = user?.displayName?.trim() || user?.subject || "User";
  const characterCount = draft.length;
  const canSend =
    Boolean(activeConversation) &&
    draft.trim().length > 0 &&
    characterCount <= 4_000 &&
    !pendingAction;

  const orderedConversations = useMemo(
    () => newestFirst(conversations),
    [conversations],
  );

  useEffect(() => {
    if (!activeConversation || detailLoading) return;
    const region = messageRegionRef.current;
    if (!region) return;
    const scroll = () => {
      region.scrollTop = region.scrollHeight;
    };
    const frame = requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeConversation?.id,
    activeConversation?.messages.length,
    detailLoading,
  ]);

  const chooseConversation = async (
    conversationId: string,
    bypassDeletionConfirmation = false,
  ) => {
    if (
      conversationId === activeConversation?.id ||
      pendingAction === "sending" ||
      (conversationToDelete && !bypassDeletionConfirmation)
    ) {
      return;
    }
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setRequestError(undefined);
    try {
      const detail = await client.loadConversation(conversationId);
      if (requestId === detailRequest.current) {
        setActiveConversation(detail);
        setDraft("");
      }
    } catch (error) {
      if (requestId === detailRequest.current) {
        setRequestError(visibleError(error));
      }
    } finally {
      if (requestId === detailRequest.current) {
        setDetailLoading(false);
      }
    }
  };

  const createConversation = async () => {
    if (pendingAction) return;
    detailRequest.current += 1;
    setPendingAction("creating");
    setRequestError(undefined);
    try {
      const created = await client.createConversation();
      setConversations((current) =>
        newestFirst([
          created,
          ...current.filter(({ id }) => id !== created.id),
        ]),
      );
      setActiveConversation({ ...created, messages: [] });
      setDraft("");
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    const conversationId = activeConversation?.id;
    if (!conversationId || !content || !canSend) return;

    setPendingAction("sending");
    setRequestError(undefined);
    try {
      const detail = await client.sendMessage(
        conversationId,
        content,
        selectedAttachmentIds,
      );
      setActiveConversation(detail);
      if (detail.rolledOver) {
        setRequestError(
          "Conversation history limit reached. The oldest turn was removed.",
        );
      }
      setConversations((current) =>
        newestFirst([detail, ...current.filter(({ id }) => id !== detail.id)]),
      );
      setDraft("");
      setSelectedAttachmentIds([]);
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const improvePrompt = async () => {
    const content = draft.trim();
    if (!content || pendingAction) return;
    setPendingAction("improving");
    setRequestError(undefined);
    try {
      const improved = await client.improvePrompt(content);
      if (improved) setDraft(improved);
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const conversationId = activeConversation?.id;
    if (!file || !conversationId || pendingAction) return;
    setPendingAction("uploading");
    setRequestError(undefined);
    try {
      const attachment = await client.uploadAttachment(conversationId, file);
      setAttachments((current) => [attachment, ...current]);
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (pendingAction) return;
    setPendingAction("deleting_attachment");
    setRequestError(undefined);
    try {
      await client.deleteAttachment(attachmentId);
      setAttachments((current) =>
        current.filter(({ id }) => id !== attachmentId),
      );
      setSelectedAttachmentIds((current) =>
        current.filter((id) => id !== attachmentId),
      );
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const toggleAttachmentForMessage = (attachmentId: string) => {
    setSelectedAttachmentIds((current) =>
      current.includes(attachmentId)
        ? current.filter((id) => id !== attachmentId)
        : current.length < 3
          ? [...current, attachmentId]
          : current,
    );
  };

  const deleteConversation = async () => {
    if (!conversationToDelete || pendingAction) return;
    const { id: conversationId } = conversationToDelete;

    setPendingAction("deleting");
    setRequestError(undefined);
    try {
      await client.deleteConversation(conversationId);
      const remaining = conversations.filter(({ id }) => id !== conversationId);
      setConversations(remaining);
      setConversationToDelete(undefined);
      if (activeConversation?.id === conversationId) {
        setActiveConversation(undefined);
        setDraft("");
        if (remaining[0]) {
          void chooseConversation(newestFirst(remaining)[0].id, true);
        }
      }
    } catch (error) {
      setRequestError(visibleError(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    void sendMessage();
  };

  if (state.status === "loading") {
    return (
      <main className="startup" aria-labelledby="startup-title">
        <BusyIndicator active size="M" delay={0} />
        <h1 id="startup-title">Opening FlowPilot</h1>
        <p role="status">Verifying your session and loading conversations…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="startup" aria-labelledby="startup-title">
        <h1 id="startup-title">FlowPilot could not start</h1>
        <MessageStrip design="Negative" hideCloseButton>
          {state.message}
        </MessageStrip>
        <Button
          design="Emphasized"
          onClick={() => setReloadKey((current) => current + 1)}
        >
          Retry
        </Button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <ShellBar
        primaryTitle="FlowPilot"
        secondaryTitle="Operational assistant"
        logo={
          <span className="flowpilot-logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M8 9h10a6 6 0 0 1 0 12h-4v4" />
              <path d="m12 17-4 4 4 4" />
            </svg>
          </span>
        }
        profile={
          <Avatar
            ref={profileRef}
            initials={user ? userInitials(user) : "U"}
            accessibleName={`Open account details for ${signedInName}`}
          />
        }
        accessibilityAttributes={{
          logo: { name: "FlowPilot" },
          profile: {
            name: `Account details for ${signedInName}`,
            expanded: profileOpen ? "true" : "false",
            hasPopup: "dialog",
          },
        }}
        onProfileClick={() => setProfileOpen(true)}
      />

      <div className="app-frame">
        <aside className="primary-navigation">
          <div className="navigation-heading">
            <span className="navigation-mark" aria-hidden="true">
              <svg focusable="false" viewBox="0 0 32 32">
                <path d="M8 9h10a6 6 0 0 1 0 12h-4v4" />
                <path d="m12 17-4 4 4 4" />
              </svg>
            </span>
            <div>
              <strong>Workspace</strong>
              <span>Operations cockpit</span>
            </div>
          </div>
          <nav aria-label="Primary navigation" className="primary-nav-list">
            <button
              type="button"
              className={`primary-nav-item${activeView === "chat" ? " active" : ""}`}
              aria-current={activeView === "chat" ? "page" : undefined}
              onClick={() => setActiveView("chat")}
            >
              <span className="nav-glyph" aria-hidden="true">
                C
              </span>
              <span>
                <strong>Chat</strong>
                <small>Private troubleshooting</small>
              </span>
            </button>
            <button
              type="button"
              className={`primary-nav-item${activeView === "reports" ? " active" : ""}`}
              aria-current={activeView === "reports" ? "page" : undefined}
              onClick={() => setActiveView("reports")}
            >
              <span className="nav-glyph" aria-hidden="true">
                R
              </span>
              <span>
                <strong>Reports</strong>
                <small>Scheduled and export-ready</small>
              </span>
            </button>
            {user?.scopes.includes("ChatAdmin") && client.listMcpServers && (
              <button
                type="button"
                className={`primary-nav-item${activeView === "registry" ? " active" : ""}`}
                aria-current={activeView === "registry" ? "page" : undefined}
                onClick={() => setActiveView("registry")}
              >
                <span className="nav-glyph" aria-hidden="true">
                  M
                </span>
                <span>
                  <strong>MCP servers</strong>
                  <small>Connections and policy</small>
                </span>
              </button>
            )}
          </nav>
          <div className="navigation-footer">
            <span className="status-indicator" aria-hidden="true" />
            <span>
              <strong>Private tenant</strong>
              <small>Authenticated workspace</small>
            </span>
          </div>
        </aside>

        <section className="view-stage">
          {activeView === "chat" ? (
            <div className="workspace">
              <aside
                className="conversation-panel"
                aria-labelledby="history-title"
              >
                <div className="panel-header">
                  <div>
                    <h2 id="history-title">Conversations</h2>
                    <p>{orderedConversations.length} private conversations</p>
                  </div>
                  <Button
                    className="conversation-new"
                    design="Emphasized"
                    disabled={Boolean(pendingAction)}
                    loading={pendingAction === "creating"}
                    accessibleName="Create a new conversation"
                    onClick={() => void createConversation()}
                  >
                    New
                  </Button>
                </div>

                <nav
                  aria-label="Conversation history"
                  className="conversation-nav"
                >
                  {orderedConversations.length === 0 ? (
                    <p className="list-empty">No conversations yet.</p>
                  ) : (
                    <ol className="conversation-list">
                      {orderedConversations.map((conversation) => (
                        <li
                          key={conversation.id}
                          className={`conversation-entry${conversation.id === activeConversation?.id ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className="conversation-select"
                            aria-current={
                              conversation.id === activeConversation?.id
                                ? "page"
                                : undefined
                            }
                            onClick={() =>
                              void chooseConversation(conversation.id)
                            }
                          >
                            <span className="conversation-title">
                              {conversation.title}
                            </span>
                            <span className="conversation-updated">
                              {formatDate(conversation.updatedAt)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="conversation-delete"
                            disabled={
                              Boolean(pendingAction) ||
                              Boolean(conversationToDelete)
                            }
                            onClick={() =>
                              setConversationToDelete(conversation)
                            }
                            aria-label={`Delete ${conversation.title}`}
                            title="Delete conversation"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </nav>

                <div className="privacy-note">
                  <strong>{signedInName}</strong>
                  <span>
                    Only your authenticated session can access this history.
                  </span>
                </div>
              </aside>

              <main className="chat-panel" aria-labelledby="chat-title">
                <header className="chat-header">
                  <div>
                    <p className="section-label">
                      Private troubleshooting chat
                    </p>
                    <h1 id="chat-title">
                      {activeConversation?.title ?? "How can FlowPilot help?"}
                    </h1>
                  </div>
                </header>

                {conversationToDelete && (
                  <div className="delete-confirmation-backdrop">
                    <section
                      className="delete-confirmation"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="delete-confirmation-title"
                      aria-describedby="delete-confirmation-description"
                    >
                      <div>
                        <strong id="delete-confirmation-title">
                          Delete this conversation?
                        </strong>
                        <p id="delete-confirmation-description">
                          Delete “{conversationToDelete.title}” from your
                          private conversation history? This cannot be undone.
                        </p>
                      </div>
                      <div className="delete-confirmation-actions">
                        <Button
                          design="Transparent"
                          disabled={Boolean(pendingAction)}
                          onClick={() => setConversationToDelete(undefined)}
                        >
                          Cancel
                        </Button>
                        <Button
                          design="Negative"
                          disabled={Boolean(pendingAction)}
                          loading={pendingAction === "deleting"}
                          onClick={() => void deleteConversation()}
                        >
                          Delete conversation
                        </Button>
                      </div>
                    </section>
                  </div>
                )}

                {requestError && (
                  <MessageStrip
                    className="request-error"
                    design="Negative"
                    onClose={() => setRequestError(undefined)}
                  >
                    {requestError}
                  </MessageStrip>
                )}

                <section
                  ref={messageRegionRef}
                  className="message-region"
                  aria-label="Chat content"
                >
                  {detailLoading ? (
                    <div className="loading-detail" role="status">
                      <BusyIndicator active size="M" delay={0} />
                      <span>Loading conversation…</span>
                    </div>
                  ) : !activeConversation ? (
                    <div className="empty-state">
                      <div className="empty-state-symbol" aria-hidden="true">
                        FP
                      </div>
                      <h2>Start a focused troubleshooting session</h2>
                      <p>
                        Create a private conversation to investigate
                        transactions, interpret symptoms, and organize the next
                        checks.
                      </p>
                      <Button
                        design="Emphasized"
                        disabled={Boolean(pendingAction)}
                        loading={pendingAction === "creating"}
                        onClick={() => void createConversation()}
                      >
                        Start a conversation
                      </Button>
                    </div>
                  ) : activeConversation.messages.length === 0 ? (
                    <div className="empty-state compact">
                      <div className="empty-state-symbol" aria-hidden="true">
                        FP
                      </div>
                      <h2>Describe what you need to investigate</h2>
                      <p>
                        Include the observed symptom and relevant transaction or
                        integration context. Do not include secrets.
                      </p>
                      <div
                        className="starter-prompts"
                        role="group"
                        aria-label="Starter prompts"
                      >
                        {starterPrompts.map(({ label, prompt }) => (
                          <Button
                            key={label}
                            design="Transparent"
                            type="Button"
                            onClick={() => setDraft(prompt)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ol
                      className="message-list"
                      aria-label="Conversation messages"
                      aria-live="polite"
                    >
                      {activeConversation.messages.map((message) => (
                        <li
                          key={message.id}
                          className={`message ${message.role}`}
                        >
                          <div className="message-author">
                            {message.role === "user"
                              ? signedInName
                              : "FlowPilot"}
                          </div>
                          <div className="message-content">
                            {message.content}
                          </div>
                          {message.role === "assistant" && message.sources && (
                            <p className="message-sources">
                              Source:{" "}
                              {message.sources
                                .map(({ label }) => label)
                                .join(" · ")}
                            </p>
                          )}
                          {message.role === "assistant" &&
                            message.tables?.map((table) => (
                              <div
                                className="tool-table"
                                key={`${message.id}-${table.title}`}
                              >
                                <table>
                                  <caption>{table.title}</caption>
                                  <thead>
                                    <tr>
                                      {table.columns.map((column) => (
                                        <th key={column} scope="col">
                                          {column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {table.rows.map((row, rowIndex) => (
                                      <tr key={`${message.id}-${rowIndex}`}>
                                        {row.map((cell, cellIndex) => (
                                          <td
                                            key={`${message.id}-${rowIndex}-${table.columns[cellIndex]}`}
                                          >
                                            {cell ?? "—"}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                        </li>
                      ))}
                    </ol>
                  )}

                  {pendingAction === "sending" && (
                    <div className="assistant-progress" role="status">
                      <BusyIndicator active size="S" delay={0} />
                      <span>FlowPilot is preparing a response…</span>
                    </div>
                  )}
                </section>

                <form
                  className="composer"
                  aria-label="Send a message"
                  onSubmit={submitMessage}
                >
                  <section
                    className="attachments"
                    aria-labelledby="attachments-title"
                  >
                    <div className="attachments-heading">
                      <div>
                        <h2 id="attachments-title">Private attachments</h2>
                        <p>
                          TXT, CSV, XLSX, PNG, or JPEG up to 5 MiB. Files expire
                          after 30 days and are not sent to the model
                          automatically.
                        </p>
                      </div>
                      <label className="attachment-picker">
                        <span>Attach file</span>
                        <input
                          type="file"
                          accept=".txt,.csv,.xlsx,image/png,image/jpeg"
                          disabled={
                            !activeConversation || Boolean(pendingAction)
                          }
                          onChange={uploadAttachment}
                        />
                      </label>
                    </div>
                    {attachmentsLoading ? (
                      <span className="attachment-status" role="status">
                        Loading attachments…
                      </span>
                    ) : attachments.length ? (
                      <ul className="attachment-list">
                        {attachments.map((attachment) => (
                          <li key={attachment.id}>
                            {!attachment.contentType.startsWith("image/") && (
                              <label className="attachment-use">
                                <input
                                  type="checkbox"
                                  checked={selectedAttachmentIds.includes(
                                    attachment.id,
                                  )}
                                  disabled={
                                    Boolean(pendingAction) ||
                                    (!selectedAttachmentIds.includes(
                                      attachment.id,
                                    ) &&
                                      selectedAttachmentIds.length >= 3)
                                  }
                                  onChange={() =>
                                    toggleAttachmentForMessage(attachment.id)
                                  }
                                />
                                Use
                              </label>
                            )}
                            <a
                              href={`/api/attachments/${encodeURIComponent(attachment.id)}`}
                            >
                              {attachment.fileName}
                            </a>
                            <span>
                              {Math.ceil(attachment.byteSize / 1024)} KB ·
                              expires {formatDate(attachment.expiresAt)}
                            </span>
                            <button
                              type="button"
                              disabled={Boolean(pendingAction)}
                              onClick={() =>
                                void deleteAttachment(attachment.id)
                              }
                              aria-label={`Remove ${attachment.fileName}`}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="attachment-status">
                        No attachments in this conversation.
                      </p>
                    )}
                    {selectedAttachmentIds.length > 0 && (
                      <p className="attachment-status">
                        {selectedAttachmentIds.length} attachment
                        {selectedAttachmentIds.length === 1 ? "" : "s"} selected
                        for the next message.
                      </p>
                    )}
                  </section>
                  <TextArea
                    className="composer-input"
                    accessibleName="Message"
                    placeholder={
                      activeConversation
                        ? "Describe the issue or transaction to investigate"
                        : "Create a conversation before sending a message"
                    }
                    value={draft}
                    rows={3}
                    growing
                    growingMaxRows={7}
                    maxlength={4_000}
                    showExceededText
                    disabled={!activeConversation || Boolean(pendingAction)}
                    onInput={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                  />
                  <div className="composer-actions">
                    <span aria-live="polite">
                      {characterCount.toLocaleString()} / 4,000 characters
                    </span>
                    <div className="composer-buttons">
                      <Button
                        design="Transparent"
                        disabled={!draft.trim() || Boolean(pendingAction)}
                        loading={pendingAction === "improving"}
                        onClick={() => void improvePrompt()}
                      >
                        Improve prompt
                      </Button>
                      <Button
                        type="Submit"
                        design="Emphasized"
                        disabled={!canSend}
                        loading={pendingAction === "sending"}
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                </form>
              </main>
            </div>
          ) : activeView === "registry" ? (
            <McpRegistryView client={client} />
          ) : (
            <ReportsPlaceholder />
          )}
        </section>
      </div>

      <Popover
        open={profileOpen}
        opener={profileRef.current}
        headerText="Account"
        accessibleName="Authenticated account details"
        onClose={() => setProfileOpen(false)}
      >
        <div className="account-details">
          <strong>{signedInName}</strong>
          <span>Authenticated FlowPilot user</span>
          <span>Tenant: {user?.tenantId}</span>
        </div>
      </Popover>
    </div>
  );
}
