import { createHash } from "node:crypto";
import { fromJsonSchema, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { createConfiguredDestinationResolver } from "./destination.js";
import { CONTENT_DESTINATION_NAME, type DestinationResolver } from "./mpl.js";
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_VERSION } from "./constants.js";

const MAX_ITEMS = 100;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 15_000;
const PARALLELISM = 4;
type Operation = "deploy" | "undeploy" | "update_configuration";
interface PlanRow { operation: Operation; artifactId: string; version?: string; configurationName?: string; configurationValue?: string; sequence?: number; }

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function safe(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid " + label);
  return value;
}
function limit(value: unknown): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_ITEMS) throw new Error("Invalid limit");
  return value as number;
}
function quote(value: string): string { return "'" + value.replaceAll("'", "''") + "'"; }
function entity(id: string, version?: string): string {
  return version === undefined ? "IntegrationDesigntimeArtifacts(" + quote(id) + ")" : "IntegrationDesigntimeArtifacts(Id=" + quote(id) + ",Version=" + quote(version) + ")";
}
function rows(value: unknown): unknown[] {
  if (!object(value) || !object(value.d) || !Array.isArray(value.d.results)) throw new Error("Invalid SAP OData response");
  return value.d.results;
}
function parsePlan(value: unknown): PlanRow[] {
  if (!object(value) || !Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 100) throw new Error("A plan must contain 1 to 100 operations");
  return value.operations.map((raw) => {
    if (!object(raw) || (raw.operation !== "deploy" && raw.operation !== "undeploy" && raw.operation !== "update_configuration")) throw new Error("Invalid plan operation");
    const row: PlanRow = { operation: raw.operation, artifactId: safe(raw.artifactId, "artifact ID") };
    if (raw.version !== undefined) row.version = safe(raw.version, "version");
    if (raw.configurationName !== undefined) row.configurationName = safe(raw.configurationName, "configuration name");
    if (raw.configurationValue !== undefined) row.configurationValue = safe(raw.configurationValue, "configuration value");
    if (raw.sequence !== undefined) {
      if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1 || (raw.sequence as number) > 10_000) throw new Error("Invalid sequence");
      row.sequence = raw.sequence as number;
    }
    if (row.operation === "deploy" && !row.version) throw new Error("Deploy requires an explicit version");
    if (row.operation === "update_configuration" && (!row.version || !row.configurationName || row.configurationValue === undefined)) throw new Error("Configuration update requires version, name, and value");
    return row;
  });
}
function confirmation(plan: PlanRow[]): string { return createHash("sha256").update(JSON.stringify(plan)).digest("hex"); }

