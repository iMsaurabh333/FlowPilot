import * as XLSX from "xlsx";

import type { ReportJobSummary } from "./service.js";

export type ReportExportFormat = "html" | "markdown" | "xlsx";

export class ReportNotReadyError extends Error {
  constructor() { super("Report output is not available yet"); this.name = "ReportNotReadyError"; }
}

function decode(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity] ?? entity);
}

export function htmlToMarkdown(html: string) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<head[\s\S]*?<\/head>/giu, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/giu, "# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/giu, "## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/giu, "### $1\n\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>|<\/section>|<\/tr>/giu, "\n")
    .replace(/<t[hd][^>]*>/giu, "| ")
    .replace(/<\/t[hd]>/giu, " ")
    .replace(/<[^>]+>/gu, "");
  return decode(text).replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim() + "\n";
}

function tableRows(html: string) {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/giu)].map((cell) => decode(cell[1].replace(/<[^>]+>/gu, "").trim()));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function exportReport(job: ReportJobSummary, format: ReportExportFormat) {
  if (!job.finalReportHtml) throw new ReportNotReadyError();
  const baseName = job.title.replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80) || "report";
  if (format === "html") return { body: job.finalReportHtml, contentType: "text/html; charset=utf-8", fileName: `${baseName}.html` };
  const markdown = htmlToMarkdown(job.finalReportHtml);
  if (format === "markdown") return { body: markdown, contentType: "text/markdown; charset=utf-8", fileName: `${baseName}.md` };
  const workbook = XLSX.utils.book_new();
  const rows = tableRows(job.finalReportHtml);
  const summary = [["Report", job.title], ["Final status", job.lastRunStatus ?? job.status], ["Completed", job.completedAt ?? ""], [], ["Report content"], [markdown]];
  const sheet = XLSX.utils.aoa_to_sheet(summary);
  if (rows.length) XLSX.utils.sheet_add_aoa(sheet, [["Report table"], ...rows], { origin: -1 });
  sheet["!cols"] = [{ wch: 28 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  return { body: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: `${baseName}.xlsx` };
}
