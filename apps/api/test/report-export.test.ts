import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { exportReport, htmlToMarkdown, ReportNotReadyError } from "../src/reports/report-export.js";
import type { ReportJobSummary } from "../src/reports/service.js";

const job: ReportJobSummary = {
  id: "11111111-1111-4111-8111-111111111111", title: "Integration result", actionPlanId: null, scheduledFor: "2026-09-09T00:00:00.000Z", recurrenceRule: null, status: "succeeded", lastRunStatus: "succeeded", finalReportHtml: "<!doctype html><html><head><style>ignore</style></head><body><h1>Integration result</h1><p>All flows completed.</p><table><tr><th>Flow</th><th>Status</th></tr><tr><td>iflow1</td><td>Completed</td></tr></table></body></html>", errorLog: null, completedAt: "2026-09-09T00:01:00.000Z", createdAt: "2026-09-09T00:00:00.000Z",
};

describe("report exports", () => {
  it("renders the final HTML as readable Markdown", () => {
    expect(htmlToMarkdown(job.finalReportHtml!)).toContain("# Integration result");
    const output = exportReport(job, "markdown");
    expect(output.fileName).toBe("Integration-result.md");
    expect(output.body).toContain("All flows completed.");
  });

  it("creates a readable Excel report only at export time", () => {
    const output = exportReport(job, "xlsx");
    const workbook = XLSX.read(output.body as Buffer, { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Report"]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Report, { header: 1 })).toContainEqual(["Flow", "Status"]);
  });

  it("does not export an unfinished report", () => {
    expect(() => exportReport({ ...job, finalReportHtml: null }, "html")).toThrow(ReportNotReadyError);
  });
});
