import * as XLSX from "xlsx";

import type { ChatTool } from "@flowpilot/agent-core";
import type { AuthenticatedUser } from "../types.js";

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
  applicationMessageId: string;
  result: "matched" | "exception" | "unavailable";
  systems: Record<string, { status: string; fields: Record<string, string> }>;
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
  const sheet = XLSX.utils.aoa_to_sheet([["Application Message ID"], ["MSG-000001"], ["MSG-000002"]]);
  sheet["!cols"] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Application IDs");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function reconciliationExport(result: { generatedAt: string; rows: ReconciliationRow[] }) {
  const systems = [...new Set(result.rows.flatMap((row) => Object.keys(row.systems)))];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["FlowPilot reconciliation report"], ["Generated", result.generatedAt], [],
    ["Application Message ID", ...systems, "Result"],
    ...result.rows.map((row) => [row.applicationMessageId, ...systems.map((system) => row.systems[system]?.status ?? "Not configured"), row.result]),
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

export async function runReconciliation(options: {
  user: AuthenticatedUser;
  ids: string[];
  sourceToolNames: string[];
  fields: string[];
  resolveTools: (user: AuthenticatedUser) => Promise<ChatTool[]>;
}) {
  const ids = [...new Set(options.ids.map((value) => value.trim()).filter(Boolean))];
  if (!ids.length || ids.length > RECONCILIATION_MAX_IDS) throw new Error(`Provide 1-${RECONCILIATION_MAX_IDS} application message IDs.`);
  if (!options.sourceToolNames.length || options.sourceToolNames.length > RECONCILIATION_MAX_SOURCES) throw new Error(`Select 1-${RECONCILIATION_MAX_SOURCES} approved systems.`);
  const tools = (await options.resolveTools(options.user)).filter((tool) => options.sourceToolNames.includes(tool.name));
  if (tools.length !== options.sourceToolNames.length) throw new Error("One or more selected systems are unavailable.");
  const rows: ReconciliationRow[] = [];
  for (const id of ids) {
    const systems: ReconciliationRow["systems"] = {};
    await Promise.all(tools.map(async (tool) => {
      const raw = await tool.invoke({ applicationMessageId: id });
      const first = items(parseResult(raw))[0];
      // Tool names are namespaced as <server-id>__<tool-name>. Reconciliation
      // compares systems, rather than individual tools, so retain the server
      // identity here. This also prevents two compatible lookup tools from
      // overwriting one another in the result table.
      const key = tool.name.replace(/__.*/u, "");
      if (!first) { systems[key] = { status: "Not found", fields: {} }; return; }
      const fields = Object.fromEntries(options.fields.map((field) => [field, fieldValue(first, field)]).filter(([, value]) => value));
      systems[key] = { status: fieldValue(first, "status") || "Found", fields };
    }));
    const values = Object.values(systems).map((system) => system.status);
    rows.push({ applicationMessageId: id, systems, result: values.length && values.every((value) => value !== "Not found") ? "matched" : "exception" });
  }
  return { rows, generatedAt: new Date().toISOString() };
}
