import { useEffect, useState } from "react";
import type { FlowPilotApi } from "./api";
import { LogsView } from "./LogsView";
import { McpRegistryView } from "./McpRegistryView";
import { getHealthRefreshMinutes, setHealthRefreshMinutes } from "./integration-health-settings";

export function SettingsView({ client }: { client: FlowPilotApi }) {
  const [tab, setTab] = useState<"mcp" | "health" | "logs">("mcp");
  const [refreshMinutes, setRefreshMinutes] = useState(getHealthRefreshMinutes);
  const [retentionDays, setRetentionDays] = useState(30);
  const [retentionMessage, setRetentionMessage] = useState<string>();
  useEffect(() => {
    if (!client.getIntegrationHealthSettings) return;
    void client.getIntegrationHealthSettings().then(({ retentionDays: days }) => setRetentionDays(days)).catch(() => setRetentionMessage("CPI retention settings are unavailable."));
  }, [client]);
  const updateRefreshMinutes = (value: number) => {
    setRefreshMinutes(value);
    setHealthRefreshMinutes(value);
  };
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <header className="settings-header">
          <p className="section-label">ADMINISTRATION</p>
          <h1>Settings</h1>
          <p>Manage secure MCP connections and review operational diagnostics.</p>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button type="button" role="tab" aria-selected={tab === "mcp"} className={tab === "mcp" ? "active" : ""} onClick={() => setTab("mcp")}>MCP servers</button>
          <button type="button" role="tab" aria-selected={tab === "health"} className={tab === "health" ? "active" : ""} onClick={() => setTab("health")}>Health refresh</button>
          <button type="button" role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>Logs</button>
        </div>
      </div>
      <div role="tabpanel" className="settings-panel">
        {tab === "mcp" ? <McpRegistryView client={client} /> : tab === "logs" ? <LogsView client={client} /> : <section className="health-settings-card"><p className="section-label">INTEGRATION HEALTH</p><h2>Automatic refresh</h2><p>Collect a bounded completed-hour CPI snapshot when Health or Home opens, then refresh it at this interval.</p><label htmlFor="health-refresh-minutes">Refresh interval</label><select id="health-refresh-minutes" value={refreshMinutes} onChange={(event) => updateRefreshMinutes(Number(event.target.value))}>{[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>Every {minutes} minutes</option>)}</select><small>This preference is stored in this browser. Manual refresh never retrieves more than the completed hour.</small><hr /><h2>CPI monitoring retention</h2><p>Keep completed CPI monitoring snapshots for this tenant only as long as operational review requires.</p><label htmlFor="health-retention-days">Retention period</label><select id="health-retention-days" value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))}>{[7, 14, 30, 60, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}</select><button type="button" className="health-settings-save" disabled={!client.updateIntegrationHealthSettings} onClick={() => void client.updateIntegrationHealthSettings?.({ retentionDays }).then(() => setRetentionMessage("Retention period saved. Older snapshots are removed during the next collection.")).catch(() => setRetentionMessage("Retention period could not be saved."))}>Save retention</button>{retentionMessage && <p className="health-settings-message" role="status">{retentionMessage}</p>}</section>}
      </div>
    </div>
  );
}
