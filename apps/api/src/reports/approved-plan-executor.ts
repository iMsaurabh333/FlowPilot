import { z } from "zod";
import type { ChatTool } from "@flowpilot/agent-core";

import type { AuthenticatedUser } from "../types.js";
import type { ActionPlan } from "./action-plan-store.js";

const allowedToolNames = ["deploy_integration_flow", "undeploy_integration_flow", "update_integration_flow_configuration"] as const;
const stepSchema = z.object({ tool: z.enum(allowedToolNames), arguments: z.record(z.string(), z.unknown()) });
const planSchema = z.object({ steps: z.array(stepSchema).min(1).max(100) });
type ExecutionStep = z.infer<typeof stepSchema>;
type JsonSchema = Record<string, unknown>;

export class ActionPlanValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Approved action-plan steps do not match the currently available MCP tool schemas");
    this.name = "ActionPlanValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escape(value: string) { return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function failedToolResult(value: string) {
  if (value.startsWith("MCP tool did not") || value.startsWith("MCP tool returned no")) return true;
  try { const parsed = JSON.parse(value) as unknown; return typeof parsed === "object" && parsed !== null && "error" in parsed; } catch { return false; }
}
function matchesType(value: unknown, type: string) {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}
function schemaIssues(schema: JsonSchema, value: unknown, path: string): string[] {
  const issues: string[] = [];
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [];
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.filter(isRecord) : [];
  if (anyOf.length && !anyOf.some((candidate) => schemaIssues(candidate, value, path).length === 0)) return [`${path} does not match any permitted value shape`];
  if (oneOf.length && oneOf.filter((candidate) => schemaIssues(candidate, value, path).length === 0).length !== 1) return [`${path} does not match exactly one permitted value shape`];
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) issues.push(`${path} is not an allowed value`);
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) issues.push(`${path} must match the fixed schema value`);
  const declaredTypes = Array.isArray(schema.type) ? schema.type.filter((type): type is string => typeof type === "string") : typeof schema.type === "string" ? [schema.type] : [];
  if (declaredTypes.length && !declaredTypes.some((type) => matchesType(value, type))) return [...issues, `${path} has the wrong value type`];
  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : [];
    for (const name of required) if (!(name in value)) issues.push(`${path}.${name} is required`);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [name, child] of Object.entries(properties)) if (name in value && isRecord(child)) issues.push(...schemaIssues(child, value[name], `${path}.${name}`));
    if (schema.additionalProperties === false) for (const name of Object.keys(value)) if (!(name in properties)) issues.push(`${path}.${name} is not allowed`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(`${path} has too few values`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push(`${path} has too many values`);
    if (isRecord(schema.items)) value.forEach((item, index) => issues.push(...schemaIssues(schema.items as JsonSchema, item, `${path}[${index}]`)));
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(`${path} is too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push(`${path} is too long`);
    if (typeof schema.pattern === "string") try { if (!(new RegExp(schema.pattern, "u")).test(value)) issues.push(`${path} does not match the required format`); } catch { issues.push(`${path} cannot be checked against the advertised format`); }
  }
  return issues;
}

export class ApprovedPlanExecutor {
  constructor(private readonly resolveTools: (user: AuthenticatedUser) => Promise<ChatTool[]>) {}
  async #tools(user: AuthenticatedUser) { return (await this.resolveTools(user)).filter((tool) => tool.name.startsWith("cloud-integration-content__")); }
  async validate(user: AuthenticatedUser, steps: unknown[]) {
    const parsed = planSchema.safeParse({ steps });
    if (!parsed.success) throw new ActionPlanValidationError(["The plan has no valid supported Integration Content steps."]);
    const byName = new Map((await this.#tools(user)).map((tool) => [tool.name.replace("cloud-integration-content__", ""), tool]));
    const issues = parsed.data.steps.flatMap((step, index) => {
      const tool = byName.get(step.tool);
      if (!tool) return [`Step ${index + 1}: ${step.tool} is not currently available.`];
      return schemaIssues(tool.inputSchema as JsonSchema, step.arguments, `Step ${index + 1} arguments`);
    });
    if (issues.length) throw new ActionPlanValidationError(issues);
    return parsed.data;
  }
  async execute(user: AuthenticatedUser, plan: ActionPlan) {
    const [parsed, tools] = await Promise.all([this.validate(user, plan.steps), this.#tools(user)]);
    const byName = new Map(tools.map((tool) => [tool.name.replace("cloud-integration-content__", ""), tool]));
    const results: Array<{ step: ExecutionStep; status: "succeeded" | "failed"; detail: string }> = [];
    for (const step of parsed.steps) {
      const tool = byName.get(step.tool);
      if (!tool) { results.push({ step, status: "failed", detail: "The approved Integration Content tool is unavailable." }); continue; }
      let detail = ""; let succeeded = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try { detail = await tool.invoke(step.arguments); if (!failedToolResult(detail)) { succeeded = true; break; } } catch { detail = "The operation did not complete within the retry limit."; }
      }
      results.push({ step, status: succeeded ? "succeeded" : "failed", detail });
    }
    const failures = results.filter((result) => result.status === "failed");
    const rows = results.map((result) => `<tr><td>${escape(result.step.tool)}</td><td>${escape(JSON.stringify(result.step.arguments))}</td><td>${result.status === "succeeded" ? "Completed" : "Failed"}</td><td>${escape(result.detail.slice(0, 2000))}</td></tr>`).join("");
    const errorLog = failures.length ? failures.map((result) => `${result.step.tool}: ${result.detail}`).join("\n") : null;
    return { html: `<!doctype html><html><body><h1>Approved plan execution</h1><p>Revision ${plan.revision}</p><table><thead><tr><th>Operation</th><th>Arguments</th><th>Final status</th><th>Final result</th></tr></thead><tbody>${rows}</tbody></table></body></html>`, status: failures.length ? "attention" as const : "succeeded" as const, errorLog };
  }
}
