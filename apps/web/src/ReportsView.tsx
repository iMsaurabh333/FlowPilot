import { Button } from "@ui5/webcomponents-react/Button";
import { TextArea } from "@ui5/webcomponents-react/TextArea";
import "@ui5/webcomponents-icons/dist/AllIcons.js";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { ApiError, type ApprovedPlanExecutionResult, type FlowPilotApi, type ReportActionPlanPreview, type ReportExportFormat, type ReportJobRun, type ReportJobStatus, type ReportJobSummary, type ReportSource } from "./api";

const defaultPrompt = `Objective:\nState the operational question, period, and final outcome this report must answer.\n\nApproved sources:\n- Use only the selected read-only MCP tools. Explain any unavailable evidence as an unresolved limitation.\n- Never expose credentials, internal retries, or transient errors that later resolved.\n\nRequired fields:\n- Scope and filters used\n- Final status and relevant identifiers\n- Counts, timestamps, and final outcomes where available\n- Unresolved exceptions and a recommended next action\n\nPresentation:\nProduce concise HTML with an executive summary, a status table, and a details section. Do not describe tool-call attempts.`;

function statusLabel(status: ReportJobStatus) {
  return status === "succeeded" ? "Completed" : status === "attention" ? "Attention needed" : status[0].toUpperCase() + status.slice(1);
}

function visibleStatus(job: ReportJobSummary) {
  return job.status === "scheduled" && job.lastRunStatus ? job.lastRunStatus : job.status;
}

function marker(scheduledFor: string, status: ReportJobStatus) {
  if (status !== "scheduled") return undefined;
  const minutes = (Date.parse(scheduledFor) - Date.now()) / 60_000;
  if (minutes >= 0 && minutes <= 5) return "red";
  if (minutes > 5 && minutes <= 30) return "orange";
  if (minutes > 30 && minutes <= 60) return "yellow";
  return undefined;
}

function localDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

type Recurrence = "once" | "hourly" | "daily" | "weekly";

function recurrenceRule(recurrence: Recurrence, scheduledFor: string) {
  if (recurrence === "once") return null;
  const date = new Date(scheduledFor);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  if (recurrence === "hourly") return `0 ${minute} * * * ?`;
  if (recurrence === "daily") return `0 ${minute} ${hour} * * ?`;
  return `0 ${minute} ${hour} ? * ${date.getUTCDay() + 1}`;
}

