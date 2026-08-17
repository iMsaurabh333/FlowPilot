import { Avatar, type AvatarDomRef } from "@ui5/webcomponents-react/Avatar";
import { BusyIndicator } from "@ui5/webcomponents-react/BusyIndicator";
import { Button } from "@ui5/webcomponents-react/Button";
import { List } from "@ui5/webcomponents-react/List";
import { ListItemStandard } from "@ui5/webcomponents-react/ListItemStandard";
import { MessageStrip } from "@ui5/webcomponents-react/MessageStrip";
import { Popover } from "@ui5/webcomponents-react/Popover";
import { ShellBar } from "@ui5/webcomponents-react/ShellBar";
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
} from "./api";
import "./styles.css";

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type PendingAction = "creating" | "sending" | undefined;

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
