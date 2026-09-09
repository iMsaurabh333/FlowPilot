import { randomUUID } from "node:crypto";
import type { ChatAgent } from "@flowpilot/agent-core";
import type { ChatTool } from "@flowpilot/agent-core";
import { z } from "zod";

const structured = z.object({ plan: z.string().min(1), steps: z.array(z.object({ tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()) })).min(1) });

export class ReportActionPlanService {
  readonly #agent: ChatAgent;
  constructor(agent: ChatAgent, private readonly resolveTools: () => Promise<ChatTool[]>) { this.#agent = agent; }
  async createPreview(source: string) {
    const tools = (await this.resolveTools()).filter((tool) => tool.name.startsWith("cloud-integration-content__")).map((tool) => ({ tool: tool.name.replace("cloud-integration-content__", ""), inputSchema: tool.inputSchema }));
    const messages = await this.#agent.sendMessage(randomUUID(), `Interpret this uploaded operations document into JSON only: {"plan":"human-readable review plan","steps":[{"tool":"exact tool name","arguments":{}}]}. Preserve order. Do not execute. Use only these live Integration Content MCP schemas: ${JSON.stringify(tools)}.\n\nDocument:\n${source}`);
    const final = [...messages].reverse().find((message) => message.role === "assistant")?.content.trim();
    if (!final) throw new Error("The action-plan model did not return a preview");
    return structured.parse(JSON.parse(final.replace(/^```json\s*|\s*```$/gu, "")));
  }
  async regenerate(plan: string) {
    const tools = (await this.resolveTools()).filter((tool) => tool.name.startsWith("cloud-integration-content__")).map((tool) => ({ tool: tool.name.replace("cloud-integration-content__", ""), inputSchema: tool.inputSchema }));
    const messages = await this.#agent.sendMessage(randomUUID(), `Convert this approved-draft narrative into JSON only: {"steps":[{"tool":"exact tool name","arguments":{}}]}. Preserve order and use only these live Integration Content MCP schemas: ${JSON.stringify(tools)}. Do not execute.\n\nDraft:\n${plan}`);
    const text = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
    return structured.pick({ steps: true }).parse(JSON.parse(text.replace(/^```json\s*|\s*```$/gu, ""))).steps;
  }
}
