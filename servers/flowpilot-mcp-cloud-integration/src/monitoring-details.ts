import { createConfiguredDestinationResolver } from "./destination.js";
import { MPL_DESTINATION_NAME, type DestinationResolver } from "./mpl.js";

const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 10_000;
function safe(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid " + label);
  return value;
}
function quote(value: string): string { return "'" + value.replaceAll("'", "''") + "'"; }
export class MonitoringDetailsClient {
  readonly #resolver: DestinationResolver;
  readonly #fetch: typeof fetch;
  constructor(resolver: DestinationResolver = createConfiguredDestinationResolver(), fetchImpl: typeof fetch = fetch) { this.#resolver = resolver; this.#fetch = fetchImpl; }
  async #get(path: string): Promise<unknown> {
    const destination = await this.#resolver.resolve(MPL_DESTINATION_NAME);
    const url = new URL(destination.url);
    url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/api\/v1$/u, "") + "/api/v1/" + path;
    const response = await this.#fetch(url, { headers: { ...destination.headers, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    if (!response.ok) throw new Error("SAP request failed (" + response.status + ")");
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw new Error("SAP response is too large");
    return JSON.parse(body);
  }
  messageStatus(messageId: unknown) { return this.#get("MessageProcessingLogs(" + quote(safe(messageId, "message ID")) + ")"); }
  messageLog(messageId: unknown) { return this.#get("MessageProcessingLogs(" + quote(safe(messageId, "message ID")) + ")?$expand=AdapterAttributes"); }
  attachments(messageId: unknown) { return this.#get("MessageProcessingLogs(" + quote(safe(messageId, "message ID")) + ")/Attachments"); }
  attachment(messageId: unknown, attachmentId: unknown) { return this.#get("MessageProcessingLogs(" + quote(safe(messageId, "message ID")) + ")/Attachments(" + quote(safe(attachmentId, "attachment ID")) + ")"); }
  customHeaders(messageId: unknown) { return this.#get("MessageProcessingLogs(" + quote(safe(messageId, "message ID")) + ")/CustomHeaderProperties"); }
}
