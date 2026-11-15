import * as XLSX from "xlsx";

import type { ChatTool } from "@flowpilot/agent-core";
import type { AuthenticatedUser } from "../types.js";
import type { IdentifierTypeDefinition } from "../identifier-types.js";

export const RECONCILIATION_MAX_BYTES = 1_000_000;
export const RECONCILIATION_MAX_IDS = 60;
export const RECONCILIATION_DIRECT_MAX_IDS = 10;
export const RECONCILIATION_MAX_SOURCES = 3;

export interface ReconciliationPreview {
  fileName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
}
export interface ReconciliationRow {
  reconciliationValue: string;
  result: "matched" | "exception" | "unavailable";
  systems: Record<string, {
    status: string;
    lookupField: string;
    responseField: string;
    responseValue: string;
    fields: Record<string, string>;
  }>;
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function previewReconciliationUpload(fileName: string, contentBase64: string): ReconciliationPreview {
  const bytes = Buffer.from(contentBase64, "base64");
  if (!bytes.length || bytes.length > RECONCILIATION_MAX_BYTES) throw new Error("Upload must be between 1 byte and 1 MB.");
  const name = fileName.toLowerCase();
  if (!/\.(xlsx|csv)$/u.test(name)) throw new Error("Upload an .xlsx or .csv file.");
  const workbook = XLSX.read(bytes, { type: "buffer", cellText: true, cellFormula: false, cellHTML: false });
  const first = workbook.SheetNames[0];
  if (!first) throw new Error("The workbook does not contain a worksheet.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], { header: 1, blankrows: false, defval: "" });
  const headers = (matrix[0] ?? []).map(text).filter(Boolean);
  if (!headers.length) throw new Error("The first row must contain column headers.");
  const rows = matrix.slice(1).map((row) => headers.map((_, index) => text(row[index]))).filter((row) => row.some(Boolean));
  if (rows.length > RECONCILIATION_MAX_IDS) throw new Error(`Upload contains ${rows.length} records. The MVP limit is ${RECONCILIATION_MAX_IDS}.`);
  return { fileName, headers, rows, totalRows: rows.length };
}

export function reconciliationTemplate() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Reconciliation value"], ["MSG-000001"], ["MSG-000002"]]);
  sheet["!cols"] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Application IDs");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function reconciliationExport(result: { generatedAt: string; rows: ReconciliationRow[] }) {
  const systems = [...new Set(result.rows.flatMap((row) => Object.keys(row.systems)))];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["FlowPilot reconciliation report"], ["Generated", result.generatedAt], [],
    ["Reconciliation value", ...systems, "Result"],
    ...result.rows.map((row) => [row.reconciliationValue, ...systems.map((system) => row.systems[system]?.responseValue ?? ""), row.result]),
  ]);
  sheet["!cols"] = [{ wch: 28 }, ...systems.map(() => ({ wch: 26 })), { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Reconciliation");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function parseResult(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}
function items(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown[] }).items)) return items((value as { items: unknown[] }).items);
  return typeof value === "object" && value !== null ? [value as Record<string, unknown>] : [];
}
function fieldValue(item: Record<string, unknown>, name: string) { return text(item[name]); }
function responsePathValue(value: unknown, path: string) {
  const normalized = path.trim().replace(/^\$\.?/u, "");
  if (!normalized) return "";
  const segments = [...normalized.matchAll(/(?:^|\.)([^.\[\]]+)|\[(\d+)\]/gu)]
    .map((match) => match[1] ?? match[2]);
  let current: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/u.test(segment)) current = current[Number(segment)];
    else if (typeof current === "object" && current !== null && !Array.isArray(current)) current = (current as Record<string, unknown>)[segment];
    else return "";
  }
  return text(current);
}
function lookupField(definition: IdentifierTypeDefinition) {
  return Object.keys(definition.retrieval.parameters).join(", ") || "Configured input";
}

