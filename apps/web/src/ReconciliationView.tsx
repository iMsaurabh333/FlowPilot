import { Button } from "@ui5/webcomponents-react/Button";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  FlowPilotApi,
  IdentifierType,
  ReconciliationPreview,
  ReconciliationResult,
  ReportSource,
} from "./api";

const MAX_BYTES = 1_000_000;
const DIRECT_LIMIT = 10;
function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}
function title(name: string) {
  return name.replace(/__.*/u, "").replace(/[-_]/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
function friendlyField(name: string) {
  return name.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/[-_]/g, " ");
}
function lookupLabel(item: IdentifierType) {
  const names = Object.keys(item.retrieval.parameters).map(friendlyField);
  return names.join(", ") || item.friendlyName;
}

export function ReconciliationView({ client }: { client: FlowPilotApi }) {
  const upload = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ReconciliationPreview>();
  const [directIds, setDirectIds] = useState("");
  const [sources, setSources] = useState<ReportSource[]>([]);
  const [identifierTypes, setIdentifierTypes] = useState<IdentifierType[]>([]);
  const [lookupBySource, setLookupBySource] = useState<Record<string, string>>({});
  const [responseBySource, setResponseBySource] = useState<Record<string, string>>({});
  const [column, setColumn] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ReconciliationResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resultQuery, setResultQuery] = useState("");
  useEffect(() => {
    if (!client.listReconciliationSources) return;
    void client
      .listReconciliationSources()
      .then(setSources)
      .catch(() =>
        setError("Compatible reconciliation systems could not be loaded."),
      );
  }, [client]);
  useEffect(() => {
    if (!client.listIdentifierTypes) return;
    void client.listIdentifierTypes().then(setIdentifierTypes).catch(() => undefined);
  }, [client]);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client.previewReconciliationUpload) return;
    if (file.size > MAX_BYTES) {
      setError("Upload must be 1 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const next = await client.previewReconciliationUpload(
        file.name,
        await base64(file),
      );
      setPreview(next);
      setColumn(next.headers[0] ?? "");
      setDirectIds("");
      setResult(undefined);
      setError(undefined);
    } catch {
      setError(
        "Use a readable .xlsx or .csv file with headers and no more than 60 records.",
      );
    } finally {
      setBusy(false);
    }
  };
  const idsToRun = () =>
    preview && column
      ? preview.rows
          .map((row) => row[preview.headers.indexOf(column)])
          .filter(Boolean)
      : [
          ...new Set(
            directIds
              .split(/[\s,;\n]+/u)
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ];
  const lookupForSource = (sourceName: string) => {
    const compatible = identifierTypes.filter((item) => item.status === "Active" && item.retrieval.serverId === sourceName);
    return compatible.find((item) => item.id === lookupBySource[sourceName]) ?? compatible[0];
  };
  const responseForSource = (sourceName: string, lookup = lookupForSource(sourceName)) => {
    if (!lookup) return undefined;
    const compatible = identifierTypes.filter((item) => item.status === "Active" && item.retrieval.serverId === sourceName && item.retrieval.toolName === lookup.retrieval.toolName);
    return compatible.find((item) => item.id === responseBySource[sourceName]) ?? compatible[0];
  };
  const run = async () => {
    const ids = idsToRun();
    const identifierSelections = selected.map((source) => {
      const lookup = lookupForSource(source);
      const response = responseForSource(source, lookup);
      return lookup && response ? { lookupIdentifierTypeId: lookup.id, responseIdentifierTypeId: response.id } : undefined;
    }).filter((selection): selection is { lookupIdentifierTypeId: string; responseIdentifierTypeId: string } => Boolean(selection));
    if (!ids.length || !selected.length || identifierSelections.length !== selected.length || !client.runReconciliation) return;
    if (!preview && ids.length > DIRECT_LIMIT) {
      setError(
        `Enter no more than ${DIRECT_LIMIT} IDs directly. Upload Excel or CSV for larger reconciliations.`,
      );
      return;
    }
    setBusy(true);
    try {
      setResult(
        await client.runReconciliation({
          ids,
          sourceToolNames: selected,
          identifierSelections,
          fields: [],
        }),
      );
      setError(undefined);
    } catch {
      setError(
        "The reconciliation could not run. Confirm that each selected system is healthy and that its Active identifier type has a valid lookup mapping.",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    if (!result || !client.downloadReconciliationReport) return;
    setBusy(true);
    try {
      await client.downloadReconciliationReport(result);
    } catch {
      setError("The Excel report could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };
  const directCount = [
    ...new Set(
      directIds
        .split(/[\s,;\n]+/u)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].length;
  const systems = result
    ? [...new Set(result.rows.flatMap((row) => Object.keys(row.systems)))]
    : [];
  const displayNameForSystem = (systemId: string) =>
    sources.find((source) => source.name === systemId)?.displayName ??
    identifierTypes.find((item) => item.systemId === systemId)?.systemName ??
    title(systemId);
  const visibleRows = useMemo(() => {
    const term = resultQuery.trim().toLocaleLowerCase();
    if (!result || !term) return result?.rows ?? [];
    return result.rows.filter((row) => [row.reconciliationValue, row.result, ...Object.values(row.systems).map((system) => system.responseValue)].some((value) => value?.toLocaleLowerCase().includes(term)));
  }, [result, resultQuery]);
  return (
    <section className="reconciliation" aria-labelledby="reconciliation-title">
      <header>
        <div>
          <p className="section-label">Manual reconciliation</p>
          <h2 id="reconciliation-title">Reconcile business values</h2>
          <p>
            Enter up to 10 values directly, or upload a value file for a larger
            reconciliation.
          </p>
        </div>
        <div className="report-header-actions">
          <input
            ref={upload}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => void choose(event)}
          />
          <Button
            design="Transparent"
            icon="download"
            accessibleName="Download sample Excel file"
            title="Download sample Excel file"
            onClick={() =>
              window.open("/api/reconciliations/template", "_self")
            }
          />
          <Button
            design="Transparent"
            icon="upload"
            accessibleName="Upload reconciliation values"
            title="Upload reconciliation values"
            loading={busy}
            onClick={() => upload.current?.click()}
          />
        </div>
      </header>
      <aside className="reconciliation-ribbon">
        <strong>Limits</strong>
        <span>Direct entry: up to 10 IDs</span>
        <span>Excel or CSV: up to 60 IDs</span>
        <span>1 MB maximum</span>
        <span>Up to 3 systems per run</span>
      </aside>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      <div className="reconciliation-config">
        {preview ? (
          <section className="reconciliation-upload-summary" aria-label="Uploaded reconciliation file">
            <span>Uploaded file</span>
            <strong>{preview.fileName}</strong>
            <small><b>{preview.totalRows}</b> records ready for lookup</small>
          </section>
        ) : (
          <label>
            Values to reconcile (up to 10)
            <textarea value={directIds} rows={3} placeholder="611889, 173470" onChange={(event) => { setDirectIds(event.target.value); setResult(undefined); }} />
            <small>{directCount}/{DIRECT_LIMIT} direct IDs. Separate IDs with commas, spaces, or new lines.</small>
          </label>
        )}
        {preview && (
          <label>
            Reconciliation value column
            <select
              value={column}
              onChange={(event) => setColumn(event.target.value)}
            >
              {preview.headers.map((header) => (
                <option key={header}>{header}</option>
              ))}
            </select>
            <small>Select the column containing the value shared across the selected systems.</small>
          </label>
        )}
        <Button
          className="reconciliation-run"
          design="Emphasized"
          icon="play"
          accessibleName="Run reconciliation"
          title="Run reconciliation"
          disabled={
            !idsToRun().length ||
            !selected.length ||
            selected.some((source) => !lookupForSource(source) || !responseForSource(source)) ||
            (!preview && directCount > DIRECT_LIMIT)
          }
          loading={busy}
          onClick={() => void run()}
        >
          Run reconciliation
        </Button>
        <fieldset className="report-source-picker reconciliation-source-picker">
          <legend>Choose reconciliation systems</legend>
          <div className="reconciliation-picker-intro">
            <p>Select up to three systems for this run. FlowPilot sends the entered value using the lookup identifier, then returns the selected response field in the report.</p>
            <strong aria-live="polite">{selected.length}/3 systems selected</strong>
          </div>
          {sources.length ? <div className="reconciliation-system-table" role="group" aria-label="Reconciliation system selection">
            <div className="reconciliation-system-heading"><span>Use in this run</span><span>Lookup identifier</span><span>Response field</span></div>
            {sources.map((source) => {
              // A server becomes selectable when an App Admin has saved and activated
              // at least one tested identifier definition for that server.
              const compatible = identifierTypes.filter((item) => item.status === "Active" && item.retrieval.serverId === source.name);
              const lookup = compatible.find((item) => item.id === lookupBySource[source.name]) ?? compatible[0];
              const responseChoices = lookup ? compatible.filter((item) => item.retrieval.toolName === lookup.retrieval.toolName) : [];
              const response = responseChoices.find((item) => item.id === responseBySource[source.name]) ?? responseChoices[0];
              return <div className="reconciliation-system-row" key={source.name}>
                <label><input type="checkbox" disabled={!lookup || !response || (!selected.includes(source.name) && selected.length >= 3)} checked={selected.includes(source.name)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.name] : current.filter((name) => name !== source.name))} /><span>{lookup?.systemName ?? title(source.name)}</span></label>
                <select aria-label={`Lookup identifier for ${title(source.name)}`} value={lookup?.id ?? ""} disabled={!selected.includes(source.name)} onChange={(event) => { const nextLookup = compatible.find((item) => item.id === event.target.value); setLookupBySource((current) => ({ ...current, [source.name]: event.target.value })); if (nextLookup && !compatible.some((item) => item.id === responseBySource[source.name] && item.retrieval.toolName === nextLookup.retrieval.toolName)) setResponseBySource((current) => ({ ...current, [source.name]: nextLookup.id })); }}>{compatible.map((item) => <option key={item.id} value={item.id}>{lookupLabel(item)}</option>)}</select>
                <select aria-label={`Response field for ${title(source.name)}`} value={response?.id ?? ""} disabled={!selected.includes(source.name) || !lookup} onChange={(event) => setResponseBySource((current) => ({ ...current, [source.name]: event.target.value }))}>{responseChoices.map((item) => <option key={item.id} value={item.id}>{item.friendlyName}</option>)}</select>
              </div>;
            })}
          </div> : <p>No compatible systems are currently healthy. Ask an administrator to enable a system and an Active identifier type.</p>}
        </fieldset>
      </div>
      {result && (
        <section className="reconciliation-result">
          <header>
            <div>
              <p className="section-label">Result</p>
              <h3>Reconciliation report</h3>
            </div>
            <div className="reconciliation-result-actions"><label className="reconciliation-search"><span>Search report</span><input type="search" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} placeholder="Search report" aria-label="Search report" /></label><output aria-live="polite">{visibleRows.length} {visibleRows.length === 1 ? "result" : "results"}</output><Button
              design="Transparent"
              icon="download"
              accessibleName="Download reconciliation report as Excel"
              title="Download Excel report"
              loading={busy}
              onClick={() => void download()}
            /></div>
          </header>
          <div className="reconciliation-table">
            <table>
              <thead>
                <tr>
                  <th>Reconciliation value</th>
                  {systems.map((system) => (
                    <th key={system}>{displayNameForSystem(system)}<small>{responseForSource(system)?.friendlyName ?? "Selected response field"}</small></th>
                  ))}
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.reconciliationValue}>
                    <td>{row.reconciliationValue}</td>
                    {systems.map((system) => (
                      <td key={system}>{row.systems[system]?.responseValue || "—"}</td>
                    ))}
                    <td>
                      <span className={`reconciliation-status ${row.result}`}>
                        {row.result}
                      </span>
                    </td>
                  </tr>
                ))}{!visibleRows.length && <tr><td colSpan={systems.length + 2}>No report rows match this search.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