export class ContentClient {
  readonly #resolver: DestinationResolver;
  readonly #fetch: typeof fetch;
  constructor(resolver: DestinationResolver = createConfiguredDestinationResolver(), fetchImpl: typeof fetch = fetch) { this.#resolver = resolver; this.#fetch = fetchImpl; }
  async #request(path: string, init: RequestInit = {}, csrf = false): Promise<unknown> {
    const destination = await this.#resolver.resolve(CONTENT_DESTINATION_NAME);
    const url = new URL(destination.url);
    const [pathName, query = ""] = path.split("?", 2);
    url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/api\/v1$/u, "") + "/api/v1/" + pathName.replace(/^\//u, "");
    url.search = query;
    const headers = new Headers(destination.headers);
    headers.set("Accept", "application/json");
    if (csrf) {
      const tokenResponse = await this.#fetch(url, { method: "HEAD", headers: { ...destination.headers, "X-CSRF-Token": "Fetch" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const token = tokenResponse.headers.get("x-csrf-token");
      if (!tokenResponse.ok || !token) throw new Error("SAP CSRF token acquisition failed");
      headers.set("X-CSRF-Token", token);
      const cookie = tokenResponse.headers.get("set-cookie");
      if (cookie) headers.set("Cookie", cookie);
    }
    const response = await this.#fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw new Error("SAP response is too large");
    if (!response.ok) throw new Error("SAP request failed (" + response.status + ")");
    return body ? JSON.parse(body) : {};
  }
  listPackages(value: unknown) { return this.#request("IntegrationPackages?$top=" + limit(value)).then(rows); }
  listPackageFlows(id: unknown, value: unknown) { return this.#request("IntegrationPackages(" + quote(safe(id, "package ID")) + ")/IntegrationDesigntimeArtifacts?$top=" + limit(value)).then(rows); }
  getArtifact(id: unknown) { return this.#request("IntegrationRuntimeArtifacts(" + quote(safe(id, "artifact ID")) + ")"); }
  configurations(id: unknown, version: unknown, value: unknown) { return this.#request(entity(safe(id, "artifact ID"), safe(version, "version")) + "/Configurations?$top=" + limit(value)).then(rows); }
  resources(id: unknown, version: unknown, value: unknown) { return this.#request(entity(safe(id, "artifact ID"), safe(version, "version")) + "/Resources?$top=" + limit(value)).then(rows); }
  deploy(row: PlanRow) { return this.#request("DeployIntegrationDesigntimeArtifact?Id=" + encodeURIComponent(quote(row.artifactId)) + "&Version=" + encodeURIComponent(quote(row.version!)), { method: "POST" }, true); }
  undeploy(row: PlanRow) { return this.#request("IntegrationRuntimeArtifacts(" + quote(row.artifactId) + ")", { method: "DELETE" }, true); }
  update(row: PlanRow) { return this.#request(entity(row.artifactId, row.version) + "/$links/Configurations(" + quote(row.configurationName!) + ")", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ParameterKey: row.configurationName, ParameterValue: row.configurationValue, DataType: "xsd:string" }) }, true); }
}

function ok(value: unknown): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function fail(error: unknown): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "content_request_failed", message: error instanceof Error ? error.message : "Request failed" }) }] }; }
const readInput = fromJsonSchema<Record<string, unknown>>({ type: "object", additionalProperties: false, properties: { artifactId: { type: "string", maxLength: 256 }, packageId: { type: "string", maxLength: 256 }, version: { type: "string", maxLength: 256 }, limit: { type: "integer", minimum: 1, maximum: MAX_ITEMS } } });
const planInput = fromJsonSchema<Record<string, unknown>>({ type: "object", additionalProperties: false, required: ["operations"], properties: { operations: { type: "array", minItems: 1, maxItems: 100, items: { type: "object" } }, confirmation: { type: "string", minLength: 64, maxLength: 64 } } });

export function createContentMcpServer(client = new ContentClient()): McpServer {
  const server = new McpServer({ name: "flowpilot-cloud-integration-content", version: MCP_SERVER_VERSION }, { capabilities: {}, instructions: "Reviewed SAP Cloud Integration content operations only.", supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS] });
  const read = (name: string, title: string, handler: (args: Record<string, unknown>) => Promise<unknown>) => server.registerTool(name, { title, inputSchema: readInput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args) => { try { return ok(await handler(args)); } catch (error) { return fail(error); } });
  read("list_integration_packages", "List Integration Packages", (args) => client.listPackages(args.limit));
  read("list_package_integration_flows", "List Package Integration Flows", (args) => client.listPackageFlows(args.packageId, args.limit));
  read("get_deployed_integration_artifact", "Get Deployed Artifact", (args) => client.getArtifact(args.artifactId));
  read("list_integration_flow_configurations", "List Flow Configurations", (args) => client.configurations(args.artifactId, args.version, args.limit));
  read("list_integration_flow_resources", "List Flow Resources", (args) => client.resources(args.artifactId, args.version, args.limit));
  server.registerTool("validate_integration_flow_plan", { title: "Validate Integration Flow Plan", inputSchema: planInput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args) => { try { const plan = parsePlan(args); return ok({ operations: plan, confirmation: confirmation(plan), parallelism: PARALLELISM }); } catch (error) { return fail(error); } });
  server.registerTool("execute_integration_flow_plan", { title: "Execute Integration Flow Plan", inputSchema: planInput, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async (args) => {
    try {
      const plan = parsePlan(args);
      if (args.confirmation !== confirmation(plan)) throw new Error("A matching validation confirmation is required");
      const groups = new Map<number, PlanRow[]>(); for (const row of plan) { const key = row.sequence ?? 1; groups.set(key, [...(groups.get(key) ?? []), row]); }
      const evidence: unknown[] = [];
      for (const sequence of [...groups.keys()].sort((a, b) => a - b)) for (let start = 0; start < groups.get(sequence)!.length; start += PARALLELISM) evidence.push(...await Promise.all(groups.get(sequence)!.slice(start, start + PARALLELISM).map(async (row) => { try { await (row.operation === "deploy" ? client.deploy(row) : row.operation === "undeploy" ? client.undeploy(row) : client.update(row)); return { ...row, sequence, outcome: "succeeded" }; } catch { return { ...row, sequence, outcome: "failed" }; } })));
      return ok({ evidence });
    } catch (error) { return fail(error); }
  });
  return server;
}
