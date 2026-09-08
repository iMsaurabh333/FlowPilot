import { BusyIndicator } from "@ui5/webcomponents-react/BusyIndicator";
import { Button } from "@ui5/webcomponents-react/Button";
import { MessageStrip } from "@ui5/webcomponents-react/MessageStrip";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  ApiError,
  type FlowPilotApi,
  type ConversationPolicy,
  type McpServerInput,
  type McpServerRecord,
} from "./api";

interface AdminDraft {
  key: string;
  serverId: string;
  displayName: string;
  endpointUrl: string;
  externalPort: string;
  authProfileRef: string;
  allowedToolNames: string;
  enabled: boolean;
  server?: McpServerRecord;
}

function draftFromServer(server: McpServerRecord): AdminDraft {
  return {
    key: server.serverId,
    serverId: server.serverId,
    displayName: server.displayName,
    endpointUrl: server.endpointUrl,
    externalPort:
      server.externalPort === null ? "" : String(server.externalPort),
    authProfileRef: server.authProfileRef,
    allowedToolNames: server.allowedToolNames.join(", "),
    enabled: server.enabled,
    server,
  };
}

function newAdminDraft(): AdminDraft {
  return {
    key: "__new__",
    serverId: "",
    displayName: "",
    endpointUrl: "",
    externalPort: "",
    authProfileRef: "",
    allowedToolNames: "",
    enabled: false,
  };
}

function commaSeparated(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function visibleAdminError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "FlowPilot could not complete the registry request. Please try again.";
  }
  switch (error.code) {
    case "server_unhealthy":
      return "The MCP server must pass an authenticated Ping before it can be enabled.";
    case "registry_unavailable":
      return "The MCP registry is temporarily unavailable. Try again shortly.";
    case "invalid_request":
      return "The registration was not accepted. Check the connection and allowlist fields.";
    default:
      return error.status === 401 || error.status === 403
        ? "Your administrator permission is no longer valid. Refresh the page and sign in again."
        : "FlowPilot could not complete the registry request. Please try again.";
  }
}

function healthLabel(state: McpServerRecord["healthState"]) {
  return state.replaceAll("_", " ");
}

export interface McpRegistryViewProps {
  client: FlowPilotApi;
}

