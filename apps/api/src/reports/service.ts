import { randomUUID } from "node:crypto";

import type { AuthenticatedUser } from "../types.js";
import type {
  CreateReportJobInput,
  ReportJobExecutor,
  ReportJobRecord,
  ReportJobRepository,
} from "./types.js";
import type { JobSchedulerClient } from "./job-scheduler.js";

export class ReportJobNotFoundError extends Error {
  constructor() {
    super("Report job not found");
    this.name = "ReportJobNotFoundError";
  }
}

export class ReportJobBusyError extends Error {
  constructor() {
    super("Report job is already running");
    this.name = "ReportJobBusyError";
  }
}

export interface ReportJobSummary {
  id: string;
  title: string;
  sourceToolNames: string[];
  scheduleActive: boolean;
  actionPlanId: string | null;
  scheduledFor: string;
  recurrenceRule: string | null;
  status: ReportJobRecord["status"];
  lastRunStatus: ReportJobRecord["lastRunStatus"];
  finalReportHtml: string | null;
  errorLog: string | null;
  completedAt: string | null;
  createdAt: string;
}

function summary(job: ReportJobRecord): ReportJobSummary {
  return {
    id: job.id,
    title: job.title,
    sourceToolNames: job.sourceToolNames,
    scheduleActive: job.scheduleActive,
    actionPlanId: job.actionPlanId,
    scheduledFor: job.scheduledFor.toISOString(),
    recurrenceRule: job.recurrenceRule,
    status: job.status,
    lastRunStatus: job.lastRunStatus,
    finalReportHtml: job.finalReportHtml,
    errorLog: job.errorLog,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

function nextRecurringTime(rule: string, now = new Date()) {
  const hourly = /^0 (\d{1,2}) \* \* \* \?$/u.exec(rule);
  const daily = /^0 (\d{1,2}) (\d{1,2}) \* \* \?$/u.exec(rule);
  const weekly = /^0 (\d{1,2}) (\d{1,2}) \? \* (\d)$/u.exec(rule);
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  if (hourly) {
    candidate.setUTCMinutes(Number(hourly[1]));
    if (candidate <= now) candidate.setUTCHours(candidate.getUTCHours() + 1);
    return candidate;
  }
  if (daily) {
    candidate.setUTCHours(Number(daily[2]), Number(daily[1]), 0, 0);
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }
  if (weekly) {
    candidate.setUTCHours(Number(weekly[2]), Number(weekly[1]), 0, 0);
    const targetDay = Number(weekly[3]) - 1;
    candidate.setUTCDate(candidate.getUTCDate() + ((targetDay - candidate.getUTCDay() + 7) % 7));
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }
  return undefined;
}

export class ReportJobService {
  readonly #repository: ReportJobRepository;
  readonly #executor: ReportJobExecutor;
  readonly #scheduler: JobSchedulerClient | undefined;
  readonly #schedulerActionUrl: string | undefined;

  constructor(repository: ReportJobRepository, executor: ReportJobExecutor, scheduler?: JobSchedulerClient, schedulerActionUrl?: string) {
    this.#repository = repository;
    this.#executor = executor;
    this.#scheduler = scheduler;
    this.#schedulerActionUrl = schedulerActionUrl;
  }

  async create(user: AuthenticatedUser, input: CreateReportJobInput) {
    const job = await this.#repository.create(user, input);
    if (this.#scheduler && this.#schedulerActionUrl) {
      await this.#repository.setSchedulerJobId(user, job.id, await this.#scheduler.schedule({ reportJobId: job.id, title: job.title, actionUrl: this.#schedulerActionUrl, scheduledFor: job.scheduledFor, recurrenceRule: job.recurrenceRule }));
    }
    return this.get(user, job.id);
  }

  async list(user: AuthenticatedUser) {
    return (await this.#repository.list(user)).map(summary);
  }

  async get(user: AuthenticatedUser, jobId: string) {
    const job = await this.#repository.findOwned(user, jobId);
    if (!job) throw new ReportJobNotFoundError();
    return summary(job);
  }
  async listRuns(user: AuthenticatedUser, jobId: string) { await this.get(user, jobId); return this.#repository.listRuns(user, jobId); }
  async remove(user: AuthenticatedUser, jobId: string) { const job = await this.#repository.findOwned(user, jobId); if (!job) throw new ReportJobNotFoundError(); if (job.schedulerJobId && this.#scheduler) await this.#scheduler.remove(job.schedulerJobId); if (!await this.#repository.delete(user, jobId)) throw new ReportJobBusyError(); }
  async setScheduleActive(user: AuthenticatedUser, jobId: string, active: boolean) { const job = await this.#repository.findOwned(user, jobId); if (!job) throw new ReportJobNotFoundError(); if (job.schedulerJobId && this.#scheduler) await this.#scheduler.setActive(job.schedulerJobId, active); const updated = await this.#repository.setScheduleActive(user, jobId, active); if (!updated) throw new ReportJobBusyError(); return summary(updated); }

  async runNow(user: AuthenticatedUser, jobId: string) {
    const runId = randomUUID();
    const acquisition = await this.#repository.acquireRun(user, jobId, runId);
    if (acquisition.status === "not_found") throw new ReportJobNotFoundError();
    if (acquisition.status === "busy") throw new ReportJobBusyError();
    return this.#executeAcquired(user, jobId, runId, acquisition.job);
  }

  async #executeAcquired(user: AuthenticatedUser, jobId: string, runId: string, job: ReportJobRecord) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.#executor.execute(job, user);
        const nextScheduledFor = job.recurrenceRule ? nextRecurringTime(job.recurrenceRule) : undefined;
        const lastRunStatus = result.attentionNote ? "attention" as const : "succeeded" as const;
        const status = nextScheduledFor ? "scheduled" : lastRunStatus;
        await this.#repository.completeRun(user, jobId, runId, {
          status,
          attemptCount: attempt,
          finalReportHtml: result.html,
          errorLog: result.attentionNote ?? null,
          lastRunStatus,
          ...(nextScheduledFor ? { nextScheduledFor } : {}),
        });
        return summary((await this.#repository.findOwned(user, jobId))!);
      } catch (error) {
        lastError = error;
      }
    }

    const nextScheduledFor = job.recurrenceRule ? nextRecurringTime(job.recurrenceRule) : undefined;
    await this.#repository.completeRun(user, jobId, runId, {
      status: nextScheduledFor ? "scheduled" : "failed",
      attemptCount: 3,
      finalReportHtml: null,
      errorLog: "The report could not be completed after the configured retry limit. Review the job configuration and connected services.",
      lastRunStatus: "failed",
      ...(nextScheduledFor ? { nextScheduledFor } : {}),
    });
    void lastError;
    return summary((await this.#repository.findOwned(user, jobId))!);
  }

  async runScheduled(jobId: string) {
    const runId = randomUUID();
    const acquisition = await this.#repository.acquireScheduledRun(jobId, runId);
    if (acquisition.status === "not_found") throw new ReportJobNotFoundError();
    if (acquisition.status === "busy") throw new ReportJobBusyError();
    return this.#executeAcquired(acquisition.user, jobId, runId, acquisition.job);
  }
}
