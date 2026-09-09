export interface JobSchedulerBinding {
  url: string;
  uaa: { clientid: string; clientsecret: string; url: string };
}

export interface JobSchedulerScheduleInput {
  reportJobId: string;
  title: string;
  actionUrl: string;
  scheduledFor: Date;
  recurrenceRule: string | null;
}

export interface JobSchedulerClient {
  schedule(input: JobSchedulerScheduleInput): Promise<string>;
  setActive(jobId: string, active: boolean): Promise<void>;
  remove(jobId: string): Promise<void>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveJobSchedulerBinding(environment: NodeJS.ProcessEnv = process.env): JobSchedulerBinding | undefined {
  const raw = environment.VCAP_SERVICES;
  if (!raw) return undefined;
  let services: unknown;
  try { services = JSON.parse(raw); } catch { throw new Error("VCAP_SERVICES is invalid JSON"); }
  if (!services || typeof services !== "object") throw new Error("VCAP_SERVICES is invalid");
  const entries = Object.values(services as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value : []);
  const service = entries.find((entry) => entry && typeof entry === "object" && ((entry as { label?: unknown }).label === "jobscheduler" || (entry as { tags?: unknown }).tags instanceof Array && (entry as { tags: unknown[] }).tags.includes("jobscheduler"))) as { credentials?: unknown } | undefined;
  const credentials = service?.credentials;
  if (!credentials || typeof credentials !== "object") return undefined;
  const record = credentials as { url?: unknown; uaa?: unknown };
  const uaa = record.uaa;
  if (!uaa || typeof uaa !== "object") throw new Error("Job Scheduler binding does not use XSUAA authentication");
  const uaaRecord = uaa as { clientid?: unknown; clientsecret?: unknown; url?: unknown };
  const url = readString(record.url);
  const clientid = readString(uaaRecord.clientid);
  const clientsecret = readString(uaaRecord.clientsecret);
  const uaaUrl = readString(uaaRecord.url);
  if (!url || !clientid || !clientsecret || !uaaUrl) throw new Error("Job Scheduler binding is incomplete");
  return { url: url.replace(/\/+$/u, ""), uaa: { clientid, clientsecret, url: uaaUrl.replace(/\/+$/u, "") } };
}

export class SapJobSchedulerClient implements JobSchedulerClient {
  readonly #binding: JobSchedulerBinding;
  readonly #fetch: typeof fetch;

  constructor(binding: JobSchedulerBinding, fetcher: typeof fetch = fetch) {
    this.#binding = binding;
    this.#fetch = fetcher;
  }

  async #token() {
    const credentials = Buffer.from(`${this.#binding.uaa.clientid}:${this.#binding.uaa.clientsecret}`).toString("base64");
    const response = await this.#fetch(`${this.#binding.uaa.url}/oauth/token`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const body = await response.json().catch(() => undefined) as { access_token?: unknown } | undefined;
    if (!response.ok || !body || typeof body.access_token !== "string") throw new Error("Job Scheduler token request failed");
    return body.access_token;
  }

  async #request(path: string, init: RequestInit) {
    const response = await this.#fetch(`${this.#binding.url}${path}`, { ...init, headers: { Authorization: `Bearer ${await this.#token()}`, "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error("Job Scheduler request failed");
    return response;
  }

  async schedule(input: JobSchedulerScheduleInput) {
    const response = await this.#request("/scheduler/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: `flowpilot-report-${input.reportJobId}`,
        description: input.title.slice(0, 120),
        action: input.actionUrl,
        httpMethod: "POST",
        active: true,
        schedules: [{
          description: `FlowPilot report ${input.reportJobId}`,
          data: { reportJobId: input.reportJobId },
          active: true,
          ...(input.recurrenceRule ? { cron: input.recurrenceRule } : { time: input.scheduledFor.toISOString() }),
        }],
      }),
    });
    const body = await response.json().catch(() => undefined) as { id?: unknown } | undefined;
    if (!body || (typeof body.id !== "number" && typeof body.id !== "string")) throw new Error("Job Scheduler did not return a job ID");
    return String(body.id);
  }
  async setActive(jobId: string, active: boolean) { await this.#request(`/scheduler/jobs/${encodeURIComponent(jobId)}/schedules/activationStatus`, { method: "POST", body: JSON.stringify({ activationStatus: active }) }); }
  async remove(jobId: string) { await this.#request(`/scheduler/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }); }
}
