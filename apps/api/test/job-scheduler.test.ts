import { describe, expect, it, vi } from "vitest";

import { resolveJobSchedulerBinding, SapJobSchedulerClient } from "../src/reports/job-scheduler.js";

describe("SAP Job Scheduling adapter", () => {
  it("resolves an XSUAA Job Scheduling binding", () => {
    expect(resolveJobSchedulerBinding({ VCAP_SERVICES: JSON.stringify({ jobscheduler: [{ label: "jobscheduler", credentials: { url: "https://scheduler.example.test/", uaa: { clientid: "client", clientsecret: "secret", url: "https://uaa.example.test/" } } }] }) })).toEqual({ url: "https://scheduler.example.test", uaa: { clientid: "client", clientsecret: "secret", url: "https://uaa.example.test" } });
  });

  it("creates a UTC one-time schedule with only the report-job identifier in callback data", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 201 }));
    const client = new SapJobSchedulerClient({ url: "https://scheduler.example.test", uaa: { clientid: "client", clientsecret: "secret", url: "https://uaa.example.test" } }, fetcher);

    await expect(client.schedule({ reportJobId: "11111111-1111-4111-8111-111111111111", title: "Morning report", actionUrl: "https://api.example.test/api/internal/report-jobs/dispatch", scheduledFor: new Date("2026-09-10T08:00:00.000Z"), recurrenceRule: null })).resolves.toBe("42");

    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(request.body).toContain('"time":"2026-09-10T08:00:00.000Z"');
    expect(request.body).toContain('"reportJobId":"11111111-1111-4111-8111-111111111111"');
    expect(request.body).not.toContain("reportPrompt");
  });
});
