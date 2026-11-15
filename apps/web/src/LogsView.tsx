import { useEffect, useState } from "react";
import type { FlowPilotApi, OperationLogEntry } from "./api";

export function LogsView({ client }: { client: FlowPilotApi }) {
  const [logs, setLogs] = useState<OperationLogEntry[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => { if (!client.listOperationLogs) { setError("Operational logs are unavailable in this environment."); return; } void client.listOperationLogs().then(setLogs).catch(() => setError("Operational logs could not be loaded.")); }, [client]);
  return <main className="logs-page" aria-labelledby="logs-title"><header><p className="section-label">Diagnostics</p><h1 id="logs-title">Logs</h1><p>Recent model, MCP, and service failures. Request and response bodies are bounded; credentials are never recorded.</p></header>{error && <p className="report-error" role="alert">{error}</p>}<ol className="operation-log-list">{logs.length === 0 ? <li className="reports-empty">No diagnostic events have been retained yet.</li> : logs.map((entry) => <li key={entry.id}><header><strong>{entry.title}</strong><span className={`operation-log-kind ${entry.eventType}`}>{entry.eventType.replace("_", " ")}</span></header><p>{entry.surface === "report" ? "Reports" : entry.surface === "chat" ? "Chat" : "System"} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(entry.createdAt))}{entry.reportJobId ? ` · Report ${entry.reportJobId}` : ""}</p><details><summary>Execution detail</summary><pre>{JSON.stringify(entry.detail, null, 2)}</pre></details></li>)}</ol></main>;
}
