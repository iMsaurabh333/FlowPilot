import { Button } from "@ui5/webcomponents-react/Button";
import { useEffect, useMemo, useState } from "react";
import type {
  FlowPilotApi,
  IdentifierType,
  McpServerRecord,
  McpToolMetadata,
} from "./api";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function mapLines(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.split(/:\s*/, 2))
      .filter(([key, item]) => key && item),
  );
}

function responseJson(value: string): JsonValue | undefined {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function statusClass(status: IdentifierType["status"]) {
  return status.toLowerCase();
}

function labelFromPath(path: string) {
  return (
    path
      .replace(/^\$\.?/u, "")
      .split(/[.[\]]/u)
      .filter(Boolean)
      .at(-1)
      ?.replace(/([A-Z])/g, " $1")
      .replace(/^./, (part) => part.toUpperCase()) ?? "Identifier"
  );
}
function requestLabel(parameters: Record<string, string>) {
  const labels = Object.keys(parameters).map((name) => name.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/[-_]/g, " "));
  return labels.join(", ") || "Configured input";
}

function JsonTree({
  value,
  path,
  onSelect,
}: {
  value: JsonValue;
  path: string;
  onSelect: (path: string) => void;
}) {
  if (value === null || typeof value !== "object") {
    return (
      <button
        className="json-tree-leaf"
        type="button"
        onClick={() => onSelect(path)}
        title={`Use ${path} as the extraction path`}
      >
        <span>{path === "$" ? "value" : path.split(".").at(-1)}</span>
        <code>{JSON.stringify(value)}</code>
      </button>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item] as const)
    : Object.entries(value);
  return (
    <ul className="json-tree">
      {entries.map(([key, item]) => {
        const childPath = Array.isArray(value)
          ? `${path}${key}`
          : path === "$"
            ? `$.${key}`
            : `${path}.${key}`;
        const leaf = item === null || typeof item !== "object";
        return (
          <li key={childPath}>
            {leaf ? (
              <button
                className="json-tree-leaf"
                type="button"
                onClick={() => onSelect(childPath)}
                title={`Use ${childPath} as the extraction path`}
              >
                <span>{key}</span>
                <code>{JSON.stringify(item)}</code>
              </button>
            ) : (
              <details open>
                <summary>{key}</summary>
                <JsonTree value={item} path={childPath} onSelect={onSelect} />
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function McpConfigurationView({ client }: { client: FlowPilotApi }) {
  const [tab, setTab] = useState<"identifiers" | "test">("identifiers");
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [items, setItems] = useState<IdentifierType[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selected, setSelected] = useState<IdentifierType>();
  const [tools, setTools] = useState<McpToolMetadata[]>([]);
  const [toolName, setToolName] = useState("");
  const [parameters, setParameters] = useState("");
  const [response, setResponse] = useState("");
  const [responseStatus, setResponseStatus] = useState<string>();
  const [responseView, setResponseView] = useState<"formatted" | "raw" | "tree">("formatted");
  const [field, setField] = useState("");
  const [notice, setNotice] = useState<string>();

  const selectedServer = servers.find((server) => server.serverId === selectedServerId);
  const selectedTool = tools.find((tool) => tool.name === toolName);
  const serverItems = useMemo(
    () => items.filter((item) => item.systemId === selectedServerId),
    [items, selectedServerId],
  );
  const parsedResponse = useMemo(() => responseJson(response), [response]);
  const formattedResponse = useMemo(
    () => (parsedResponse === undefined ? response : JSON.stringify(parsedResponse, null, 2)),
    [parsedResponse, response],
  );

  useEffect(() => {
    if (!client.listMcpServers) {
      setNotice("Registered MCP servers are unavailable in this environment.");
      return;
    }
    void client
      .listMcpServers()
      .then((available) => {
        const callable = available.filter(
          (server) => server.enabled && server.healthState === "healthy",
        );
        setServers(callable);
        setSelectedServerId((current) => current || callable[0]?.serverId || "");
        if (!callable.length) {
          setNotice("No enabled, healthy MCP servers are available. Register and Ping a server in Settings first.");
        }
      })
      .catch(() => setNotice("Registered MCP servers could not be loaded."));
  }, [client]);

  useEffect(() => {
    if (!client.listIdentifierTypes) return;
    void client
      .listIdentifierTypes()
      .then(setItems)
      .catch(() => setNotice("Identifier definitions could not be loaded."));
  }, [client]);

  useEffect(() => {
    setTools([]);
    setToolName("");
    setResponse("");
    setField("");
    if (!selectedServerId || !client.listMcpServerTools) return;
    void client
      .listMcpServerTools(selectedServerId)
      .then((names) => {
        const discovered = names.map((name) => ({
          name,
          description: "Required inputs are supplied by this tool when it is called.",
          requiredInputs: [],
          bodyFormats: [] as Array<"json" | "xml">,
        }));
        setTools(discovered);
        setToolName(discovered[0]?.name ?? "");
      })
      .catch(() => setNotice("Tools could not be discovered from this server."));
  }, [client, selectedServerId]);

  const test = async () => {
    if (!selectedServerId || !toolName) {
      setNotice("Select a registered server and a discovered tool first.");
      return;
    }
    if (!client.testMcpTool) {
      setNotice("MCP request execution is not available from this environment. No request was sent.");
      return;
    }
    try {
      const result = await client.testMcpTool({
        serverId: selectedServerId,
        toolName,
        parameters: mapLines(parameters),
        headers: {},
        requestBody: "",
        requestFormat: "none",
      });
      setResponse(result.response);
      setResponseStatus(`${result.status} · ${result.durationMs} ms`);
      setField("");
      setResponseView("formatted");
      setNotice("Request completed. Select a value in the response tree to set its extraction path.");
    } catch {
      setResponse("");
      setResponseStatus(undefined);
      setNotice("The test could not be completed. No production definition was changed.");
    }
  };

  const saveAsIdentifier = async () => {
    if (!selectedServer || !response || !field) {
      setNotice("Run a successful request and select a response field before saving.");
      return;
    }
    const cleanPath = field.replace(/^\$\.?/u, "");
    const entity = cleanPath.split(/[.[\]]/u).filter(Boolean)[0] || "BusinessEntity";
    const fieldName = cleanPath.split(/[.[\]]/u).filter(Boolean).at(-1) || "Identifier";
    const item: IdentifierType = {
      id: crypto.randomUUID(),
      systemId: selectedServer.serverId,
      systemName: selectedServer.displayName,
      friendlyName: labelFromPath(field),
      entity,
      field: fieldName,
      compositeKey: `${selectedServer.serverId}:${entity}:${fieldName}`,
      status: "Draft",
      retrieval: {
        serverId: selectedServer.serverId,
        toolName,
        parameters: Object.fromEntries(Object.keys(mapLines(parameters)).map((name) => [name, "{identifier}"])),
        headers: {},
        requestBody: "",
        requestFormat: "none",
        responseExtractionPath: field,
        expectedField: field,
        expectedValue: "{identifier}",
      },
      version: 1,
      lastTestedAt: new Date().toISOString(),
      lastTestResult: "passed",
    };
    try {
      const saved = client.saveIdentifierType
        ? await client.saveIdentifierType(item)
        : item;
      setItems((current) => [...current, saved]);
      setSelected(saved);
      setTab("identifiers");
      setNotice(`Saved as a Draft under ${selectedServer.displayName}. It will not be available to reports until activated.`);
    } catch {
      setNotice("The tested configuration could not be saved.");
    }
  };

  const setStatus = async (status: IdentifierType["status"]) => {
    if (!selected) return;
    try {
      const updated = client.setIdentifierTypeStatus
        ? await client.setIdentifierTypeStatus(selected.id, status)
        : { ...selected, status, version: selected.version + 1 };
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelected(updated);
      setNotice(status === "Active" ? `${updated.friendlyName} is Active and can now be selected for reconciliation.` : `${updated.friendlyName} is ${status}.`);
    } catch {
      setNotice("The identifier type status could not be updated.");
    }
  };

  return (
    <main className="mcp-configuration-page" aria-labelledby="mcp-configuration-title">
      <header className="mcp-configuration-header">
        <div>
          <p className="section-label">APP ADMINISTRATION</p>
          <h1 id="mcp-configuration-title">MCP Configuration</h1>
          <p>Validate configured MCP servers and turn successful tests into business identifier definitions.</p>
        </div>
        <span className="admin-only-badge">App Admin</span>
      </header>
      <div className="mcp-configuration-tabs" role="tablist" aria-label="MCP Configuration sections">
        <button type="button" role="tab" aria-selected={tab === "identifiers"} className={tab === "identifiers" ? "active" : ""} onClick={() => setTab("identifiers")}>Identifier Types</button>
        <button type="button" role="tab" aria-selected={tab === "test"} className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}>MCP Test Client</button>
      </div>
      <div className="mcp-configuration-body" role="tabpanel">
        {notice && <p className="mcp-notice" role="status">{notice}</p>}
        {tab === "identifiers" ? (
          <div className="identifier-workspace">
            <aside className="identifier-systems">
              <header><h2>Configured systems</h2><span>{servers.length}</span></header>
              {servers.map((server) => (
                <button type="button" key={server.serverId} className={selectedServerId === server.serverId ? "active" : ""} onClick={() => { setSelectedServerId(server.serverId); setSelected(undefined); }}>
                  <strong>{server.displayName}</strong>
                  <small>{items.filter((item) => item.systemId === server.serverId).length} identifier types</small>
                </button>
              ))}
              {!servers.length && <p className="identifier-empty">No callable MCP systems.</p>}
            </aside>
            <section className="identifier-main">
              <header>
                <div><p className="section-label">{selectedServer?.displayName ?? "No system selected"}</p><h2>Identifier types</h2><p>Definitions are tied to their MCP server; report users see only friendly names.</p></div>
                <Button disabled={!selectedServer} onClick={() => setTab("test")}>Create from test</Button>
              </header>
              {serverItems.length ? <div className="identifier-list">{serverItems.map((item) => <button key={item.id} type="button" className={selected?.id === item.id ? "active" : ""} onClick={() => setSelected(item)}><span><strong>{item.friendlyName}</strong><small>{item.entity} · {item.field}</small></span><span className={`identifier-status ${statusClass(item.status)}`}>{item.status}</span><small>{item.retrieval.toolName}</small></button>)}</div> : <p className="identifier-empty">No identifier types are saved for this MCP system yet. Test a configured tool to create a Draft.</p>}
              {selected && <section className="identifier-detail" aria-label="Identifier type details"><header><div><p className="section-label">Identifier detail</p><h3>{selected.friendlyName}</h3></div><div className="identifier-detail-actions"><span className={`identifier-status ${statusClass(selected.status)}`}>{selected.status}</span>{selected.status === "Draft" && <Button design="Emphasized" onClick={() => void setStatus("Active")}>Activate</Button>}{selected.status === "Active" && <Button onClick={() => void setStatus("Retired")}>Retire</Button>}</div></header><p className="identifier-status-guidance">{selected.status === "Draft" ? "Review the tested lookup input and response path, then activate this identifier to make it available for reconciliation." : selected.status === "Active" ? "Reconciliation sends its entered value to the lookup input and returns the selected response field in the report." : "Retired identifier types are kept for audit history and cannot be selected."}</p><dl><div><dt>Lookup input</dt><dd>{requestLabel(selected.retrieval.parameters)}</dd></div><div><dt>Response field</dt><dd>{selected.entity} · {selected.field}</dd></div><div><dt>Business composite key</dt><dd>{selected.compositeKey}</dd></div><div><dt>Internal ID</dt><dd>{selected.id}</dd></div><div><dt>Linked tool / API</dt><dd>{selected.retrieval.serverId} · {selected.retrieval.toolName}</dd></div><div><dt>Response extraction</dt><dd>{selected.retrieval.responseExtractionPath}</dd></div></dl></section>}
            </section>
          </div>
        ) : (
          <section className="mcp-test-client">
            <header>
              <div><p className="section-label">SAFE PLAYGROUND</p><h2>MCP Test Client</h2><p>Only enabled, healthy servers configured in Settings are available here. Tests do not change production reports.</p></div>
              <Button design="Emphasized" disabled={!response || !field} onClick={() => void saveAsIdentifier()}>Save as Identifier Type</Button>
            </header>
            <div className="mcp-test-grid">
              <section className="mcp-request">
                <div className="field-row">
                  <label>Configured server<select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)} disabled={!servers.length}><option value="">Select a server</option>{servers.map((server) => <option key={server.serverId} value={server.serverId}>{server.displayName}</option>)}</select></label>
                  <label>Discovered tool / API<select value={toolName} onChange={(event) => setToolName(event.target.value)} disabled={!tools.length}><option value="">Select a tool</option>{tools.map((tool) => <option key={tool.name}>{tool.name}</option>)}</select></label>
                </div>
                <section className="tool-metadata"><strong>{selectedTool?.description ?? "Choose a server to discover its configured tools."}</strong><span>{selectedTool?.requiredInputs.length ? `Required inputs: ${selectedTool.requiredInputs.filter((input) => input.required).map((input) => input.name).join(", ")}` : "Enter the discovered tool arguments below."}</span></section>
                <label>Request parameters<textarea rows={5} value={parameters} onChange={(event) => setParameters(event.target.value)} placeholder="applicationMessageId: 861822" /></label>
                <Button design="Emphasized" disabled={!selectedServerId || !toolName} onClick={() => void test()}>Validate &amp; send request</Button>
              </section>
              <section className="mcp-response">
                <header>
                  <div><h3>Response</h3><span>{responseStatus ?? "Waiting for a test"}</span></div>
                  <div role="tablist" aria-label="Response view">{(["formatted", "raw", "tree"] as const).map((view) => <button key={view} type="button" role="tab" className={responseView === view ? "active" : ""} aria-selected={responseView === view} onClick={() => setResponseView(view)}>{view}</button>)}</div>
                </header>
                {response ? (
                  responseView === "tree" ? (
                    parsedResponse === undefined ? <p>The response is not JSON, so a field tree is unavailable.</p> : <div className="response-tree-panel"><JsonTree value={parsedResponse} path="$" onSelect={setField} /></div>
                  ) : <pre className="response-payload">{responseView === "formatted" ? formattedResponse : response}</pre>
                ) : <p>A successful backend test response is required before you can select a field or save an identifier type.</p>}
                <label>Select response field<input value={field} disabled={!response} onChange={(event) => setField(event.target.value)} placeholder="Select a value in the response tree" /></label>
                <dl><div><dt>Extraction path</dt><dd>{field || "—"}</dd></div><div><dt>Returned value</dt><dd>{field ? "Selected from response" : "—"}</dd></div></dl>
              </section>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
