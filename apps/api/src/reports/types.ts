import type { AuthenticatedUser } from "../types.js";

export const REPORT_JOB_STATUSES = [
  "scheduled",
  "running",
  "succeeded",
  "attention",
  "failed",
] as const;

export type ReportJobStatus = (typeof REPORT_JOB_STATUSES)[number];

export interface ReportJobRecord {
  id: string;
  title: string;
  reportPrompt: string;
  sourceToolNames: string[];
  schedulerJobId: string | null;
  scheduleActive: boolean;
  actionPlanId: string | null;
  scheduledFor: Date;
  recurrenceRule: string | null;
  status: ReportJobStatus;
  lastRunStatus: Extract<ReportJobStatus, "succeeded" | "attention" | "failed"> | null;
  attemptCount: number;
  finalReportHtml: string | null;
  errorLog: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportJobInput {
  title: string;
  reportPrompt: string;
  sourceToolNames?: string[];
  actionPlanId?: string | null;
  scheduledFor: Date;
  recurrenceRule?: string | null;
}

export interface ReportExecutionResult {
  html: string;
  attentionNote?: string;
}
export interface ReportJobRunRecord { id: string; reportJobId: string; status: Extract<ReportJobStatus, "succeeded" | "attention" | "failed">; attemptCount: number; finalReportHtml: string | null; errorLog: string | null; startedAt: Date | null; completedAt: Date; }

export interface ReportJobExecutor {
  execute(job: ReportJobRecord, user: AuthenticatedUser): Promise<ReportExecutionResult>;
}

export type ReportRunAcquisition =
  | { status: "acquired"; job: ReportJobRecord }
  | { status: "busy" }
  | { status: "not_found" };

export type ScheduledReportRunAcquisition =
  | { status: "acquired"; job: ReportJobRecord; user: AuthenticatedUser }
  | { status: "busy" }
  | { status: "not_found" };

export interface ReportJobRepository {
  create(user: AuthenticatedUser, input: CreateReportJobInput): Promise<ReportJobRecord>;
  list(user: AuthenticatedUser): Promise<ReportJobRecord[]>;
  findOwned(user: AuthenticatedUser, jobId: string): Promise<ReportJobRecord | undefined>;
  acquireRun(user: AuthenticatedUser, jobId: string, runId: string): Promise<ReportRunAcquisition>;
  acquireScheduledRun(jobId: string, runId: string): Promise<ScheduledReportRunAcquisition>;
  completeRun(
    user: AuthenticatedUser,
    jobId: string,
    runId: string,
    outcome: Pick<ReportJobRecord, "status" | "attemptCount" | "finalReportHtml" | "errorLog" | "lastRunStatus"> & { nextScheduledFor?: Date },
  ): Promise<void>;
  listRuns(user: AuthenticatedUser, jobId: string): Promise<ReportJobRunRecord[]>;
  setSchedulerJobId(user: AuthenticatedUser, jobId: string, schedulerJobId: string | null): Promise<void>;
  setScheduleActive(user: AuthenticatedUser, jobId: string, active: boolean): Promise<ReportJobRecord | undefined>;
  delete(user: AuthenticatedUser, jobId: string): Promise<boolean>;
}
