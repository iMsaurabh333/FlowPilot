import { Avatar, type AvatarDomRef } from "@ui5/webcomponents-react/Avatar";
import { BusyIndicator } from "@ui5/webcomponents-react/BusyIndicator";
import { Button } from "@ui5/webcomponents-react/Button";
import { List } from "@ui5/webcomponents-react/List";
import { ListItemStandard } from "@ui5/webcomponents-react/ListItemStandard";
import { MessageStrip } from "@ui5/webcomponents-react/MessageStrip";
import { Popover } from "@ui5/webcomponents-react/Popover";
import { ShellBar } from "@ui5/webcomponents-react/ShellBar";
import { Switch } from "@ui5/webcomponents-react/Switch";
import { TextArea } from "@ui5/webcomponents-react/TextArea";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  ApiError,
  flowPilotApi,
  type ConversationDetail,
  type ConversationSummary,
  type CurrentUser,
  type FlowPilotApi,
  type McpServerInput,
  type McpServerRecord,
} from "./api";
import "./styles.css";

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type PendingAction = "creating" | "sending" | undefined;

interface AdminDraft {
  key: string;
  serverId: string;
  profileId: McpServerRecord["profileId"];
  displayName: string;
  endpointUrl: string;
  mcpPath: string;
  externalPort: string;
  authProfileRef: string;
  allowedToolNames: string;
  requiredScopes: string;
  enabled: boolean;
  server?: McpServerRecord;
}

function draftFromServer(server: McpServerRecord): AdminDraft {
  return {
    key: server.serverId,
    serverId: server.serverId,
    profileId: server.profileId,
    displayName: server.displayName,
    endpointUrl: server.endpointUrl,
    mcpPath: server.mcpPath,
    externalPort:
      server.externalPort === null ? "" : String(server.externalPort),
    authProfileRef: server.authProfileRef,
    allowedToolNames: server.allowedToolNames.join(", "),
    requiredScopes: server.requiredScopes.join(", "),
    enabled: server.enabled,
    server,
  };
}

function newAdminDraft(): AdminDraft {
  return {
    key: "__new__",
    serverId: "",
    profileId: "cloud-integration-monitoring",
    displayName: "",
    endpointUrl: "",
    mcpPath: "/mcp",
    externalPort: "",
    authProfileRef: "destination:FLOWPILOT_CLOUD_INTEGRATION_MPL",
    allowedToolNames: "search_message_processing_logs",
    requiredScopes: "McpInvoke",
    enabled: false,
  };
}

