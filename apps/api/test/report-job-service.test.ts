import { describe, expect, it, vi } from "vitest";

import { ReportJobService } from "../src/reports/service.js";
import type { ReportJobRecord, ReportJobRepository } from "../src/reports/types.js";

const user = { tenantId: "tenant-a", subject: "user-a", scopes: ["ChatUser"] };

function job(overrides: Partial<ReportJobRecord> = {}): ReportJobRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Daily integration summary",
    reportPrompt: "Summarize the final state.",
    scheduledFor: new Date("2026-09-10T08:00:00.000Z"),
    recurrenceRule: null,
    status: "scheduled",
    attemptCount: 0,
    finalReportHtml: null,
    errorLog: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-09-09T08:00:00.000Z"),
    updatedAt: new Date("2026-09-09T08:00:00.000Z"),
    ...overrides,
  };
}

function repository(record = job()): ReportJobRepository {
  return {
    create: vi.fn().mockResolvedValue(record),
    list: vi.fn().mockResolvedValue([record]),
    findOwned: vi.fn().mockResolvedValue(record),
    acquireRun: vi.fn().mockResolvedValue({ status: "acquired", job: record }),
    acquireScheduledRun: vi.fn().mockResolvedValue({ status: "acquired", job: record, user }),
    completeRun: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ReportJobService", () => {
  it("retries transient executor failures and exposes only the final successful report", async () => {
    const jobs = repository();
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary upstream failure"))
      .mockRejectedValueOnce(new Error("temporary upstream failure"))
      .mockResolvedValue({ html: "<h1>Completed</h1>" });
    const service = new ReportJobService(jobs, { execute });

    await service.runNow(user, job().id);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(jobs.completeRun).toHaveBeenCalledWith(
      user,
      job().id,
      expect.any(String),
      expect.objectContaining({ status: "succeeded", attemptCount: 3, errorLog: null }),
    );
  });

  it("records one final safe roadblock after the retry budget is exhausted", async () => {
    const jobs = repository();
    const service = new ReportJobService(jobs, { execute: vi.fn().mockRejectedValue(new Error("secret upstream detail")) });

    await service.runNow(user, job().id);

    expect(jobs.completeRun).toHaveBeenCalledWith(
      user,
      job().id,
      expect.any(String),
      expect.objectContaining({ status: "failed", attemptCount: 3, errorLog: expect.not.stringContaining("secret") }),
    );
  });
});
