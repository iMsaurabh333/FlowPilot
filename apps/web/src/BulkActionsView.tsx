import { useEffect, useMemo, useState } from "react";
import { Button } from "@ui5/webcomponents-react/Button";
import type { FlowPilotApi } from "./api";

type Action = "deploy" | "undeploy" | "none";
type RunState = "ready" | "running" | "completed" | "failed";
type Parameter = { key: string; value: string; dataType: string };
type Artifact = { id: string; version: string; name: string; packageName: string; action: Action; configure: boolean; expanded: boolean; parameters: Parameter[]; state: RunState };
type SavedJob = { id: string; name: string; savedAt: string; scheduledFor?: string | null; artifacts: Artifact[] };
type LiveFlow = { id: string; name: string; version: string };
type LivePackage = { id: string; name: string; flows: LiveFlow[] };

const demoPackages = [
  { id: "order", name: "Order Management", flows: [{ id: "order-intake", name: "Order Intake", version: "active" }, { id: "order-confirmation", name: "Order Confirmation", version: "active" }, { id: "order-fulfilment", name: "Order Fulfilment", version: "active" }] },
  { id: "customer", name: "Customer Integration", flows: [{ id: "customer-master-sync", name: "Customer Master Sync", version: "active" }, { id: "business-partner-replication", name: "Business Partner Replication", version: "active" }] },
  { id: "finance", name: "Finance Operations", flows: [{ id: "invoice-posting", name: "Invoice Posting", version: "active" }, { id: "payment-advice", name: "Payment Advice", version: "active" }] },
] satisfies LivePackage[];
const storageKey = "flowpilot-bulk-action-jobs";

function makeArtifacts(packageIds: string[], packages: LivePackage[] = demoPackages) {
  return packages.filter((item) => packageIds.includes(item.id)).flatMap((item) => item.flows.map((flow) => ({
    id: flow.id, version: flow.version, name: flow.name, packageName: item.name, action: "none" as Action, configure: false, expanded: false, state: "ready" as RunState,
    parameters: [],
  })));
}

function loadJobs(): SavedJob[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as SavedJob[]; } catch { return []; }
}

