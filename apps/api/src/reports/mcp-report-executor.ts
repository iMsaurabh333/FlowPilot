import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage, ChatTool } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { OperationLogService } from "../operation-log.js";
import type { ReportJobExecutor, ReportJobRecord } from "./types.js";

const readOnlyToolName = /(?:^|__)(?:search|get|list)_/u;
const forbiddenToolName =
  /(?:deploy|undeploy|update|delete|create|set|configure|write)/iu;

export interface ReportSource {
  name: string;
  description: string;
  displayName?: string;
}
export function reportOnlyTools(tools: ChatTool[]) {
  return tools.filter(
    (tool) =>
      readOnlyToolName.test(tool.name) && !forbiddenToolName.test(tool.name),
  );
}

/**
 * Read-only tools that can be invoked through an Active Identifier Type.
 * The identifier definition supplies the business-value-to-tool-parameter
 * mapping, so tools are not limited to a literal applicationMessageId input.
 */
export function reconciliationLookupTools(tools: ChatTool[]) {
  // An App Admin explicitly tests and activates the tool used by an Identifier
  // Type. Do not restrict reconciliation to a small set of name prefixes:
  // every configured MCP server can participate when it has a safe, callable
  // tool and an Active identifier definition.
  return tools.filter((tool) => !forbiddenToolName.test(tool.name));
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

const permittedReportTags = new Set([
  "article",
  "blockquote",
  "br",
  "caption",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
]);

function htmlFragment(value: string) {
  const withoutFence = value
    .trim()
    .replace(/^```(?:html)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const body =
    /<body\b[^>]*>([\s\S]*?)<\/body\s*>/iu.exec(withoutFence)?.[1] ??
    withoutFence;
  const withoutDocumentTags = body
    .replace(/<!doctype[^>]*>/giu, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/giu, "");

  return withoutDocumentTags
    .replace(
      /<(?:embed|iframe|math|object|script|style|svg)\b[^>]*>[\s\S]*?<\/(?:embed|iframe|math|object|script|style|svg)\s*>/giu,
      "",
    )
    .replace(/<\/?([a-z0-9-]+)(?:\s[^>]*)?>/giu, (tag, name: string) => {
      const normalizedName = name.toLowerCase();
      if (!permittedReportTags.has(normalizedName)) return "";
      return tag.startsWith("</")
        ? `</${normalizedName}>`
        : `<${normalizedName}>`;
    });
}

function isHtml(value: string) {
  return /<\/?(?:article|body|div|h[1-6]|html|main|ol|p|section|table|ul)\b|<!doctype\s+html/iu.test(
    value,
  );
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/gu, "<strong>$1</strong>")
    .replace(/(?:\*|_)([^*_]+)(?:\*|_)/gu, "<em>$1</em>");
}

function tableCells(value: string) {
  return value
    .trim()
    .replace(/^\||\|$/gu, "")
    .split("|")
    .map((cell) => inlineMarkdown(cell.trim()));
}

function isMarkdownTableSeparator(value: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(value);
}

function markdownReport(value: string) {
  const lines = value.trim().split(/\r?\n/u);
  const parts: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      parts.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (
      index + 1 < lines.length &&
      line.includes("|") &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(
          `<tr>${tableCells(lines[index])
            .map((cell) => `<td>${cell}</td>`)
            .join("")}</tr>`,
        );
        index += 1;
      }
      parts.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`,
      );
      continue;
    }
    const unordered = /^[-*+]\s+(.+)$/u.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      const pattern = unordered ? /^[-*+]\s+(.+)$/u : /^\d+[.)]\s+(.+)$/u;
      const items: string[] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index].trim());
        if (!item) break;
        items.push(`<li>${inlineMarkdown(item[1])}</li>`);
        index += 1;
      }
      parts.push(
        `<${unordered ? "ul" : "ol"}>${items.join("")}</${unordered ? "ul" : "ol"}>`,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+|^[-*+]\s+|^\d+[.)]\s+/u.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    parts.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return parts.join("");
}

interface ReportEvidence { toolName: string; content: string; }
interface EvidenceTable { title: string; columns: string[]; rows: string[][]; }
const MODEL_EVIDENCE_MAX_CHARS = 6_000;
const EVIDENCE_SAMPLE_SIZE = 20;
const EVIDENCE_TABLE_ROW_LIMIT = 500;

function compactValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (depth >= 2) return "[nested value omitted]";
  if (Array.isArray(value)) return { count: value.length, sample: value.slice(0, EVIDENCE_SAMPLE_SIZE).map((item) => compactValue(item, depth + 1)) };
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 24).map(([key, item]) => [key, compactValue(item, depth + 1)]));
  return String(value);
}

function compactToolResult(content: string) {
  try {
    const compact = JSON.stringify(compactValue(JSON.parse(content)));
    return compact.length > MODEL_EVIDENCE_MAX_CHARS ? `${compact.slice(0, MODEL_EVIDENCE_MAX_CHARS)}…[truncated]` : compact;
  } catch {
    return content.length > MODEL_EVIDENCE_MAX_CHARS ? `${content.slice(0, MODEL_EVIDENCE_MAX_CHARS)}…[truncated]` : content;
  }
}

