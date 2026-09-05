# SAP Cloud Integration Message Processing Logs contract

## Intake status

The user supplied the SAP Business Accelerator Hub EDMX, and its exact bytes are now
pinned as `MessageProcessingLogs.edmx`. The reviewed file is 26,915 bytes with
SHA-256
`de7715ec5238bc4817b31237f5f6f639f113d6a87371d554ac15088359cbf67e`.
See `provenance.json` for the complete intake record.

- Product: SAP Cloud Integration
- API: Message Processing Logs
- Protocol documented by SAP: OData v2
- Business operation allowed in Milestone 5: HTTP `GET` only
- Business Accelerator Hub source:
  <https://api.sap.com/api/MessageProcessingLogs/overview>
- SAP download procedure:
  <https://sap.github.io/cloud-sdk/docs/js/guides/api-business-hub-download-specification>
- Pinned local vendor path:
  `contracts/sap-cloud-integration/message-processing-logs/MessageProcessingLogs.edmx`

SAP's download guide requires signing in, selecting **API Specification**, and
downloading the EDMX for an OData service. The authenticated transport source could
not be independently inspected, so publisher attribution records the user's
authenticated handoff while the SHA-256 pins the reviewed local bytes. No API key,
service key, OAuth token, cookie, destination export, tenant credential, or sample
payload is stored here.

## Contract review

The artifact is well-formed XML using EDMX `1.0`, OData Data Service Version `2.0`,
and namespace `com.sap.hci.api`. It defines 23 entity types and 23 entity sets. The
only allowed entity set is `MessageProcessingLogs`, backed by entity type
`MessageProcessingLog` and key `MessageGuid`.

The metadata also contains 22 unrelated entity sets, stream-bearing entities,
navigation properties for attachments, traces, message stores, custom headers,
errors and adapter attributes, plus these POST function imports:

- `activateArchivingConfiguration`
- `activateExternalLogging`
- `deactivateExternalLogging`

They are all explicitly excluded. Generation must not expose the EDMX wholesale.
Any derived file must identify the pinned EDMX SHA-256 as its source. A changed
upstream file requires a new hash and review before generation or deployment.

## Narrow connector schema

This is the FlowPilot-facing semantic contract authorized by Checkpoint 5.0. It is
independent of raw OData syntax; the exact upstream property mapping remains pending
until the official EDMX is pinned.

### Request: `search_message_processing_logs`

| Field               | Type               | Required | Rules                                                                                                |
| ------------------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `fromUtc`           | RFC 3339 timestamp | yes      | Must include UTC offset and normalize to UTC.                                                        |
| `toUtc`             | RFC 3339 timestamp | yes      | Must be later than `fromUtc`; window is at most 24 hours.                                            |
| `status`            | enum               | no       | `COMPLETED`, `PROCESSING`, `RETRY`, `ESCALATED`, `FAILED`, `CANCELLED`, `DISCARDED`, or `ABANDONED`. |
| `integrationFlowId` | string             | no       | Exact semantic identifier mapped to `IntegrationArtifact/Id`; no wildcard or OData expression.       |
| `correlationId`     | string             | no       | Semantic identifier only; no wildcard or OData expression.                                           |
| `limit`             | integer            | no       | Default `20`; minimum `1`; maximum `100`.                                                            |

The request schema does not accept a URL, destination, resource path, raw filter,
projection, ordering, skip token, header, credential, or arbitrary query option.
Unknown properties fail validation.

### Normalized response

The connector returns at most `limit` items plus safe envelope metadata.

| Field                  | Type                         | Reviewed source                                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `messageId`            | string                       | `MessageGuid`, non-null `Edm.String` and entity key                                  |
| `correlationId`        | string or null               | `CorrelationId`, nullable `Edm.String`                                               |
| `integrationFlowId`    | string or null               | `IntegrationArtifact/Id`, nullable `Edm.String` inside the non-null complex property |
| `integrationFlowName`  | string or null               | `IntegrationFlowName`, nullable `Edm.String`                                         |
| `status`               | string or null               | `Status`, nullable `Edm.String`                                                      |
| `startedAt`            | UTC timestamp or null        | `LogStart`, nullable `Edm.DateTime`                                                  |
| `endedAt`              | UTC timestamp or null        | `LogEnd`, nullable `Edm.DateTime`                                                    |
| `durationMilliseconds` | non-negative integer or null | `LogEnd - LogStart` only when both parse and the result is non-negative              |

The envelope contains `items`, `count`, and a boolean `hasMore`. It never returns an
upstream continuation URL or token. Detecting `hasMore` may use one additional row
internally, but the normalized result still returns no more than 100 items.

### Outbound query rules

- Resolve only the fixed server-side destination
  `FLOWPILOT_CLOUD_INTEGRATION_MPL`.
- Send only `GET` to `/MessageProcessingLogs` beneath the destination's fixed
  `/api/v1` service root.
- Build filters from validated typed fields and escape OData literals centrally.
  Never concatenate a model-authored query fragment.
- Use the fixed projection
  `MessageGuid,CorrelationId,IntegrationArtifact,IntegrationFlowName,Status,LogStart,LogEnd`.
- Express the UTC input interval as `LogStart ge <from>` and `LogStart lt <to>` and
  add only exact `Status`, `CorrelationId`, or `IntegrationArtifact/Id` equality
  predicates when supplied. Normalize timestamps to UTC, then serialize SAP OData
  v2 datetime literals without a `Z` suffix or numeric offset because SAP documents
  that those suffixes are not interpreted for this API.
- Use fixed `$orderby=LogStart desc` and `$top=limit+1` (at most `101`) so the
  connector can determine `hasMore` while returning no more than `limit` items.
- Request JSON with a fixed `Accept` header; never request an inline count.
- Apply bounded timeout and response-size limits; do not follow cross-origin or
  unapproved redirects.
- Do not automatically traverse vendor pagination. Return the bounded first page
  and safe `hasMore` metadata only.

### Stable failure categories

The connector may report `invalid_request`, `not_authorized`,
`destination_unavailable`, `upstream_rate_limited`, `upstream_unavailable`,
`upstream_timeout`, or `invalid_upstream_response`. User-visible failures and logs
must not contain raw upstream bodies, authorization headers, tokens, credentials,
tenant-bearing URLs, request filters, or returned records.

## Step 5.1 decision

The official EDMX, provenance record, exact safe-field mapping, query boundary, and
excluded surface are reviewed. Step 5.1 is complete. Connector or MCP runtime
implementation remains gated; Step 5.2 requires separate approval.
