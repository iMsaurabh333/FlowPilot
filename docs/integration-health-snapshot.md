# Integration Health Snapshot

## Purpose

Add a deterministic, read-only health layer above SAP Cloud Integration (CPI)
monitoring. It prioritizes degradation and recurring failures; CPI remains the
place for MPL browsing, traces, payloads, retries, and operational actions.

Implemented in the API and web workspace: persisted hourly snapshots, the home
health panel, and fixed report windows. A first collection can be started by a
ToolOperator; normal collection is automatic when the collector tenant is
configured.

## Data and collection

- Collect shortly after each UTC hour closes (for example, `HH:05`) for the
  preceding complete hour.
- Store only compact metrics per iFlow: bucket, ID/name, status counts, failure
  rate, and completeness. Store application-message and bounded error details
  only for attention-worthy failures.
- Mark a bucket **partial** whenever CPI has more data than can be safely
  retrieved. Partial data is never presented as a definitive KPI.
- Use database queries and fixed rules only: no LLM calls, prompts, payload
  storage, or token usage.
- Enable automatic collection by setting `INTEGRATION_HEALTH_TENANT_ID` for the
  deployed tenant (and optionally `INTEGRATION_HEALTH_SUBJECT`). The collector
  runs between `HH:05` and `HH:09` UTC and records a bucket once.

## Health rules and experience

- Flag flows needing attention from fixed failure-rate/trend rules.
- Mark **Intermittent** only when the same iFlow and `SAP_ApplicationID` have
  both failed and completed instances in the selected window. Otherwise show
  recurring failure patterns without inferring business correlation.
- If CPI application headers are absent, state: "Business message
  identifier/type not supplied by this iFlow."
- The homepage shows the latest completed hour, comparison with the prior hour,
  a 24-hour trend, and attention flows. A flow opens a focused health detail
  panel with application-message breakdown, bounded collapsible error details,
  and a CPI link.

## Fixed reports

Provide only these system-defined, run-on-demand reports:

| Report              | Window                                                    |
| ------------------- | --------------------------------------------------------- |
| Last completed hour | Previous complete hourly block                            |
| Today               | Midnight through latest completed hour                    |
| Yesterday           | Previous complete calendar day                            |
| Last 24 hours       | 24 completed hourly blocks ending at the current boundary |

Every report is generated from stored metrics and includes health, fixed counts,
comparison, attention flows, application-message breakdown, relevant errors,
and a concise rule-based conclusion. Users cannot edit report inputs,
thresholds, filters, or content.

## Boundaries

No raw payloads, trace content, retry/remediation/notification actions,
assignments, CPI state changes, editable report builder, or replacement of the
CPI monitoring interface. All health views and reports visibly preserve the
collection-completeness status.