export async function runReconciliation(options: {
  user: AuthenticatedUser;
  ids: string[];
  sourceToolNames: string[];
  identifierSelections: Array<{
    lookupIdentifierTypeId: string;
    responseIdentifierTypeId: string;
  }>;
  identifierTypes: IdentifierTypeDefinition[];
  fields: string[];
  resolveTools: (user: AuthenticatedUser) => Promise<ChatTool[]>;
}) {
  const ids = [...new Set(options.ids.map((value) => value.trim()).filter(Boolean))];
  if (!ids.length || ids.length > RECONCILIATION_MAX_IDS) throw new Error(`Provide 1-${RECONCILIATION_MAX_IDS} reconciliation values.`);
  if (!options.identifierSelections.length || options.identifierSelections.length > RECONCILIATION_MAX_SOURCES) throw new Error(`Select 1-${RECONCILIATION_MAX_SOURCES} systems.`);
  const selections = options.identifierSelections.map(({ lookupIdentifierTypeId, responseIdentifierTypeId }) => {
    const lookup = options.identifierTypes.find((item) => item.id === lookupIdentifierTypeId && item.status === "Active");
    const response = options.identifierTypes.find((item) => item.id === responseIdentifierTypeId && item.status === "Active");
    return lookup && response ? { lookup, response } : undefined;
  }).filter((selection): selection is { lookup: IdentifierTypeDefinition; response: IdentifierTypeDefinition } => Boolean(selection));
  if (selections.length !== options.identifierSelections.length) throw new Error("One or more selected identifier types are not active.");
  if (new Set(selections.map(({ lookup }) => lookup.systemId)).size !== selections.length) throw new Error("Select only one lookup identifier for each system.");
  if (selections.some(({ lookup, response }) => lookup.systemId !== response.systemId || lookup.retrieval.serverId !== response.retrieval.serverId || lookup.retrieval.toolName !== response.retrieval.toolName)) throw new Error("Choose a response field from the same system and tool as its lookup identifier.");
  const toolsByName = new Map((await options.resolveTools(options.user)).map((tool) => [tool.name, tool]));
  const callableSelections = selections.map((selection) => ({ ...selection, tool: toolsByName.get(`${selection.lookup.retrieval.serverId}__${selection.lookup.retrieval.toolName}`) })).filter((selection): selection is { lookup: IdentifierTypeDefinition; response: IdentifierTypeDefinition; tool: ChatTool } => Boolean(selection.tool));
  if (callableSelections.length !== selections.length) throw new Error("One or more selected system lookups are unavailable.");
  const rows: ReconciliationRow[] = [];
  for (const id of ids) {
    const systems: ReconciliationRow["systems"] = {};
    await Promise.all(callableSelections.map(async ({ lookup, response, tool }) => {
      const parameterEntries = Object.entries(lookup.retrieval.parameters);
      const arguments_ = Object.fromEntries(parameterEntries.map(([name, value]) => [
        name,
        value.includes("{identifier}")
          ? value.replaceAll("{identifier}", id)
          // Preserve fixed auxiliary inputs, but support the one-input Drafts
          // created before identifier mappings were introduced.
          : parameterEntries.length === 1
            ? id
            : value,
      ]));
      const raw = await tool.invoke(arguments_);
      const parsed = parseResult(raw);
      const first = items(parsed)[0];
      // Tool names are namespaced as <server-id>__<tool-name>. Reconciliation
      // compares systems, rather than individual tools, so retain the server
      // identity here. This also prevents two compatible lookup tools from
      // overwriting one another in the result table.
      const key = lookup.systemId;
      const responseField = String(response.retrieval.expectedField || response.retrieval.responseExtractionPath);
      const responseValue = responsePathValue(parsed, response.retrieval.responseExtractionPath);
      if (!first) {
        systems[key] = { status: "Not found", lookupField: lookupField(lookup), responseField, responseValue: "", fields: {} };
        return;
      }
      const fields = Object.fromEntries(options.fields.map((field) => [field, fieldValue(first, field)]).filter(([, value]) => value));
      const status = !responseValue
        ? "Response field missing"
        : fieldValue(first, "status") || "Returned";
      systems[key] = { status, lookupField: lookupField(lookup), responseField, responseValue, fields };
    }));
    const values = Object.values(systems).map((system) => system.status);
    rows.push({ reconciliationValue: id, systems, result: values.length && values.every((value) => !["Not found", "Response field missing"].includes(value)) ? "matched" : "exception" });
  }
  return { rows, generatedAt: new Date().toISOString() };
}
