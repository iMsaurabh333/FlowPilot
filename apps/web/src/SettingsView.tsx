import { useState } from "react";
import type { FlowPilotApi } from "./api";
import { LogsView } from "./LogsView";
import { McpRegistryView } from "./McpRegistryView";

export function SettingsView({ client }: { client: FlowPilotApi }) {
  const [tab, setTab] = useState<"mcp" | "logs">("mcp");
  return (
    <div className="settings-page">
      <header className="settings-header">
        <p className="section-label">ADMINISTRATION</p>
        <h1>Settings</h1>
        <p>Manage secure MCP connections and review operational diagnostics.</p>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button type="button" role="tab" aria-selected={tab === "mcp"} className={tab === "mcp" ? "active" : ""} onClick={() => setTab("mcp")}>MCP servers</button>
        <button type="button" role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>Logs</button>
      </div>
      <div role="tabpanel" className="settings-panel">
        {tab === "mcp" ? <McpRegistryView client={client} /> : <LogsView client={client} />}
      </div>
    </div>
  );
}