export function BulkActionsView({ client }: { client: FlowPilotApi }) {
  const [livePackages, setLivePackages] = useState<LivePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [mode, setMode] = useState<"jobs" | "wizard" | "review">("jobs");
  const [step, setStep] = useState(1);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [jobName, setJobName] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [activeJob, setActiveJob] = useState<SavedJob>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => { if (client.listBulkJobs) void client.listBulkJobs().then((items) => setJobs(items.map((item) => ({ id: item.id, name: item.title, savedAt: item.createdAt, scheduledFor: item.scheduledFor, artifacts: item.artifacts as Artifact[] })))).catch(() => setJobs(loadJobs())); else setJobs(loadJobs()); if (!client.listBulkPackages) { setPackagesLoading(false); setNotice("Bulk Actions is unavailable because the application API does not expose the CPI Content connection."); return; } void client.listBulkPackages().then((payload) => { const root = payload as { d?: { results?: Array<{ Id?: string; Name?: string }> } }; const items = root.d?.results?.map((item) => ({ id: item.Id ?? "", name: item.Name ?? item.Id ?? "", flows: [] as LiveFlow[] })).filter((item) => item.id) ?? []; setLivePackages(items); if (!items.length) setNotice("CPI returned no packages that this technical user can access."); }).catch(() => setNotice("Live CPI packages could not be loaded. Check the Content MCP registration and Content API destination.")).finally(() => setPackagesLoading(false)); }, [client]);
  const persist = (next: SavedJob[]) => { setJobs(next); localStorage.setItem(storageKey, JSON.stringify(next)); };
  const selectedCount = artifacts.filter((item) => item.action !== "none").length;
  const selectedPackageFlows = useMemo(() => makeArtifacts(selectedPackages, livePackages), [selectedPackages, livePackages]);
  const updateArtifact = (id: string, change: Partial<Artifact>) => setArtifacts((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  const bulkSet = (action: Action) => setArtifacts((current) => current.map((item) => ({ ...item, action })));
  const toggleConfigure = async (item: Artifact, enabled: boolean) => {
    if (!enabled) { updateArtifact(item.id, { configure: false, expanded: false }); return; }
    try {
      const payload = await client.getBulkFlowConfigurations?.(item.id, item.version);
      const rows = (payload as { d?: { results?: Array<{ ParameterKey?: string; ParameterValue?: string; DataType?: string }> } })?.d?.results ?? [];
      updateArtifact(item.id, { configure: true, expanded: true, parameters: rows.flatMap((row) => row.ParameterKey ? [{ key: row.ParameterKey, value: row.ParameterValue ?? "", dataType: row.DataType ?? "xsd:string" }] : []) });
      if (!rows.length) setNotice(`CPI returned no externalized parameters for ${item.name}.`);
    } catch { setNotice(`External parameters for ${item.name} could not be loaded from CPI.`); }
  };
  const saveJob = () => {
    if (!jobName.trim() || selectedCount === 0) { setNotice("Give the job a name and choose Deploy or Undeploy for at least one artifact."); return; }
    if (scheduledFor && new Date(scheduledFor).getTime() < Date.now() + 10 * 60_000) { setNotice("Scheduled jobs must be at least 10 minutes from now."); return; }
    const local: SavedJob = { id: crypto.randomUUID(), name: jobName.trim(), savedAt: new Date().toISOString(), scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null, artifacts };
    if (client.createBulkJob) { void client.createBulkJob({ title: local.name, artifacts: local.artifacts, scheduledFor: local.scheduledFor }).then((created) => { const saved = { id: created.id, name: created.title, savedAt: created.createdAt, scheduledFor: created.scheduledFor, artifacts: created.artifacts as Artifact[] }; setJobs((items) => [saved, ...items]); setActiveJob(saved); setMode("jobs"); setNotice(`Saved ${saved.name}.`); }).catch(() => setNotice("The bulk job could not be saved. Scheduled jobs must be at least 10 minutes from now.")); return; }
    persist([local, ...jobs]); setActiveJob(local); setMode("jobs"); setNotice(`Saved ${local.name}.`);
  };
  const run = async (job: SavedJob, onlyId?: string) => {
    const target = onlyId ? job.artifacts.filter((item) => item.id === onlyId) : job.artifacts.filter((item) => item.action !== "none");
    let updated = { ...job, artifacts: job.artifacts.map((item) => target.some((targetItem) => targetItem.id === item.id) ? { ...item, state: "ready" as RunState } : item) };
    setActiveJob(updated);
    for (const targetItem of target) {
      updated = { ...updated, artifacts: updated.artifacts.map((item) => item.id === targetItem.id ? { ...item, state: "running" as RunState } : item) };
      setActiveJob(updated);
      try { if (targetItem.configure && targetItem.parameters.length) await client.updateBulkFlowConfigurations?.(targetItem.id, targetItem.version, Object.fromEntries(targetItem.parameters.map((parameter) => [parameter.key, { value: parameter.value, dataType: parameter.dataType }]))); if (targetItem.action === "deploy") await client.deployBulkFlow?.(targetItem.id, targetItem.version); else await client.undeployBulkFlow?.(targetItem.id); updated = { ...updated, artifacts: updated.artifacts.map((item) => item.id === targetItem.id ? { ...item, state: "completed" as RunState } : item) }; } catch { updated = { ...updated, artifacts: updated.artifacts.map((item) => item.id === targetItem.id ? { ...item, state: "failed" as RunState } : item) }; }
      setActiveJob(updated);
    }
    persist(jobs.map((item) => item.id === updated.id ? updated : item));
  };
  const newJob = () => { setMode("wizard"); setStep(1); setSelectedPackages([]); setArtifacts([]); setJobName(""); setScheduledFor(""); setNotice(undefined); };

  if (mode === "wizard") return <main className="bulk-page" aria-labelledby="bulk-title">
    <header className="bulk-header"><div><p className="section-label">Integration Content</p><h1 id="bulk-title">Create bulk action job</h1><p>Choose packages and integration flows, then configure the actions to run in sequence.</p></div><Button design="Transparent" onClick={() => setMode("jobs")}>Cancel</Button></header>
    <ol className="bulk-steps" aria-label="Bulk action wizard"><li className={step === 1 ? "current" : "complete"}>1. Packages</li><li className={step === 2 ? "current" : ""}>2. Integration flows</li><li>3. Actions</li></ol>
    {step === 1 && <section className="bulk-card"><h2>Fetch packages</h2><p>Select the packages whose integration flows you want to include.</p>{packagesLoading ? <p role="status">Loading packages from CPIÃ¢â‚¬Â¦</p> : livePackages.length === 0 ? <p>No live packages are available.</p> : <div className="bulk-choice-list">{livePackages.map((item) => <label key={item.id}><input type="checkbox" checked={selectedPackages.includes(item.id)} onChange={(event) => setSelectedPackages((items) => event.target.checked ? [...items, item.id] : items.filter((id) => id !== item.id))} /><span><strong>{item.name}</strong><small>Live CPI package</small></span></label>)}</div>}<div className="bulk-actions"><Button design="Emphasized" disabled={!selectedPackages.length || packagesLoading} onClick={() => { if (!client.listBulkPackageFlows) { setNotice("The application API does not expose CPI flow discovery."); return; } void Promise.all(selectedPackages.map(async (packageId) => { const payload = await client.listBulkPackageFlows!(packageId); const result = (payload as { d?: { results?: Array<{ Id?: string; Name?: string; Version?: string }> } })?.d?.results ?? []; return [packageId, result.flatMap((flow) => flow.Id ? [{ id: flow.Id, name: flow.Name ?? flow.Id, version: flow.Version ?? "active" }] : [])] as const; })).then((loaded) => { const flows = new Map(loaded); const next = livePackages.map((item) => flows.has(item.id) ? { ...item, flows: flows.get(item.id)! } : item); const nextArtifacts = makeArtifacts(selectedPackages, next); if (!nextArtifacts.length) { setNotice("CPI returned no integration flows in the selected packages."); return; } setLivePackages(next); setArtifacts(nextArtifacts); setStep(2); }).catch(() => setNotice("Flows could not be loaded from CPI. Check the Content MCP tools and destination.")); }}>Continue</Button></div></section>}
    {step === 2 && <section className="bulk-card"><h2>Select integration flows</h2><p>Only selected flows will be shown in the action table.</p><div className="bulk-choice-list">{artifacts.map((item) => <label key={item.id}><input type="checkbox" checked={!item.id.startsWith("excluded-")} onChange={(event) => updateArtifact(item.id, { id: event.target.checked ? item.id.replace("excluded-", "") : `excluded-${item.id}` })} /><span><strong>{item.name}</strong><small>{item.packageName}</small></span></label>)}</div><div className="bulk-actions"><Button design="Transparent" onClick={() => setStep(1)}>Back</Button><Button design="Emphasized" onClick={() => { setArtifacts((items) => items.filter((item) => !item.id.startsWith("excluded-"))); setMode("review"); }}>Configure actions</Button></div></section>}
  </main>;

  if (mode === "review") return <main className="bulk-page" aria-labelledby="bulk-title">
    <header className="bulk-header"><div><p className="section-label">Bulk action job</p><h1 id="bulk-title">Configure artifact actions</h1><p>Configuration is applied before the deploy or undeploy action.</p></div></header>
    {notice && <p className="bulk-notice" role="alert">{notice}</p>}
    <section className="bulk-card bulk-review"><div className="bulk-table-toolbar"><strong>{artifacts.length} selected artifacts</strong><div><button type="button" onClick={() => bulkSet("deploy")}>Deploy all</button><button type="button" onClick={() => bulkSet("undeploy")}>Undeploy all</button><button type="button" onClick={() => bulkSet("none")}>Clear all</button></div></div><div className="bulk-table-wrap"><table><thead><tr><th>Integration flow</th><th>Action</th><th>Configure external parameters</th><th>Status</th></tr></thead><tbody>{artifacts.map((item) => <><tr key={item.id}><td><strong>{item.name}</strong><small>{item.packageName}</small></td><td><select aria-label={`Action for ${item.name}`} value={item.action} onChange={(event) => updateArtifact(item.id, { action: event.target.value as Action })}><option value="none">No action</option><option value="deploy">Deploy</option><option value="undeploy">Undeploy</option></select></td><td><label className="bulk-configure"><input type="checkbox" checked={item.configure} onChange={(event) => void toggleConfigure(item, event.target.checked)} />Configure</label></td><td><span className={`bulk-status ${item.state}`}>{item.state === "ready" ? "Ready" : item.state}</span></td></tr>{item.configure && item.expanded && <tr className="bulk-parameter-row" key={`${item.id}-parameters`}><td colSpan={4}><div><strong>External parameters for {item.name}</strong>{item.parameters.map((parameter, index) => <label key={parameter.key}>{parameter.key}<input value={parameter.value} onChange={(event) => setArtifacts((items) => items.map((current) => current.id !== item.id ? current : { ...current, parameters: current.parameters.map((value, position) => position === index ? { ...value, value: event.target.value } : value) }))} /></label>)}</div></td></tr>}</>)}</tbody></table></div><div className="bulk-save"><label>Job name<input value={jobName} maxLength={120} placeholder="September release deployment" onChange={(event) => setJobName(event.target.value)} /></label><label>Schedule (optional)<input type="datetime-local" min={new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16)} value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /><small>Schedule at least 10 minutes from now. Leave empty to use Run job.</small></label><Button design="Transparent" onClick={() => setMode("wizard")}>Back</Button><Button design="Emphasized" onClick={saveJob}>Save job</Button></div></section>
  </main>;

  return <main className="bulk-page" aria-labelledby="bulk-title"><header className="bulk-header"><div><p className="section-label">Integration Content</p><h1 id="bulk-title">Bulk actions</h1><p>Saved deploy, undeploy, and external-parameter jobs.</p></div><Button design="Emphasized" icon="add" onClick={newJob}>New bulk action job</Button></header>{notice && <p className="bulk-notice" role="status">{notice}</p>}<section className="bulk-jobs">{jobs.length === 0 ? <div className="bulk-empty"><h2>No bulk action jobs yet</h2><p>Start a job to select packages, choose integration flows, and plan their actions.</p><Button design="Emphasized" onClick={newJob}>Start a bulk action job</Button></div> : <><aside><h2>Saved jobs</h2>{jobs.map((job) => <button type="button" className={activeJob?.id === job.id ? "bulk-job selected" : "bulk-job"} key={job.id} onClick={() => setActiveJob(job)}><strong>{job.name}</strong><small>{job.artifacts.filter((item) => item.action !== "none").length} actions Ã‚Â· saved {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(job.savedAt))}</small></button>)}</aside>{activeJob && <section className="bulk-job-detail"><header><div><p className="section-label">Saved job</p><h2>{activeJob.name}</h2></div><Button design="Emphasized" icon="media-play" onClick={() => void run(activeJob)}>Run job</Button></header><table><thead><tr><th>Integration flow</th><th>Action</th><th>Parameters</th><th>Result</th><th /></tr></thead><tbody>{activeJob.artifacts.filter((item) => item.action !== "none").map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.packageName}</small></td><td>{item.action}</td><td>{item.configure ? "Configured" : "Ã¢â‚¬â€"}</td><td><span className={`bulk-status ${item.state}`}>{item.state}</span></td><td><button type="button" disabled={item.state === "running"} onClick={() => void run(activeJob, item.id)}>Run again</button></td></tr>)}</tbody></table></section>}</>}</section></main>;
}
