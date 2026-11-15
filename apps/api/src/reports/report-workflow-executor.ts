import type { AuthenticatedUser } from "../types.js";
import type { PostgresActionPlanStore } from "./action-plan-store.js";
import type { ApprovedPlanExecutor } from "./approved-plan-executor.js";
import type { ReportJobExecutor, ReportJobRecord } from "./types.js";

export class ReportWorkflowExecutor implements ReportJobExecutor {
  constructor(
    private readonly reportExecutor: ReportJobExecutor,
    private readonly actionPlans: PostgresActionPlanStore,
    private readonly approvedPlanExecutor: ApprovedPlanExecutor,
  ) {}

  async execute(job: ReportJobRecord, user: AuthenticatedUser) {
    if (!job.actionPlanId) return this.reportExecutor.execute(job, user);
    const plan = await this.actionPlans.findApproved(user, job.actionPlanId);
    if (!plan) throw new Error("The report job's approved action plan is no longer available.");
    const outcome = await this.approvedPlanExecutor.execute(user, plan);
    await this.actionPlans.recordExecution(user, plan.id, outcome);
    return { html: outcome.html, ...(outcome.errorLog ? { attentionNote: outcome.errorLog } : {}) };
  }
}
