import { randomUUID } from "node:crypto";

import type { ChatAgent, ChatMessage, ChatTool } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { ReportJobExecutor, ReportJobRecord } from "./types.js";

const readOnlyToolName = /(?:^|__)(?:search|get|list)_/u;
const forbiddenToolName = /(?:deploy|undeploy|update|delete|create|set|configure|write)/iu;

export interface ReportSource { name: string; description: string; }
export function reportOnlyTools(tools: ChatTool[]) { return tools.filter((tool) => readOnlyToolName.test(tool.name) && !forbiddenToolName.test(tool.name)); }

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function htmlReport(job: ReportJobRecord, response: ChatMessage | undefined) {
  if (!response) throw new Error("Report model did not produce a final response");
  const sources = response.sources?.length ? `<p><strong>Sources:</strong> ${response.sources.map((source) => escapeHtml(source.label)).join(" · ")}</p>` : "";
  const tables = response.tables?.map((table) => `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`).join("") ?? "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(job.title)}</title><style>body{font:14px Arial,sans-serif;color:#223548;margin:2rem;line-height:1.5}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d9d9;padding:.5rem;text-align:left}th{background:#f5f6f7}</style></head><body><main><h1>${escapeHtml(job.title)}</h1><p><strong>Final status:</strong> Completed</p><p>${escapeHtml(response.content).replace(/\n/g, "<br>")}</p>${sources}${tables}</main></body></html>`;
}

export class McpReportExecutor implements ReportJobExecutor {
  readonly #agent: ChatAgent;
  readonly #resolveTools: (user: AuthenticatedUser) => Promise<ChatTool[]>;
  constructor(options: { agent: ChatAgent; resolveTools: (user: AuthenticatedUser) => Promise<ChatTool[]> }) {
    this.#agent = options.agent;
    this.#resolveTools = options.resolveTools;
  }

  async execute(job: ReportJobRecord, user: AuthenticatedUser) {
    const available = reportOnlyTools(await this.#resolveTools(user));
    const allowed = new Set(job.sourceToolNames);
    const tools = allowed.size ? available.filter((tool) => allowed.has(tool.name)) : available;
    const messages = await this.#agent.sendMessage(randomUUID(), `Generate the final operational report requested below. Use only the available read-only tools when evidence is needed. Never deploy, undeploy, update, delete, create, configure, or change anything. Do not report transient failed attempts that later succeeded. State unresolved limitations clearly.\n\n${job.reportPrompt}`, tools);
    const response = [...messages].reverse().find((message) => message.role === "assistant");
    return { html: htmlReport(job, response) };
  }
}