function commaSeparated(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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
    case "model_unavailable":
      return "The assistant is temporarily unavailable. Your message was not lost; retry when ready.";
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
  const [requestError, setRequestError] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminDrafts, setAdminDrafts] = useState<Record<string, AdminDraft>>(
    {},
  );
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminPending, setAdminPending] = useState<string>();
  const [adminError, setAdminError] = useState<string>();
  const detailRequest = useRef(0);
  const profileRef = useRef<AvatarDomRef>(null);

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
        if (currentUser.scopes.includes("ChatAdmin") && client.listMcpServers) {
          setAdminLoading(true);
          try {
            const servers = await client.listMcpServers();
            if (!cancelled) {
              setAdminDrafts(
                Object.fromEntries(
                  servers.map((server) => [
                    server.serverId,
                    draftFromServer(server),
                  ]),
                ),
              );
            }
          } catch (error) {
            if (!cancelled) setAdminError(visibleError(error));
          } finally {
            if (!cancelled) setAdminLoading(false);
          }
        }
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

  const chooseConversation = async (conversationId: string) => {
    if (
      conversationId === activeConversation?.id ||
      pendingAction === "sending"
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
      const detail = await client.sendMessage(conversationId, content);
      setActiveConversation(detail);
      setConversations((current) =>
        newestFirst([detail, ...current.filter(({ id }) => id !== detail.id)]),
      );
      setDraft("");
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
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const updateAdminDraft = (key: string, patch: Partial<AdminDraft>) => {
    setAdminDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const addAdminServer = () => {
    setAdminError(undefined);
    setAdminDrafts((current) => ({ ...current, __new__: newAdminDraft() }));
  };

  const saveAdminServer = async (draft: AdminDraft) => {
    if (!client.upsertMcpServer || !draft.serverId.trim()) return;
    const pending = `${draft.key}:save`;
    setAdminPending(pending);
    setAdminError(undefined);
    const input: McpServerInput = {
      profileId: draft.profileId,
      displayName: draft.displayName,
      endpointUrl: draft.endpointUrl,
      mcpPath: draft.mcpPath,
      externalPort: draft.externalPort.trim()
        ? Number(draft.externalPort)
        : null,
      authProfileRef: draft.authProfileRef,
      allowedToolNames: commaSeparated(draft.allowedToolNames),
      requiredScopes: commaSeparated(draft.requiredScopes),
      enabled: draft.enabled,
    };
    try {
      const saved = await client.upsertMcpServer(draft.serverId.trim(), input);
      setAdminDrafts((current) => {
        const next = { ...current };
        delete next[draft.key];
        next[saved.serverId] = draftFromServer(saved);
        return next;
      });
    } catch (error) {
      setAdminError(visibleError(error));
      if (error instanceof ApiError && error.code === "server_unhealthy") {
        updateAdminDraft(draft.key, { enabled: false });
      }
    } finally {
      setAdminPending(undefined);
    }
  };

  const pingAdminServer = async (draft: AdminDraft) => {
    if (!client.pingMcpServer || !draft.server) return;
    const pending = `${draft.key}:ping`;
    setAdminPending(pending);
    setAdminError(undefined);
    try {
      const checked = await client.pingMcpServer(draft.server.serverId);
      setAdminDrafts((current) => ({
        ...current,
        [draft.key]: draftFromServer(checked),
      }));
    } catch (error) {
      setAdminError(visibleError(error));
    } finally {
      setAdminPending(undefined);
    }
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
        profile={
          <Avatar
            ref={profileRef}
            initials={user ? userInitials(user) : "U"}
            accessibleName={`Open account details for ${signedInName}`}
          />
        }
        accessibilityAttributes={{
          profile: {
            name: `Account details for ${signedInName}`,
            expanded: profileOpen ? "true" : "false",
            hasPopup: "dialog",
          },
        }}
        onProfileClick={() => setProfileOpen(true)}
      />

      <div className="workspace">
        <aside className="conversation-panel" aria-labelledby="history-title">
          <div className="panel-header">
            <div>
              <h2 id="history-title">Conversations</h2>
              <p>{orderedConversations.length} private conversations</p>
            </div>
            <Button
              design="Emphasized"
              disabled={Boolean(pendingAction)}
              loading={pendingAction === "creating"}
              accessibleName="Create a new conversation"
              onClick={() => void createConversation()}
            >
              New
            </Button>
          </div>

          <nav aria-label="Conversation history" className="conversation-nav">
            {orderedConversations.length === 0 ? (
              <p className="list-empty">No conversations yet.</p>
            ) : (
              <List separators="Inner">
                {orderedConversations.map((conversation) => (
                  <ListItemStandard
                    key={conversation.id}
                    text={conversation.title}
                    description={formatDate(conversation.updatedAt)}
                    type="Active"
                    navigated={conversation.id === activeConversation?.id}
                    accessibleName={`${conversation.title}, updated ${formatDate(conversation.updatedAt)}`}
                    onClick={() => void chooseConversation(conversation.id)}
                  />
                ))}
              </List>
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
              <p className="section-label">Private troubleshooting chat</p>
              <h1 id="chat-title">
                {activeConversation?.title ?? "How can FlowPilot help?"}
              </h1>
            </div>
          </header>

          {requestError && (
            <MessageStrip
              className="request-error"
              design="Negative"
              onClose={() => setRequestError(undefined)}
            >
              {requestError}
            </MessageStrip>
          )}

          <section className="message-region" aria-label="Chat content">
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
                  Create a private conversation to investigate transactions,
                  interpret symptoms, and organize the next checks.
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
              </div>
            ) : (
              <ol
                className="message-list"
                aria-label="Conversation messages"
                aria-live="polite"
              >
                {activeConversation.messages.map((message) => (
                  <li key={message.id} className={`message ${message.role}`}>
                    <div className="message-author">
                      {message.role === "user" ? signedInName : "FlowPilot"}
                    </div>
                    <div className="message-content">{message.content}</div>
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
              <Button
                type="Submit"
                design="Emphasized"
                disabled={!canSend}
                loading={pendingAction === "sending"}
              >
                Send
              </Button>
            </div>
          </form>
        </main>
      </div>

      {user?.scopes.includes("ChatAdmin") && client.listMcpServers && (
        <section className="admin-panel" aria-labelledby="mcp-admin-title">
          <header className="admin-panel-header">
            <div>
              <p className="section-label">Administrator controls</p>
              <h2 id="mcp-admin-title">MCP server registry</h2>
              <p>
                Configure approved server routes, optional external ports, and
                activation state. FlowPilot performs Ping on the server side.
              </p>
            </div>
            <Button
              design="Emphasized"
              disabled={Boolean(adminPending) || Boolean(adminDrafts.__new__)}
              onClick={addAdminServer}
            >
              Register server
            </Button>
          </header>

          {adminError && (
            <MessageStrip
              className="admin-error"
              design="Negative"
              onClose={() => setAdminError(undefined)}
            >
              {adminError}
            </MessageStrip>
          )}

          {adminLoading ? (
            <div className="admin-loading" role="status">
              <BusyIndicator active size="S" delay={0} />
              <span>Loading registry…</span>
            </div>
          ) : Object.keys(adminDrafts).length === 0 ? (
            <p className="admin-empty">No MCP servers are registered.</p>
          ) : (
            <div className="admin-server-list">
              {Object.values(adminDrafts).map((draft) => {
                const saving = adminPending === `${draft.key}:save`;
                const pinging = adminPending === `${draft.key}:ping`;
                return (
                  <article className="admin-server-card" key={draft.key}>
                    <div className="admin-server-heading">
                      <div>
                        <h3>{draft.displayName || "New MCP server"}</h3>
                        {draft.server && (
                          <span
                            className={`health-pill ${draft.server.healthState}`}
                          >
                            {draft.server.healthState.replaceAll("_", " ")}
                          </span>
                        )}
                      </div>
                      <div className="admin-server-actions">
                        <Button
                          disabled={Boolean(adminPending) || !draft.server}
                          loading={pinging}
                          onClick={() => void pingAdminServer(draft)}
                        >
                          Ping
                        </Button>
                        <Button
                          design="Emphasized"
                          disabled={
                            Boolean(adminPending) || !draft.serverId.trim()
                          }
                          loading={saving}
                          onClick={() => void saveAdminServer(draft)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="admin-form-grid">
                      <label>
                        Server ID
                        <input
                          value={draft.serverId}
                          disabled={Boolean(draft.server)}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              serverId: event.target.value,
                            })
                          }
                          placeholder="cloud-integration-monitoring"
                        />
                      </label>
                      <label>
                        Profile
                        <select
                          value={draft.profileId}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              profileId: event.target
                                .value as AdminDraft["profileId"],
                            })
                          }
                        >
                          <option value="cloud-integration-monitoring">
                            Cloud Integration monitoring
                          </option>
                          <option value="cloud-integration-content">
                            Cloud Integration content
                          </option>
                          <option value="event-mesh">Event Mesh</option>
                        </select>
                      </label>
                      <label>
                        Display name
                        <input
                          value={draft.displayName}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              displayName: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        HTTPS endpoint
                        <input
                          value={draft.endpointUrl}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              endpointUrl: event.target.value,
                            })
                          }
                          placeholder="https://approved-host.example"
                        />
                      </label>
                      <label>
                        MCP path
                        <input
                          value={draft.mcpPath}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              mcpPath: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        External port (optional)
                        <input
                          inputMode="numeric"
                          value={draft.externalPort}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              externalPort: event.target.value,
                            })
                          }
                          placeholder="Platform route"
                        />
                      </label>
                      <label>
                        Authentication profile
                        <input
                          value={draft.authProfileRef}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              authProfileRef: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Allowed tools (comma-separated)
                        <input
                          value={draft.allowedToolNames}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              allowedToolNames: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Required scopes (comma-separated)
                        <input
                          value={draft.requiredScopes}
                          onChange={(event) =>
                            updateAdminDraft(draft.key, {
                              requiredScopes: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="admin-toggle-row">
                      <Switch
                        checked={draft.enabled}
                        accessibleName={`Enable ${draft.displayName || "MCP server"}`}
                        textOn="On"
                        textOff="Off"
                        onChange={(event) =>
                          updateAdminDraft(draft.key, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      <span>
                        {draft.enabled
                          ? "Enabled after a successful Ping"
                          : "Disabled; its tools are excluded"}
                      </span>
                      {draft.server?.lastCheckedAt && (
                        <span className="admin-health-detail">
                          Last checked {formatDate(draft.server.lastCheckedAt)}
                          {draft.server.latencyMs === null
                            ? ""
                            : ` · ${draft.server.latencyMs} ms`}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

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
