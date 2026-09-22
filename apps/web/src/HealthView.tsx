import { useState } from "react";
import type { FlowPilotApi, IntegrationHealthSummary } from "./api";
import { IntegrationHealth } from "./IntegrationHealth";

const windows: Array<[string, IntegrationHealthSummary["window"]]> = [
  ["Last Hour", "last_completed_hour"],
  ["24 Hours", "last_24_hours"],
  ["Today", "today"],
  ["Yesterday", "yesterday"],
];

export function HealthView({ client }: { client: FlowPilotApi }) {
  const [window, setWindow] = useState<IntegrationHealthSummary["window"]>("last_completed_hour");
  const [detailTab, setDetailTab] = useState<"diagnostics" | "performance">("diagnostics");
  const run = (nextWindow: IntegrationHealthSummary["window"]) => setWindow(nextWindow);
  return <main className="health-page" aria-labelledby="health-page-title">
    <div className="health-page-header">
      <header className="reports-header">
        <div><p className="section-label">OPERATIONS</p><h1 id="health-page-title">Health</h1><p>CPI integration health and deterministic diagnostics.</p></div>
        <div className="health-window-buttons" role="group" aria-label="Health reporting window">
          {windows.map(([label, value]) => <button key={value} type="button" className={window === value ? "active" : ""} aria-pressed={window === value} onClick={() => run(value)}>{label}</button>)}
        </div>
      </header>
      <div className="health-detail-tabs" role="tablist" aria-label="Health detail">
        <button type="button" role="tab" aria-selected={detailTab === "diagnostics"} className={detailTab === "diagnostics" ? "active" : ""} onClick={() => setDetailTab("diagnostics")}>Diagnostics</button>
        <button type="button" role="tab" aria-selected={detailTab === "performance"} className={detailTab === "performance" ? "active" : ""} onClick={() => setDetailTab("performance")}>Processing time</button>
      </div>
    </div>
    <IntegrationHealth client={client} window={window} detailTab={detailTab} />
  </main>;
}