function tableValue(value: unknown) {
  const text = value === null || value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
}

function evidenceTables(evidence: ReportEvidence[]): EvidenceTable[] {
  return evidence.flatMap(({ toolName, content }) => {
    try {
      const parsed = JSON.parse(content) as unknown;
      const records = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [];
      const objects = records.filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null && !Array.isArray(record));
      if (objects.length === 0) return [];
      const columns = [...new Set(objects.flatMap((record) => Object.keys(record)))].slice(0, 24);
      return [{ title: `Source data · ${toolName.replace(/^.+__/, "")}`, columns, rows: objects.slice(0, EVIDENCE_TABLE_ROW_LIMIT).map((record) => columns.map((column) => tableValue(record[column]))) }];
    } catch { return []; }
  });
}

function htmlReport(job: ReportJobRecord, response: ChatMessage | undefined, evidence: ReportEvidence[]) {
  if (!response)
    throw new Error("Report model did not produce a final response");
  const sources = response.sources?.length
    ? `<p><strong>Sources:</strong> ${response.sources.map((source) => escapeHtml(source.label)).join(" · ")}</p>`
    : "";
  const tables =
    response.tables
      ?.map(
        (table) =>
          `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`,
      )
      .join("") ?? "";
  const sourceDataTables = evidenceTables(evidence)
    .map((table) => `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`)
    .join("");
  const content = isHtml(response.content)
    ? htmlFragment(response.content)
    : `<h1>${escapeHtml(job.title)}</h1><p><strong>Final status:</strong> Completed</p>${markdownReport(response.content)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(job.title)}</title><style>body{font:14px Arial,sans-serif;color:#223548;margin:2rem;line-height:1.5}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d9d9;padding:.5rem;text-align:left}th{background:#f5f6f7}</style></head><body><main>${content}${sources}${tables}${sourceDataTables}</main></body></html>`;
}

export class McpReportExecutor implements ReportJobExecutor {
  readonly #agent: ChatAgent;
  readonly #resolveTools: (user: AuthenticatedUser, jobId: string) => Promise<ChatTool[]>;
  readonly #operationLogs: OperationLogService | undefined;
  constructor(options: {
    agent: ChatAgent;
    resolveTools: (user: AuthenticatedUser, jobId: string) => Promise<ChatTool[]>;
    operationLogs?: OperationLogService;
  }) {
    this.#agent = options.agent;
    this.#resolveTools = options.resolveTools;
    this.#operationLogs = options.operationLogs;
  }

  async execute(job: ReportJobRecord, user: AuthenticatedUser) {
    const available = reportOnlyTools(await this.#resolveTools(user, job.id));
    const allowed = new Set(job.sourceToolNames);
    const tools = allowed.size
      ? available.filter((tool) => allowed.has(tool.name))
      : available;
    if (tools.length === 0) {
      void this.#operationLogs?.record(user, { surface: "report", eventType: "error", title: `No report source available · ${job.title}`, reportJobId: job.id, detail: { configuredSourceTools: job.sourceToolNames, availableReadOnlyTools: available.map((tool) => tool.name) } });
      throw new Error("No approved, healthy read-only MCP report source is available for this job.");
    }
    const evidence: ReportEvidence[] = [];
    const modelTools = tools.map((tool) => ({
      ...tool,
      invoke: async (input: Record<string, unknown>) => {
        const content = await tool.invoke(input);
        evidence.push({ toolName: tool.name, content });
        return compactToolResult(content);
      },
    }));
    const now = new Date().toISOString();
    const instruction = `Generate the final operational report requested below. You MUST invoke an available read-only tool before making any data claim; do not produce an evidence-free report. The current UTC time is ${now}. For a request concerning “today”, calculate the UTC start and end of today's reporting window and pass the exact timestamps required by the selected tool schema. Use only the available read-only tools when evidence is needed. Never deploy, undeploy, update, delete, create, configure, or change anything. Do not report transient failed attempts that later succeeded. State unresolved limitations clearly.\n\n${job.reportPrompt}`;
    void this.#operationLogs?.record(user, { surface: "report", eventType: "llm_input", title: `Report job · ${job.title}`, reportJobId: job.id, detail: { instruction, availableTools: modelTools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })), modelEvidenceLimitChars: MODEL_EVIDENCE_MAX_CHARS } });
    let messages: ChatMessage[];
    try {
      messages = await this.#agent.sendMessage(randomUUID(), instruction, modelTools);
    } catch (error) {
      void this.#operationLogs?.record(user, { surface: "report", eventType: "error", title: `Report execution failed · ${job.title}`, reportJobId: job.id, detail: { errorType: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "Unknown failure" } });
      throw error;
    }
    const response = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    return { html: htmlReport(job, response, evidence) };
  }
}
