import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { quoteIdentifier } from "../db/migrations.js";
import type { AuthenticatedUser } from "../types.js";
import type {
  CreateReportJobInput,
  ReportJobRecord,
  ReportJobRepository,
  ReportRunAcquisition,
} from "./types.js";

interface ReportJobRow {
  id: string;
  title: string;
  report_prompt: string;
  scheduler_job_id: string | null;
  schedule_active: boolean;
  source_tool_names: string[];
  action_plan_id: string | null;
  scheduled_for: Date;
  recurrence_rule: string | null;
  status: ReportJobRecord["status"];
  last_run_status: ReportJobRecord["lastRunStatus"];
  attempt_count: number;
  final_report_html: string | null;
  error_log: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function record(row: ReportJobRow): ReportJobRecord {
  return {
    id: row.id,
    title: row.title,
    reportPrompt: row.report_prompt,
    schedulerJobId: row.scheduler_job_id,
    scheduleActive: row.schedule_active,
    sourceToolNames: row.source_tool_names,
    actionPlanId: row.action_plan_id,
    scheduledFor: row.scheduled_for,
    recurrenceRule: row.recurrence_rule,
    status: row.status,
    lastRunStatus: row.last_run_status,
    attemptCount: row.attempt_count,
    finalReportHtml: row.final_report_html,
    errorLog: row.error_log,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresReportJobRepository implements ReportJobRepository {
  readonly #pool: Pool;
  readonly #table: string; readonly #runsTable: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    this.#table = `${quoteIdentifier(schemaName)}.report_jobs`;
    this.#runsTable = `${quoteIdentifier(schemaName)}.report_job_runs`;
  }

  async #withIdentity<T>(user: AuthenticatedUser, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('flowpilot.tenant_id', $1, true), set_config('flowpilot.subject_id', $2, true)",
        [user.tenantId, user.subject],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async create(user: AuthenticatedUser, input: CreateReportJobInput) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ReportJobRow>(
        `INSERT INTO ${this.#table} (id, tenant_id, subject_id, title, report_prompt, source_tool_names, action_plan_id, scheduled_for, recurrence_rule)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [randomUUID(), user.tenantId, user.subject, input.title, input.reportPrompt, input.sourceToolNames ?? [], input.actionPlanId ?? null, input.scheduledFor, input.recurrenceRule ?? null],
      );
      return record(result.rows[0]);
    });
  }

  async list(user: AuthenticatedUser) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ReportJobRow>(
        `SELECT * FROM ${this.#table}
         ORDER BY CASE WHEN status IN ('scheduled', 'running') THEN 0 ELSE 1 END, scheduled_for ASC, completed_at DESC NULLS LAST, id DESC`,
      );
      return result.rows.map(record);
    });
  }

  async findOwned(user: AuthenticatedUser, jobId: string) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ReportJobRow>(`SELECT * FROM ${this.#table} WHERE id = $1`, [jobId]);
      return result.rows[0] ? record(result.rows[0]) : undefined;
    });
  }

  async acquireRun(user: AuthenticatedUser, jobId: string, runId: string): Promise<ReportRunAcquisition> {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<ReportJobRow>(
        `UPDATE ${this.#table}
            SET status = 'running', active_run_id = $2, started_at = now(), attempt_count = 0, updated_at = now()
          WHERE id = $1 AND (active_run_id IS NULL OR started_at < now() - interval '10 minutes')
          RETURNING *`,
        [jobId, runId],
      );
      if (result.rows[0]) return { status: "acquired", job: record(result.rows[0]) };
      const existing = await client.query(`SELECT id FROM ${this.#table} WHERE id = $1`, [jobId]);
      return existing.rowCount ? { status: "busy" } : { status: "not_found" };
    });
  }