export function ReportsView({ client }: { client: FlowPilotApi }) {
  const [jobs, setJobs] = useState<ReportJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [showCreate, setShowCreate] = useState(false);
  const [actionPlanForJob, setActionPlanForJob] = useState<ReportActionPlanPreview>();
  const [title, setTitle] = useState("");
  const [scheduledFor, setScheduledFor] = useState(() => localDateTime(new Date(Date.now() + 60 * 60_000)));
  const [recurrence, setRecurrence] = useState<Recurrence>("once");
  const [reportPrompt, setReportPrompt] = useState(defaultPrompt);
  const [reportSources, setReportSources] = useState<ReportSource[]>([]);
  const [sourceToolNames, setSourceToolNames] = useState<string[]>([]);
  const [selectedJob, setSelectedJob] = useState<ReportJobSummary>();
  const [runConfirmation, setRunConfirmation] = useState<ReportJobSummary>();
  const [running, setRunning] = useState(false);
  const [planPreview, setPlanPreview] = useState<ReportActionPlanPreview>();
  const [planning, setPlanning] = useState(false);
  const [editablePlan, setEditablePlan] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [regeneratingPlan, setRegeneratingPlan] = useState(false);
  const [approvalConfirmation, setApprovalConfirmation] = useState<ReportActionPlanPreview>();
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [executionConfirmation, setExecutionConfirmation] = useState<ReportActionPlanPreview>();
  const [executingPlan, setExecutingPlan] = useState(false);
  const [planExecution, setPlanExecution] = useState<ApprovedPlanExecutionResult>();
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>("html");
  const [downloading, setDownloading] = useState(false);
  const [jobRuns, setJobRuns] = useState<ReportJobRun[]>([]);
  const [scheduleUpdating, setScheduleUpdating] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<ReportJobSummary>();
  const [deletingJob, setDeletingJob] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!client.listReportJobs) {
      setError("Reports are unavailable in this environment.");
      setLoading(false);
      return;
    }
    try {
      setJobs(await client.listReportJobs());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "reports_unavailable" ? "Reports are unavailable in this environment." : "Report jobs could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!showCreate || !client.listReportSources) return; void client.listReportSources().then(setReportSources).catch(() => setError("Available report sources could not be loaded.")); }, [showCreate, client]);

  const nextJob = useMemo(() => jobs.find((job) => job.status === "scheduled" || job.status === "running"), [jobs]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!client.createReportJob) return;
    setSaving(true);
    try {
      const created = await client.createReportJob({ title: title.trim(), reportPrompt: reportPrompt.trim(), sourceToolNames, scheduledFor: new Date(scheduledFor).toISOString(), recurrenceRule: recurrenceRule(recurrence, scheduledFor), actionPlanId: actionPlanForJob?.id ?? null });
      setJobs((existing) => [...existing, created].sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor)));
      setShowCreate(false);
      setTitle("");
      setRecurrence("once");
      setSourceToolNames([]);
      setActionPlanForJob(undefined);
    } catch {
      setError("The report job could not be scheduled. Check the required fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!runConfirmation || !client.runReportJob) return;
    setRunning(true);
    try {
      const updated = await client.runReportJob(runConfirmation.id);
      setJobs((existing) => existing.map((job) => job.id === updated.id ? updated : job));
      setSelectedJob(updated);
      setRunConfirmation(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "report_job_busy" ? "This report job is already running." : "The report job could not be started.");
    } finally {
      setRunning(false);
    }
  };

  const previewActionDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client.previewReportActionPlan) return;
    if (file.size > 150_000) { setError("Action documents must be 150 KB or smaller."); return; }
    setPlanning(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      const contentBase64 = dataUrl.split(",", 2)[1];
      if (!contentBase64) throw new Error("File encoding failed");
      const preview = await client.previewReportActionPlan(file.name, contentBase64);
      setPlanPreview(preview);
      setEditablePlan(preview.plan);
      setError(undefined);
    } catch {
      setError("The action document could not be interpreted. Use a readable .xlsx, .csv, or .txt file.");
    } finally { setPlanning(false); }
  };

  const savePlan = async () => {
    if (!planPreview || !client.updateReportActionPlan) return;
    setSavingPlan(true);
    try { const saved = await client.updateReportActionPlan(planPreview.id, editablePlan.trim()); setPlanPreview(saved); setEditablePlan(saved.plan); } catch { setError("The action-plan draft could not be saved."); } finally { setSavingPlan(false); }
  };

  const regeneratePlan = async () => {
    if (!planPreview || !client.regenerateReportActionPlan) return;
    setRegeneratingPlan(true);
    try {
      const regenerated = await client.regenerateReportActionPlan(planPreview.id);
      setPlanPreview(regenerated);
      setEditablePlan(regenerated.plan);
      setError(undefined);
    } catch {
      setError("The executable steps could not be regenerated.");
    } finally {
      setRegeneratingPlan(false);
    }
  };

  const approvePlan = async () => {
    if (!approvalConfirmation || !client.approveReportActionPlan) return;
    setApprovingPlan(true);
    try { const approved = await client.approveReportActionPlan(approvalConfirmation.id, approvalConfirmation.revision); setPlanPreview(approved); setEditablePlan(approved.plan); setApprovalConfirmation(undefined); } catch (cause) { setError(cause instanceof ApiError && cause.code === "action_plan_immutable" ? "This draft changed or has already been approved. Review the latest version." : "The action plan could not be approved."); } finally { setApprovingPlan(false); }
  };
  const executePlan = async () => {
    if (!executionConfirmation || !client.executeApprovedActionPlan) return;
    setExecutingPlan(true);
    try { setPlanExecution(await client.executeApprovedActionPlan(executionConfirmation.id)); setExecutionConfirmation(undefined); } catch { setError("The approved action plan could not be executed."); } finally { setExecutingPlan(false); }
  };
  const downloadReport = async () => {
    if (!selectedJob || !client.downloadReportJob) return;
    setDownloading(true);
    try { await client.downloadReportJob(selectedJob.id, exportFormat); } catch (cause) { setError(cause instanceof ApiError && cause.code === "report_not_ready" ? "This report is not ready to download yet." : "The report could not be downloaded."); } finally { setDownloading(false); }
  };
  const selectJob = async (job: ReportJobSummary) => { setSelectedJob(job); if (client.listReportJobRuns) try { setJobRuns(await client.listReportJobRuns(job.id)); } catch { setJobRuns([]); } };
  const setScheduleActive = async (active: boolean) => { if (!selectedJob || !client.setReportScheduleActive) return; setScheduleUpdating(true); try { const updated = await client.setReportScheduleActive(selectedJob.id, active); setSelectedJob(updated); setJobs((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch { setError("The schedule state could not be updated."); } finally { setScheduleUpdating(false); } };
  const deleteJob = async () => { if (!deleteConfirmation || !client.deleteReportJob) return; setDeletingJob(true); try { await client.deleteReportJob(deleteConfirmation.id); setJobs((items) => items.filter((item) => item.id !== deleteConfirmation.id)); if (selectedJob?.id === deleteConfirmation.id) setSelectedJob(undefined); setDeleteConfirmation(undefined); } catch { setError("The report job could not be deleted."); } finally { setDeletingJob(false); } };

  return (
    <main className="reports-page" aria-labelledby="reports-title">
      <header className="reports-header reports-toolbar">
        <div>
          <p className="section-label">Reporting workspace</p>
          <h1 id="reports-title">Reports</h1>
          <p>Schedule operational summaries and review their final outcome in one place.</p>
        </div>
        <div className="report-header-actions"><input ref={uploadRef} className="visually-hidden" type="file" accept=".xlsx,.csv,.txt" onChange={(event) => void previewActionDocument(event)} /><Button design="Transparent" icon="upload" accessibleName="Upload action document" title="Upload action document" loading={planning} onClick={() => uploadRef.current?.click()} /><Button design="Transparent" icon="add" accessibleName="Schedule report job" title="Schedule report job" onClick={() => { setActionPlanForJob(undefined); setShowCreate((open) => !open); }} /></div>
      </header>

      {showCreate && (
        <form className="report-job-form" aria-label="Schedule report job" onSubmit={create}>
          <label>Job name<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Daily integration summary" /></label>
          <label>Run at<input required type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
          <label>Repeat<select aria-label="Report recurrence" value={recurrence} onChange={(event) => setRecurrence(event.target.value as Recurrence)}><option value="once">Once</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
          {recurrence !== "once" && <p className="report-plan-link">Recurring schedules run at the selected minute in UTC and meet the trial scheduler’s one-hour minimum.</p>}
          {actionPlanForJob && <p className="report-plan-link">This job will execute approved action-plan revision {actionPlanForJob.revision}.</p>}
          <fieldset className="report-source-picker"><legend>Approved report sources</legend><p>Select the read-only MCP tools this report may use. Leave empty to allow all available read-only sources.</p>{reportSources.map((source) => <label key={source.name}><input type="checkbox" checked={sourceToolNames.includes(source.name)} onChange={(event) => setSourceToolNames((selected) => event.target.checked ? [...selected, source.name] : selected.filter((name) => name !== source.name))} /><span><strong>{source.name.replace(/^.+__/, "")}</strong><small>{source.description}</small></span></label>)}{reportSources.length === 0 && <small>No read-only MCP sources are currently available.</small>}</fieldset>
          <label>Report instructions<TextArea accessibleName="Report instructions" value={reportPrompt} rows={10} onInput={(event) => setReportPrompt(event.target.value)} /></label>
          <div className="report-job-actions">
            <Button design="Transparent" icon="decline" accessibleName="Cancel scheduling" title="Cancel" type="Button" onClick={() => { setShowCreate(false); setActionPlanForJob(undefined); setSourceToolNames([]); }} />
            <Button design="Emphasized" icon="accept" accessibleName="Save report job" title="Save report job" type="Submit" disabled={!title.trim() || !reportPrompt.trim()} loading={saving} />
          </div>
        </form>
      )}

      {error && <p className="report-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading report jobs…</p> : jobs.length === 0 ? (
        <section className="reports-empty"><h2>No report jobs yet</h2><p>Use the add button to schedule your first operational report.</p></section>
      ) : (
        <section aria-labelledby="report-jobs-title">
          <h2 id="report-jobs-title">Report jobs</h2>
          {nextJob && <p className="reports-next">Next: <strong>{nextJob.title}</strong> · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(nextJob.scheduledFor))}</p>}
          <ol className="report-job-list">
            {jobs.map((job) => {
              const urgency = marker(job.scheduledFor, job.status);
              const finalStatus = visibleStatus(job);
              return <li key={job.id} className="report-job-row">
                <span className={`report-status ${job.scheduleActive ? finalStatus : "paused"}`} aria-label={job.scheduleActive ? statusLabel(finalStatus) : "Paused"} />
                {urgency && job.scheduleActive && <span className={`report-marker ${urgency}`} aria-label={`Scheduled within ${urgency === "red" ? "5 minutes" : urgency === "orange" ? "30 minutes" : "one hour"}`} />}
                <button className="report-job-select" type="button" onClick={() => void selectJob(job)}><strong>{job.title}</strong><small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.scheduledFor))}{job.recurrenceRule ? " · Recurring" : ""}</small></button>
                <span className="report-status-label">{!job.scheduleActive ? "Paused" : job.status === "scheduled" && job.lastRunStatus ? `Next scheduled · Last ${statusLabel(job.lastRunStatus).toLowerCase()}` : statusLabel(job.status)}</span>
              </li>;
            })}
          </ol>
        </section>
      )}

      {selectedJob && (
        <section className="report-detail" aria-labelledby="report-detail-title">
          <header>
            <div><p className="section-label">Job detail</p><h2 id="report-detail-title">{selectedJob.title}</h2></div>
            <div className="report-detail-actions">
              {selectedJob.status === "scheduled" && <Button design="Transparent" icon="media-play" accessibleName="Run report now" title="Run report now" onClick={() => setRunConfirmation(selectedJob)} />}
              {selectedJob.status === "scheduled" && <Button design="Transparent" icon={selectedJob.scheduleActive ? "media-pause" : "media-play"} accessibleName={selectedJob.scheduleActive ? "Pause schedule" : "Resume schedule"} title={selectedJob.scheduleActive ? "Pause schedule" : "Resume schedule"} loading={scheduleUpdating} onClick={() => void setScheduleActive(!selectedJob.scheduleActive)} />}
              <label className="report-export-picker">Export<select aria-label="Report download format" value={exportFormat} disabled={!selectedJob.finalReportHtml || downloading} onChange={(event) => setExportFormat(event.target.value as ReportExportFormat)}><option value="html">HTML</option><option value="markdown">Markdown</option><option value="xlsx">Excel</option></select></label>
              <Button design="Transparent" icon="download" accessibleName="Download report" title="Download report" disabled={!selectedJob.finalReportHtml} loading={downloading} onClick={() => void downloadReport()} />
              <Button design="Transparent" icon="decline" accessibleName="Close report detail" title="Close" onClick={() => setSelectedJob(undefined)} />
              <Button design="Transparent" icon="delete" accessibleName="Delete report job" title="Delete report job" onClick={() => setDeleteConfirmation(selectedJob)} />
            </div>
          </header>
          <p>{selectedJob.status === "scheduled" ? "Scheduled" : statusLabel(selectedJob.status)} · {selectedJob.recurrenceRule ? "Next run" : "Scheduled"} {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedJob.scheduledFor))}{selectedJob.recurrenceRule ? " · Recurring" : ""}{selectedJob.lastRunStatus ? ` · Last run ${statusLabel(selectedJob.lastRunStatus).toLowerCase()}` : ""}{selectedJob.actionPlanId ? " · Approved action plan attached" : ""}{selectedJob.sourceToolNames.length ? ` · ${selectedJob.sourceToolNames.length} source${selectedJob.sourceToolNames.length === 1 ? "" : "s"} selected` : " · All read-only sources"}</p>
          {selectedJob.finalReportHtml ? <iframe className="report-preview" title={`${selectedJob.title} report`} sandbox="" srcDoc={selectedJob.finalReportHtml} /> : <p className="report-preview-empty">The final report will appear here once execution finishes.</p>}
          {selectedJob.errorLog && <details className="report-roadblock"><summary>Report roadblock</summary><pre>{selectedJob.errorLog}</pre></details>}
          {jobRuns.length > 0 && <details><summary>Run history ({jobRuns.length})</summary><ol className="report-run-history">{jobRuns.map((run) => <li key={run.id}><span className={`report-status ${run.status}`} /><span>{statusLabel(run.status)} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.completedAt))}</span>{run.errorLog && <a href={`/api/reports/jobs/${encodeURIComponent(selectedJob.id)}/runs/${encodeURIComponent(run.id)}/roadblock`}>Roadblock log</a>}</li>)}</ol></details>}
        </section>
      )}

      {planPreview && <section className="report-plan-preview" aria-labelledby="action-plan-title"><header><div><p className="section-label">{planPreview.status === "approved" ? `Approved revision ${planPreview.revision}` : `Review only · Draft revision ${planPreview.revision}`}</p><h2 id="action-plan-title">Proposed action plan</h2></div><div className="report-detail-actions">{planPreview.status === "draft" && <><Button design="Transparent" icon="save" accessibleName="Save action-plan draft" title="Save draft" disabled={!editablePlan.trim() || editablePlan === planPreview.plan} loading={savingPlan} onClick={() => void savePlan()} /><Button design="Transparent" icon="refresh" accessibleName="Regenerate action-plan steps" title="Regenerate steps" disabled={editablePlan !== planPreview.plan} loading={regeneratingPlan} onClick={() => void regeneratePlan()} /><Button design="Emphasized" icon="accept" accessibleName="Approve action-plan revision" title="Approve revision" disabled={editablePlan !== planPreview.plan || planPreview.steps.length === 0} onClick={() => setApprovalConfirmation(planPreview)} /></>}{planPreview.status === "approved" && <><Button design="Transparent" icon="calendar" accessibleName="Schedule approved action plan" title="Schedule approved plan" onClick={() => { setActionPlanForJob(planPreview); setShowCreate(true); }} /><Button design="Emphasized" icon="media-play" accessibleName="Execute approved action plan" title="Execute approved plan" onClick={() => setExecutionConfirmation(planPreview)} /></>}<Button design="Transparent" icon="decline" accessibleName="Close action plan" title="Close" onClick={() => setPlanPreview(undefined)} /></div></header><p>{planPreview.status === "approved" ? "This exact plan revision is locked. You can schedule it as a report job or execute it only when you intend to run every listed operation." : planPreview.steps.length === 0 ? "This edited draft has no executable steps. Regenerate its steps before approval." : "Review the exact tool calls below before approving this revision."}</p><div className="report-plan-grid"><label className="report-plan-editor">Editable proposed plan<TextArea accessibleName="Editable proposed action plan" value={editablePlan} rows={14} growing growingMaxRows={22} disabled={planPreview.status === "approved"} onInput={(event) => setEditablePlan(event.target.value)} /></label><details open><summary>Exact MCP steps ({planPreview.steps.length})</summary><pre>{JSON.stringify(planPreview.steps, null, 2)}</pre></details><details><summary>Normalized source document</summary><pre>{planPreview.source}</pre></details>{planExecution && <iframe className="report-preview" title="Approved action-plan execution report" sandbox="" srcDoc={planExecution.html} />}</div></section>}

      {approvalConfirmation && <div className="delete-confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="approve-plan-title" aria-describedby="approve-plan-description"><div><strong id="approve-plan-title">Approve this plan revision?</strong><p id="approve-plan-description">Revision {approvalConfirmation.revision} will be locked. Any later change requires a new draft and a new approval.</p></div><div className="delete-confirmation-actions"><Button design="Transparent" icon="decline" accessibleName="Cancel action-plan approval" title="Cancel" disabled={approvingPlan} onClick={() => setApprovalConfirmation(undefined)} /><Button design="Emphasized" icon="accept" accessibleName="Confirm action-plan approval" title="Approve revision" loading={approvingPlan} onClick={() => void approvePlan()} /></div></section></div>}
      {executionConfirmation && <div className="delete-confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="execute-plan-title" aria-describedby="execute-plan-description"><div><strong id="execute-plan-title">Execute approved plan?</strong><p id="execute-plan-description">FlowPilot will invoke each approved Integration Content operation in order. Each item may deploy, undeploy, or update an integration flow.</p></div><div className="delete-confirmation-actions"><Button design="Transparent" icon="decline" accessibleName="Cancel action-plan execution" title="Cancel" disabled={executingPlan} onClick={() => setExecutionConfirmation(undefined)} /><Button design="Emphasized" icon="media-play" accessibleName="Confirm action-plan execution" title="Execute plan" loading={executingPlan} onClick={() => void executePlan()} /></div></section></div>}

      {runConfirmation && <div className="delete-confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="run-report-title" aria-describedby="run-report-description"><div><strong id="run-report-title">Run this report now?</strong><p id="run-report-description">FlowPilot will execute the configured report workflow immediately. Any connected operations must be approved before they are added to this workflow.</p></div><div className="delete-confirmation-actions"><Button design="Transparent" icon="decline" accessibleName="Cancel report run" title="Cancel" disabled={running} onClick={() => setRunConfirmation(undefined)} /><Button design="Emphasized" icon="media-play" accessibleName="Confirm report run" title="Run now" loading={running} onClick={() => void runNow()} /></div></section></div>}
      {deleteConfirmation && <div className="delete-confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-report-title" aria-describedby="delete-report-description"><div><strong id="delete-report-title">Delete this report job?</strong><p id="delete-report-description">This removes its scheduler entry and its saved run history.</p></div><div className="delete-confirmation-actions"><Button design="Transparent" icon="decline" accessibleName="Cancel report deletion" title="Cancel" disabled={deletingJob} onClick={() => setDeleteConfirmation(undefined)} /><Button design="Negative" icon="delete" accessibleName="Confirm report deletion" title="Delete report job" loading={deletingJob} onClick={() => void deleteJob()} /></div></section></div>}
    </main>
  );
}
