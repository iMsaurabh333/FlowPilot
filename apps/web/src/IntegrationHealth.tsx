import { useCallback, useEffect, useState } from "react";
import { ApiError, type FlowPilotApi, type IntegrationHealthSummary } from "./api";
import { DEFAULT_HEALTH_REFRESH_MINUTES, getHealthRefreshMinutes, HEALTH_SETTINGS_CHANGED } from "./integration-health-settings";

function percent(value: number) { return `${value.toFixed(1)}%`; }
function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function duration(value: number | null) {
  if (value === null) return "No timing data";
  return value >= 60_000 ? `${(value / 60_000).toFixed(1)} min` : `${(value / 1_000).toFixed(1)} sec`;
}

export function IntegrationHealth({ client, compact = false, window = "last_completed_hour", reloadKey = 0, showTrend = !compact, detailTab = "diagnostics" }: {
  client: FlowPilotApi;
  compact?: boolean;
  window?: IntegrationHealthSummary["window"];
  reloadKey?: number;
  showTrend?: boolean;
  detailTab?: "diagnostics" | "performance";
}) {
  const [health, setHealth] = useState<IntegrationHealthSummary>();
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState<string>();
  const [refreshMinutes, setRefreshMinutes] = useState(DEFAULT_HEALTH_REFRESH_MINUTES);
  const [selectedFlowId, setSelectedFlowId] = useState<string>();
  const [flowPage, setFlowPage] = useState(0);
  const [messageQuery, setMessageQuery] = useState("");
  const [messageSort, setMessageSort] = useState<"latest" | "failed" | "id">("latest");

  const load = useCallback(async () => {
    if (!client.getIntegrationHealth) return;
    try { setHealth(await client.getIntegrationHealth(window)); setUnavailable(false); }
    catch { setUnavailable(true); }
    finally { setLoading(false); }
  }, [client, window]);
  useEffect(() => { setLoading(true); void load(); }, [load, reloadKey]);
  useEffect(() => {
    const update = () => setRefreshMinutes(getHealthRefreshMinutes());
    update();
    globalThis.window.addEventListener(HEALTH_SETTINGS_CHANGED, update);
    return () => globalThis.window.removeEventListener(HEALTH_SETTINGS_CHANGED, update);
  }, []);
  const collect = useCallback(async (manual = false) => {
    if (!client.collectIntegrationHealth) return;
    setCollecting(true);
    try {
      const result = await client.collectIntegrationHealth();
      if (manual) setCollectionMessage(result.flows ? `Updated ${result.flows} flow${result.flows === 1 ? "" : "s"} from CPI.` : "CPI returned no messages for the last completed UTC hour.");
      await load();
    } catch (error) {
      if (manual) setCollectionMessage(error instanceof ApiError ? `CPI collection failed: ${error.code.replace(/^integration_health_source_/u, "").replaceAll("_", " ")}.` : "CPI collection failed. Check the Cloud Integration MCP server connection, destination, and health status, then try again.");
    } finally { setCollecting(false); }
  }, [client, load]);
  useEffect(() => {
    void collect();
    const timer = globalThis.window.setInterval(() => void collect(), refreshMinutes * 60_000);
    return () => globalThis.window.clearInterval(timer);
  }, [collect, refreshMinutes]);
  useEffect(() => {
    if (!health) return;
    setSelectedFlowId((current) => health.flows.some((flow) => flow.flowId === current) ? current : health.flows[0]?.flowId);
    setFlowPage((page) => Math.min(page, Math.max(0, Math.ceil(health.flows.length / 10) - 1)));
  }, [health]);

  if (loading) return <section className="integration-health" aria-label="Integration Health"><p>Loading integration health...</p></section>;
  if (!health) return <section className="integration-health" aria-label="Integration Health"><h2>Integration Health</h2><p>{unavailable ? "Integration Health is unavailable for this account." : "No health snapshot is available yet."}</p></section>;

  const totalFlowPages = Math.max(1, Math.ceil(health.flows.length / 10));
  const visibleFlows = compact ? health.flows.slice(0, 2) : health.flows.slice(flowPage * 10, flowPage * 10 + 10);
  const selectedFlow = health.flows.find((flow) => flow.flowId === selectedFlowId);
  const failedMessages = (selectedFlow?.businessMessages ?? [])
    .filter((message) => message.applicationMessageId && message.failed > 0 && message.applicationMessageId.toLowerCase().includes(messageQuery.trim().toLowerCase()));
  const slowestFlows = [...health.flows].filter((flow) => flow.averageProcessingMilliseconds !== null).sort((left, right) => (right.averageProcessingMilliseconds ?? 0) - (left.averageProcessingMilliseconds ?? 0)).slice(0, 5);
  const groupedFailedMessages = [...failedMessages.reduce((groups, message) => {
    const error = message.latestError?.trim() || "CPI did not provide error details for this failure.";
    const group = groups.get(error) ?? { ids: [] as string[], types: [] as string[], lastFailureAt: message.lastFailureAt, failed: 0, error };
    if (message.applicationMessageId) group.ids.push(message.applicationMessageId);
    if (message.applicationMessageType) group.types.push(message.applicationMessageType);
    if ((message.lastFailureAt ?? "") > (group.lastFailureAt ?? "")) group.lastFailureAt = message.lastFailureAt;
    group.failed += message.failed;
    groups.set(error, group);
    return groups;
  }, new Map<string, { ids: string[]; types: string[]; lastFailureAt: string | null; failed: number; error: string }>()).values()].sort((left, right) => {
    if (messageSort === "failed") return right.failed - left.failed || new Date(right.lastFailureAt ?? 0).getTime() - new Date(left.lastFailureAt ?? 0).getTime();
    if (messageSort === "id") return (left.ids[0] ?? "").localeCompare(right.ids[0] ?? "");
    return new Date(right.lastFailureAt ?? 0).getTime() - new Date(left.lastFailureAt ?? 0).getTime();
  });

  return <section className={`integration-health${compact ? " compact" : ""}${!compact ? ` health-detail-${detailTab}` : ""}`} aria-labelledby="integration-health-title">
    <header><div><p className="section-label">INTEGRATION HEALTH</p><h2 id="integration-health-title">{health.failed ? "Attention" : "Healthy"} · {window.replaceAll("_", " ")}</h2></div><div className="health-header-actions">{health.partial && <span className="health-partial">Partial collection</span>}{!compact && <button type="button" className="health-manual-run" disabled={collecting} onClick={() => void collect(true)} title="Refresh CPI health now" aria-label="Refresh CPI health now">↻</button>}</div></header>
    <div className="health-metrics"><span><strong>{health.processed.toLocaleString()}</strong> processed</span><span><strong>{health.failed.toLocaleString()}</strong> failed</span><span><strong>{percent(health.failureRate)}</strong> failure rate</span>{health.changePoints !== null && <span>{health.changePoints >= 0 ? "↑" : "↓"} {Math.abs(health.changePoints).toFixed(1)} points vs prior hour</span>}</div>
    {showTrend && <div className="health-trend" aria-label="24-hour failure-rate trend">{health.trend.map((value, index) => <i key={index} title={percent(value)} style={{ height: `${Math.max(8, Math.min(100, value * 8))}%` }} />)}</div>}
    {health.flows.length ? <ol className="health-flows">{visibleFlows.map((flow) => <li key={flow.flowId} className={!compact && flow.flowId === selectedFlowId ? "selected" : ""}>{!compact && <button type="button" className="health-flow-select" onClick={() => setSelectedFlowId(flow.flowId)} aria-pressed={flow.flowId === selectedFlowId} aria-label={`Show failed messages for ${flow.flowName}`} />}<div><strong>{flow.flowName}</strong><span>{flow.intermittent ? "Intermittent" : flow.recurring ? "Recurring" : "Failure"} · {percent(flow.failureRate)} failed</span></div><small>{flow.businessMessages.some((message) => message.applicationMessageId) ? `${flow.businessMessages.filter((message) => message.applicationMessageId).length} application IDs implicated` : "Business message identifier/type not supplied by this iFlow"}</small>{!compact && (flow.representativeError || flow.businessMessages.find((message) => message.latestError)?.latestError) && <details><summary>Error details</summary><p>{flow.representativeError ?? flow.businessMessages.find((message) => message.latestError)?.latestError}</p></details>}</li>)}</ol> : <p className="health-empty">No terminal failures in the collected data.</p>}
    {!compact && health.flows.length > 10 && <nav className="health-flow-pagination" aria-label="Integration flow pages"><button type="button" disabled={flowPage === 0} onClick={() => setFlowPage((page) => page - 1)}>Previous</button><span>Page {flowPage + 1} of {totalFlowPages}</span><button type="button" disabled={flowPage + 1 >= totalFlowPages} onClick={() => setFlowPage((page) => page + 1)}>Next</button></nav>}
    {!compact && <p className="health-refresh-note">Auto-refreshes every {refreshMinutes} minutes. Use ↻ to refresh now.</p>}
    {!compact && <section className="health-message-table" aria-labelledby="failed-message-title"><div><div><h3 id="failed-message-title">Failed application messages</h3><span>{selectedFlow ? selectedFlow.flowName : "Select an integration flow"} · Grouped by error description</span></div><div className="health-message-controls"><input type="search" value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} placeholder="Search Application Message ID" aria-label="Search Application Message ID" /><label>Sort <select value={messageSort} onChange={(event) => setMessageSort(event.target.value as typeof messageSort)}><option value="latest">Latest failure</option><option value="failed">Most failures</option><option value="id">Message ID</option></select></label></div></div><div className="health-message-table-scroll"><table><thead><tr><th>Application Message IDs</th><th>Type</th><th>Last failure</th><th>Failed</th><th>Latest error</th></tr></thead><tbody>{groupedFailedMessages.length ? groupedFailedMessages.map((group, index) => <tr key={`${selectedFlow?.flowId}-${index}`}><td>{group.ids.join(", ")}</td><td>{[...new Set(group.types)].join(", ") || "—"}</td><td>{dateTime(group.lastFailureAt)}</td><td>{group.failed.toLocaleString()}</td><td>{group.error}</td></tr>) : <tr><td colSpan={5}>No failed application messages match this flow and search.</td></tr>}</tbody></table></div></section>}
    {!compact && detailTab === "performance" && slowestFlows.length > 0 && <section className="health-performance" aria-labelledby="health-performance-title"><div><h3 id="health-performance-title">Highest average processing time</h3><span>Completed and failed messages with timing data</span></div><ol>{slowestFlows.map((flow) => <li key={flow.flowId}><strong>{flow.flowName}</strong><span>{duration(flow.averageProcessingMilliseconds)}</span></li>)}</ol></section>}
    {collectionMessage && !compact && <p className="health-collection-message" role="status">{collectionMessage}</p>}
  </section>;
}