  async acquireScheduledRun(jobId: string, runId: string) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('flowpilot.scheduler', 'true', true)");
      const result = await client.query<ReportJobRow & { tenant_id: string; subject_id: string }>(
        `UPDATE ${this.#table}
            SET status = 'running', active_run_id = $2, started_at = now(), attempt_count = 0, updated_at = now()
          WHERE id = $1 AND (active_run_id IS NULL OR started_at < now() - interval '10 minutes')
          RETURNING *`, [jobId, runId],
      );
      if (result.rows[0]) {
        await client.query("COMMIT");
        const row = result.rows[0];
        return { status: "acquired" as const, job: record(row), user: { tenantId: row.tenant_id, subject: row.subject_id, scopes: ["ChatUser"] } };
      }
      const existing = await client.query(`SELECT id FROM ${this.#table} WHERE id = $1`, [jobId]);
      await client.query("COMMIT");
      return existing.rowCount ? { status: "busy" as const } : { status: "not_found" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async completeRun(user: AuthenticatedUser, jobId: string, runId: string, outcome: Pick<ReportJobRecord, "status" | "attemptCount" | "finalReportHtml" | "errorLog" | "lastRunStatus"> & { nextScheduledFor?: Date }) {
    await this.#withIdentity(user, async (client) => {
      await client.query(
        `UPDATE ${this.#table}
            SET status = $3, active_run_id = NULL, attempt_count = $4, scheduled_for = COALESCE($7, scheduled_for),
                final_report_html = $5, error_log = $6, last_run_status = $8, completed_at = now(), updated_at = now()
          WHERE id = $1 AND active_run_id = $2`,
        [jobId, runId, outcome.status, outcome.attemptCount, outcome.finalReportHtml, outcome.errorLog, outcome.nextScheduledFor ?? null, outcome.lastRunStatus],
      );
      await client.query(`INSERT INTO ${this.#runsTable} (id, report_job_id, tenant_id, subject_id, status, attempt_count, final_report_html, error_log, started_at) SELECT $1, id, tenant_id, subject_id, $2, $3, $4, $5, started_at FROM ${this.#table} WHERE id=$6`, [randomUUID(), outcome.lastRunStatus, outcome.attemptCount, outcome.finalReportHtml, outcome.errorLog, jobId]);
    });
  }
  async listRuns(user: AuthenticatedUser, jobId: string) { return this.#withIdentity(user, async (client) => { const result = await client.query<import("./types.js").ReportJobRunRecord & { report_job_id: string; attempt_count: number; final_report_html: string | null; error_log: string | null; started_at: Date | null; completed_at: Date }>(`SELECT * FROM ${this.#runsTable} WHERE report_job_id=$1 ORDER BY completed_at DESC`, [jobId]); return result.rows.map((row) => ({ id: row.id, reportJobId: row.report_job_id, status: row.status, attemptCount: row.attempt_count, finalReportHtml: row.final_report_html, errorLog: row.error_log, startedAt: row.started_at, completedAt: row.completed_at })); }); }
  async setSchedulerJobId(user: AuthenticatedUser, jobId: string, schedulerJobId: string | null) { await this.#withIdentity(user, async (client) => { await client.query(`UPDATE ${this.#table} SET scheduler_job_id=$2, updated_at=now() WHERE id=$1`, [jobId, schedulerJobId]); }); }
  async setScheduleActive(user: AuthenticatedUser, jobId: string, active: boolean) { return this.#withIdentity(user, async (client) => { const result = await client.query<ReportJobRow>(`UPDATE ${this.#table} SET schedule_active=$2, updated_at=now() WHERE id=$1 AND active_run_id IS NULL RETURNING *`, [jobId, active]); return result.rows[0] ? record(result.rows[0]) : undefined; }); }
  async delete(user: AuthenticatedUser, jobId: string) { return this.#withIdentity(user, async (client) => (await client.query(`DELETE FROM ${this.#table} WHERE id=$1 AND active_run_id IS NULL`, [jobId])).rowCount === 1); }
}
