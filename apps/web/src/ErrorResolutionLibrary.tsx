import { useEffect, useMemo, useState } from "react";
import type { IntegrationHealthSummary } from "./api";

export type ErrorResolutionEntry = {
  id: string;
  description: string;
  firstOccurrence: string;
  incidentReference: string;
  resolutionNotes: string;
  custom?: boolean;
};

const storageKey = "flowpilot-error-resolution-library";
const fallbackError = "CPI did not provide error details for this failure.";

function normalized(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function errorsFromHealth(health: IntegrationHealthSummary): ErrorResolutionEntry[] {
  const errors = new Map<string, ErrorResolutionEntry>();
  for (const flow of health.flows) {
    const observed = [
      ...(flow.representativeError ? [{ description: flow.representativeError, at: health.to }] : []),
      ...flow.businessMessages.filter((message) => message.failed > 0).map((message) => ({
        description: message.latestError?.trim() || fallbackError,
        at: message.lastFailureAt || health.to,
      })),
    ];
    for (const error of observed) {
      const key = normalized(error.description);
      const existing = errors.get(key);
      if (!existing || Date.parse(error.at) < Date.parse(existing.firstOccurrence)) {
        errors.set(key, {
          id: `health-${key}`,
          description: error.description.trim(),
          firstOccurrence: error.at,
          incidentReference: existing?.incidentReference ?? "",
          resolutionNotes: existing?.resolutionNotes ?? "",
        });
      }
    }
  }
  return [...errors.values()];
}

export function mergeHealthErrors(current: ErrorResolutionEntry[], health: IntegrationHealthSummary) {
  const automatic = errorsFromHealth(health);
  const byDescription = new Map(current.map((entry) => [normalized(entry.description), entry]));
  for (const entry of automatic) {
    const key = normalized(entry.description);
    const saved = byDescription.get(key);
    byDescription.set(key, saved ? {
      ...entry,
      firstOccurrence: Date.parse(saved.firstOccurrence) < Date.parse(entry.firstOccurrence) ? saved.firstOccurrence : entry.firstOccurrence,
      incidentReference: saved.incidentReference,
      resolutionNotes: saved.resolutionNotes,
      custom: saved.custom,
    } : entry);
  }
  return [...byDescription.values()];
}

export function ErrorResolutionLibrary({ entries, onChange }: { entries: ErrorResolutionEntry[]; onChange: (entries: ErrorResolutionEntry[]) => void }) {
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [detailEntry, setDetailEntry] = useState<ErrorResolutionEntry>();
  const [draft, setDraft] = useState({ description: "", firstOccurrence: new Date().toISOString().slice(0, 16), incidentReference: "", resolutionNotes: "" });
  const matchingEntries = useMemo(() => {
    const term = normalized(query);
    return term ? entries.filter((entry) => [entry.description, entry.incidentReference, entry.resolutionNotes, entry.firstOccurrence].some((value) => normalized(value).includes(term))) : entries;
  }, [entries, query]);
  const unresolved = entries.filter((entry) => !entry.resolutionNotes.trim()).length;
  const update = (id: string, field: "incidentReference" | "resolutionNotes", value: string) => {
    const next = entries.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry);
    onChange(next);
    setDetailEntry(next.find((entry) => entry.id === id));
  };
  const add = () => {
    const description = draft.description.trim();
    if (!description || entries.some((entry) => normalized(entry.description) === normalized(description))) return;
    onChange([...entries, { id: `custom-${crypto.randomUUID()}`, description, firstOccurrence: new Date(draft.firstOccurrence).toISOString(), incidentReference: draft.incidentReference.trim(), resolutionNotes: draft.resolutionNotes.trim(), custom: true }]);
    setDraft({ description: "", firstOccurrence: new Date().toISOString().slice(0, 16), incidentReference: "", resolutionNotes: "" });
    setShowAdd(false);
  };

  return <section className="error-resolution-library" aria-labelledby="error-resolution-title">
    <header className="error-library-header"><div><p className="section-label">RESOLUTION KNOWLEDGE</p><h2 id="error-resolution-title">Error resolution library</h2><p>Unique errors found in Integration Health, with the context needed to resolve them faster next time.</p></div><button type="button" className="error-library-add" onClick={() => setShowAdd((open) => !open)}>{showAdd ? "Cancel" : "Add entry"}</button></header>
    <div className="error-library-guidance"><strong>{unresolved}</strong><div><b>{unresolved === 1 ? "entry needs resolution notes" : "entries need resolution notes"}</b><span>Document the resolution steps to help the next investigation move faster.</span></div></div>
    {showAdd && <form className="error-library-form" onSubmit={(event) => { event.preventDefault(); add(); }}><label>Error description<input required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>First occurrence<input required type="datetime-local" value={draft.firstOccurrence} onChange={(event) => setDraft({ ...draft, firstOccurrence: event.target.value })} /></label><label>Incident reference<input value={draft.incidentReference} onChange={(event) => setDraft({ ...draft, incidentReference: event.target.value })} placeholder="e.g. INC-12345" /></label><label>Resolution notes<textarea value={draft.resolutionNotes} onChange={(event) => setDraft({ ...draft, resolutionNotes: event.target.value })} /></label><div className="error-library-form-actions"><button type="submit">Save entry</button><button type="button" className="error-library-cancel" onClick={() => setShowAdd(false)}>Cancel</button></div></form>}
    <div className="error-library-controls"><label><span>Search errors</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description, incident or notes" /></label><output aria-live="polite">{matchingEntries.length} {matchingEntries.length === 1 ? "entry" : "entries"}</output></div>
    <div className="error-library-table"><table><thead><tr><th scope="col">#</th><th scope="col">First occurrence</th><th scope="col">Unique error description</th><th scope="col">Incident reference</th><th scope="col">Resolution notes</th></tr></thead><tbody>{matchingEntries.length ? matchingEntries.map((entry, index) => <tr key={entry.id}><td>{index + 1}</td><td>{displayDate(entry.firstOccurrence)}</td><td><strong>{entry.description}</strong>{entry.custom && <small>Custom entry</small>}</td><td>{entry.incidentReference || "—"}</td><td><button type="button" className="error-library-details" onClick={() => setDetailEntry(entry)}>Details</button>{entry.resolutionNotes.trim() ? <small className="resolution-note-state">Notes available</small> : <small className="resolution-note-state pending">Notes needed</small>}</td></tr>) : <tr><td colSpan={5}>No error-library entries match this search.</td></tr>}</tbody></table></div>
    {detailEntry && <div className="error-library-modal-backdrop" role="presentation"><section className="error-library-modal" role="dialog" aria-modal="true" aria-labelledby="error-entry-details-title"><header><div><p className="section-label">ERROR ENTRY</p><h3 id="error-entry-details-title">Resolution details</h3></div><button type="button" aria-label="Close error details" onClick={() => setDetailEntry(undefined)}>×</button></header><dl><div><dt>First occurrence</dt><dd>{displayDate(detailEntry.firstOccurrence)}</dd></div><div><dt>Unique error description</dt><dd>{detailEntry.description}</dd></div><div><dt>Incident reference</dt><dd><input aria-label="Incident reference" value={detailEntry.incidentReference} onChange={(event) => update(detailEntry.id, "incidentReference", event.target.value)} placeholder="Add reference" /></dd></div><div><dt>Resolution notes</dt><dd><textarea aria-label="Resolution notes" value={detailEntry.resolutionNotes} onChange={(event) => update(detailEntry.id, "resolutionNotes", event.target.value)} placeholder="Document the steps that resolved this error." /></dd></div></dl><footer><button type="button" onClick={() => setDetailEntry(undefined)}>Done</button></footer></section></div>}
  </section>;
}

export function useStoredErrorResolutionEntries() {
  const [entries, setEntries] = useState<ErrorResolutionEntry[]>(() => {
    try { return JSON.parse(globalThis.localStorage.getItem(storageKey) ?? "[]") as ErrorResolutionEntry[]; } catch { return []; }
  });
  useEffect(() => {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(entries));
  }, [entries]);
  return [entries, setEntries] as const;
}