export function McpRegistryView({ client }: McpRegistryViewProps) {
  const [drafts, setDrafts] = useState<Record<string, AdminDraft>>({});
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [conversationPolicy, setConversationPolicy] = useState<ConversationPolicy>();
  const [availableTools, setAvailableTools] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const servers = await client.listMcpServers?.();
        if (cancelled) return;
        const next = Object.fromEntries(
          (servers ?? []).map((server) => [
            server.serverId,
            draftFromServer(server),
          ]),
        );
        setDrafts(next);
        setSelectedKey(servers?.[0]?.serverId);
      } catch (caught) {
        if (!cancelled) setError(visibleAdminError(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void client.getConversationPolicy?.().then(
      (policy) => !cancelled && setConversationPolicy(policy),
      (caught) => !cancelled && setError(visibleAdminError(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const orderedDrafts = useMemo(
    () =>
      Object.values(drafts).sort((left, right) => {
        if (left.key === "__new__") return -1;
        if (right.key === "__new__") return 1;
        return (left.displayName || left.serverId).localeCompare(
          right.displayName || right.serverId,
        );
      }),
    [drafts],
  );
  const selectedDraft = selectedKey ? drafts[selectedKey] : undefined;
  const servers = orderedDrafts.filter((draft) => draft.server);
  const enabledCount = servers.filter((draft) => draft.server?.enabled).length;
  const healthyCount = servers.filter(
    (draft) => draft.server?.healthState === "healthy",
  ).length;

  const updateDraft = (key: string, patch: Partial<AdminDraft>) => {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const addServer = () => {
    setError(undefined);
    if (drafts.__new__) {
      setSelectedKey("__new__");
      return;
    }
    setDrafts((current) => ({ ...current, __new__: newAdminDraft() }));
    setSelectedKey("__new__");
  };

  const discardNewServer = () => {
    setDrafts((current) => {
      const next = { ...current };
      delete next.__new__;
      return next;
    });
    setSelectedKey(servers[0]?.key);
    setError(undefined);
  };

  const saveServer = async (draft: AdminDraft) => {
    if (!client.upsertMcpServer || !draft.serverId.trim()) return;
    const pendingKey = `${draft.key}:save`;
    setPending(pendingKey);
    setError(undefined);
    const input: McpServerInput = {
      policyPresetId:
        draft.authProfileRef === "technical:flowpilot-mcp-content"
          ? "cloud-integration-content"
          : "generic",
      displayName: draft.displayName,
      endpointUrl: draft.endpointUrl,
      externalPort: draft.externalPort.trim()
        ? Number(draft.externalPort)
        : null,
      authProfileRef: draft.authProfileRef,
      allowedToolNames: commaSeparated(draft.allowedToolNames),
      enabled: draft.enabled,
    };
    try {
      const saved = await client.upsertMcpServer(draft.serverId.trim(), input);
      setDrafts((current) => {
        const next = { ...current };
        delete next[draft.key];
        next[saved.serverId] = draftFromServer(saved);
        return next;
      });
      setSelectedKey(saved.serverId);
    } catch (caught) {
      setError(visibleAdminError(caught));
      if (caught instanceof ApiError && caught.code === "server_unhealthy") {
        updateDraft(draft.key, { enabled: false });
      }
    } finally {
      setPending(undefined);
    }
  };

  const pingServer = async (draft: AdminDraft) => {
    if (!client.pingMcpServer || !draft.server) return;
    const pendingKey = `${draft.key}:ping`;
    setPending(pendingKey);
    setError(undefined);
    try {
      const checked = await client.pingMcpServer(draft.server.serverId);
      setDrafts((current) => ({
        ...current,
        [draft.key]: draftFromServer(checked),
      }));
    } catch (caught) {
      setError(visibleAdminError(caught));
    } finally {
      setPending(undefined);
    }
  };

  const discoverTools = async (draft: AdminDraft) => {
    if (!client.listMcpServerTools || !draft.server) return;
    setPending(`${draft.key}:tools`);
    try { setAvailableTools(await client.listMcpServerTools(draft.server.serverId)); }
    catch (caught) { setError(visibleAdminError(caught)); }
    finally { setPending(undefined); }
  };

  const addAllowedTool = (tool: string) => {
    if (!selectedDraft) return;
    const names = commaSeparated(selectedDraft.allowedToolNames);
    if (!names.includes(tool)) updateDraft(selectedDraft.key, { allowedToolNames: [...names, tool].join(", ") });
  };

  const submitServer = (event: FormEvent) => {
    event.preventDefault();
    if (selectedDraft) void saveServer(selectedDraft);
  };

  const saveConversationPolicy = (event: FormEvent) => {
    event.preventDefault();
    if (!conversationPolicy || !client.updateConversationPolicy) return;
    setPending("conversation-policy");
    setError(undefined);
    void client.updateConversationPolicy(conversationPolicy).then(
      (saved) => setConversationPolicy(saved),
      (caught) => setError(visibleAdminError(caught)),
    ).finally(() => setPending(undefined));
  };

  return (
    <main className="registry-page" aria-labelledby="mcp-admin-title">
      <header className="registry-page-header">
        <div>
          <p className="section-label">Administrator workspace</p>
          <h1 id="mcp-admin-title">MCP servers</h1>
          <p>
            Register trusted MCP endpoints and decide exactly which tools can
            enter FlowPilot.
          </p>
        </div>
        <Button
          design="Emphasized"
          disabled={Boolean(pending)}
          onClick={addServer}
        >
          Register server
        </Button>
      </header>

      <section className="registry-metrics" aria-label="Registry summary">
        <div>
          <strong>{servers.length}</strong>
          <span>Registered</span>
        </div>
        <div>
          <strong>{enabledCount}</strong>
          <span>Enabled</span>
        </div>
        <div>
          <strong>{healthyCount}</strong>
          <span>Healthy</span>
        </div>
      </section>

      {conversationPolicy && (
        <form
          className="conversation-policy"
          aria-label="Conversation policy"
          onSubmit={saveConversationPolicy}
        >
          <div>
            <p className="section-label">Conversation policy</p>
            <h2>Retention limits</h2>
            <span>Limits apply to each user and keep chat history bounded.</span>
          </div>
          <label>
            Maximum conversations per user
            <input
              type="number"
              min="1"
              max="1000"
              value={conversationPolicy.maxConversationsPerUser}
              disabled={Boolean(pending)}
              onChange={(event) => setConversationPolicy({ ...conversationPolicy, maxConversationsPerUser: Number(event.target.value) })}
            />
          </label>
          <label>
            Maximum retained turns per conversation
            <input
              type="number"
              min="2"
              max="500"
              value={conversationPolicy.maxRetainedTurns}
              disabled={Boolean(pending)}
              onChange={(event) => setConversationPolicy({ ...conversationPolicy, maxRetainedTurns: Number(event.target.value) })}
            />
          </label>
          <Button type="Submit" design="Emphasized" disabled={Boolean(pending)} loading={pending === "conversation-policy"}>Save limits</Button>
        </form>
      )}

      {error && (
        <MessageStrip
          className="registry-error"
          design="Negative"
          onClose={() => setError(undefined)}
        >
          {error}
        </MessageStrip>
      )}

      <div className="registry-workspace">
        <aside className="server-browser" aria-labelledby="registered-title">
          <header>
            <h2 id="registered-title">Registered servers</h2>
            <span>{servers.length}</span>
          </header>
          {loading ? (
            <div className="registry-loading" role="status">
              <BusyIndicator active size="S" delay={0} />
              <span>Loading registry…</span>
            </div>
          ) : orderedDrafts.length === 0 ? (
            <div className="registry-empty">
              <strong>No servers yet</strong>
              <span>Add a trusted MCP endpoint to get started.</span>
              <Button onClick={addServer}>Register server</Button>
            </div>
          ) : (
            <nav className="server-list" aria-label="Server registrations">
              {orderedDrafts.map((draft) => (
                <button
                  className={`server-list-item${selectedKey === draft.key ? " active" : ""}`}
                  key={draft.key}
                  type="button"
                  aria-current={selectedKey === draft.key ? "page" : undefined}
                  onClick={() => setSelectedKey(draft.key)}
                >
                  <span className="server-list-copy">
                    <strong>{draft.displayName || "New MCP server"}</strong>
                    <span>{draft.serverId || "Complete the registration"}</span>
                  </span>
                  {draft.server ? (
                    <span
                      className={`health-dot ${draft.server.healthState}`}
                      title={healthLabel(draft.server.healthState)}
                      aria-label={healthLabel(draft.server.healthState)}
                    />
                  ) : (
                    <span className="draft-badge">Draft</span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </aside>

        {selectedDraft ? (
          <form
            className="registry-editor"
            aria-label={`${selectedDraft.server ? "Edit" : "Register"} MCP server`}
            onSubmit={submitServer}
          >
            <header className="registry-editor-header">
              <div>
                <p className="section-label">
                  {selectedDraft.server
                    ? "Server settings"
                    : "New registration"}
                </p>
                <h2>{selectedDraft.displayName || "New MCP server"}</h2>
              </div>
              {selectedDraft.server && (
                <span
                  className={`health-pill ${selectedDraft.server.healthState}`}
                >
                  {healthLabel(selectedDraft.server.healthState)}
                </span>
              )}
            </header>

            <section className="policy-preset" aria-labelledby="policy-title">
              <div className="policy-mark" aria-hidden="true">
                GP
              </div>
              <div>
                <p id="policy-title">Generic secure MCP</p>
                <span>
                  HTTPS or local loopback · /mcp · managed authentication ·
                  McpInvoke scope
                </span>
              </div>
              <span className="preset-badge">Policy preset</span>
            </section>

            <div className="registry-form-grid">
              <label>
                Server ID
                <input
                  value={selectedDraft.serverId}
                  disabled={Boolean(selectedDraft.server) || Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      serverId: event.target.value,
                    })
                  }
                  placeholder="cloud-integration"
                  pattern="[a-z0-9][a-z0-9-]{0,62}"
                  required
                />
                <span>Stable lowercase ID used to namespace tools.</span>
              </label>
              <label>
                Display name
                <input
                  value={selectedDraft.displayName}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      displayName: event.target.value,
                    })
                  }
                  placeholder="Cloud Integration monitoring"
                  maxLength={120}
                  required
                />
              </label>
              <label className="wide-field">
                HTTPS endpoint
                <input
                  type="url"
                  value={selectedDraft.endpointUrl}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      endpointUrl: event.target.value,
                    })
                  }
                  placeholder="https://approved-host.example"
                  required
                />
                <span>The preset adds the fixed /mcp protocol path.</span>
              </label>
              <label>
                Authentication profile
                <input
                  value={selectedDraft.authProfileRef}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      authProfileRef: event.target.value,
                    })
                  }
                  placeholder="technical:flowpilot-mcp"
                  pattern="(?:destination:[A-Za-z0-9_.-]{1,100}|technical:flowpilot-mcp)"
                  required
                />
                <span>
                  Use the approved technical profile for FlowPilot MCP; no
                  secret is stored in the registry.
                </span>
                {selectedDraft.server && (
                  <div className="available-tools">
                    <Button type="Button" design="Transparent" disabled={Boolean(pending)} loading={pending === `${selectedDraft.key}:tools`} onClick={() => void discoverTools(selectedDraft)}>Discover available tools</Button>
                    {availableTools.length > 0 && <div role="list" aria-label="Available MCP tools">{availableTools.map((tool) => <Button key={tool} type="Button" design="Transparent" onClick={() => addAllowedTool(tool)}>{tool}</Button>)}</div>}
                  </div>
                )}
              </label>
              <label className="wide-field">
                External port <span className="optional">Optional</span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={selectedDraft.externalPort}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      externalPort: event.target.value,
                    })
                  }
                  placeholder="Platform route"
                />
              </label>
              <label className="wide-field">
                Allowed tools <span className="optional">Comma-separated</span>
                <input
                  value={selectedDraft.allowedToolNames}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      allowedToolNames: event.target.value,
                    })
                  }
                  placeholder="search_message_processing_logs, get_message_processing_log_error_information"
                />
                <span>
                  Only named tools are exposed. Ping fails if an allowed tool is
                  missing from the server. Add the error-information tool only
                  when error-detail access is approved.
                </span>
              </label>
            </div>

            <section className="activation-row" aria-label="Activation">
              <label className="activation-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={selectedDraft.enabled}
                  disabled={Boolean(pending)}
                  aria-label={`Enable ${selectedDraft.displayName || "MCP server"}`}
                  onChange={(event) =>
                    updateDraft(selectedDraft.key, {
                      enabled: event.target.checked,
                    })
                  }
                />
                <span className="activation-switch-track" aria-hidden="true" />
              </label>
              <div>
                <strong>
                  {selectedDraft.enabled ? "Server enabled" : "Server disabled"}
                </strong>
                <span>
                  {selectedDraft.enabled
                    ? "Saving will require a successful authenticated Ping."
                    : "Its tools remain outside the agent runtime."}
                </span>
              </div>
            </section>

            {selectedDraft.server && (
              <dl className="health-facts">
                <div>
                  <dt>Last checked</dt>
                  <dd>
                    {selectedDraft.server.lastCheckedAt
                      ? formatDate(selectedDraft.server.lastCheckedAt)
                      : "Not checked"}
                  </dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd>
                    {selectedDraft.server.latencyMs === null
                      ? "—"
                      : `${selectedDraft.server.latencyMs} ms`}
                  </dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{selectedDraft.server.protocolVersion ?? "—"}</dd>
                </div>
                <div>
                  <dt>Discovered tools</dt>
                  <dd>{selectedDraft.server.discoveredToolCount ?? "—"}</dd>
                </div>
              </dl>
            )}

            <footer className="registry-editor-actions">
              {selectedDraft.key === "__new__" && (
                <Button
                  type="Button"
                  disabled={Boolean(pending)}
                  onClick={discardNewServer}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="Button"
                disabled={Boolean(pending) || !selectedDraft.server}
                loading={pending === `${selectedDraft.key}:ping`}
                onClick={() => void pingServer(selectedDraft)}
              >
                Ping server
              </Button>
              <Button
                type="Button"
                design="Emphasized"
                disabled={Boolean(pending) || !selectedDraft.serverId.trim()}
                loading={pending === `${selectedDraft.key}:save`}
                onClick={() => void saveServer(selectedDraft)}
              >
                Save registration
              </Button>
            </footer>
          </form>
        ) : (
          <section className="registry-editor-empty" aria-live="polite">
            <div className="empty-state-symbol" aria-hidden="true">
              MCP
            </div>
            <h2>Select a server</h2>
            <p>Choose a registration to review it, or add a new MCP server.</p>
          </section>
        )}
      </div>
    </main>
  );
}
