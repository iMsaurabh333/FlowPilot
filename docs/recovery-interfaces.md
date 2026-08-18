# FlowPilot recovery interfaces

## Purpose and execution boundary

These contracts make access, provider-secret, database-backup, and restore operations repeatable without turning dangerous actions into silent defaults. `config/environments/operations.example.json` contains placeholders only. Copy it to `operations.local.json` for a real environment; all `*.local.json` files are ignored.

Checkpoint 3A validates and dry-runs these contracts. It does not assign a role, accept a provider key, export or import conversation data, create a service instance, apply Terraform, or deploy an MTA.

## Role assignment interface

XSUAA creates three application-owned role collections from `xs-security.json`:

| Role collection      | Intended access                                                    |
| -------------------- | ------------------------------------------------------------------ |
| `FlowPilotUsers`     | Use chat and permitted read-only capabilities.                     |
| `FlowPilotOperators` | Use chat and approved operational tools.                           |
| `FlowPilotAdmins`    | Administer FlowPilot and inherit chat/operator application scopes. |

The ignored operations profile can select the bootstrap operator as the first FlowPilot administrator and can list additional assignments. Each additional item needs a stable local key, one allowed collection name, a user name, and an optional custom identity-provider origin.

Terraform owns assignments only. It first validates that the MTA-created collections exist, reads operator identities from the ignored local profile, marks identity variables and resource values sensitive, and sets `prevent_destroy=true`. It deliberately does not use `btp_whoami`, because provider `1.25.0` prints the email address as the data-source read ID. The bootstrap must stop if a requested user already has the collection; provider `1.25.0` does not document role-assignment import. Revocation is a separate reviewed access-removal operation.

## Provider-secret interface

The operations profile stores only safe metadata: provider, service-instance name, namespace, credential name, and credential type. The Groq key itself must enter through the SAP Credential Store cockpit's protected form or a future masked interactive prompt connected directly to the Credential Store API.

The secret must never be accepted through:

- a CLI argument;
- JSON, YAML, Terraform variables, MTA properties, or `.env` used for cloud deployment;
- a GitHub secret for this human-operated trial;
- shell history, redirected output, screenshots, logs, or AI chat.

Before secret entry, the operator must confirm the target subaccount/space and the `flowpilot-credentials` instance. After entry, verification may check only that the named credential exists and is readable by the bound API; it must never print or hash the value. Rotation updates the same logical name, verifies a controlled model call, then revokes the old provider key.

## Portable backup interface

SAP-managed point-in-time backups protect a supported PostgreSQL instance inside their documented retention and landscape constraints, but Git and a new trial account cannot rely on that boundary. FlowPilot therefore also needs an encrypted logical export written to operator-controlled storage outside the expiring subaccount.

The portable backup contract includes both `flowpilot_app` and `flowpilot_graph`. The archive format is `flowpilot-logical-v1` and its non-secret manifest records:

- format and schema version;
- UTC creation time;
- source subaccount, CF organization/space, and database service-instance identifiers;
- included PostgreSQL schemas and migration versions;
- row/table counts;
- ciphertext SHA-256 and encryption algorithm;
- application commit and MTA version;
- no database URL, binding, token, key, prompt, or plaintext message.

The export must run inside Cloud Foundry when the trial database is network-private, stream directly into authenticated encryption, write only ciphertext to the external destination, verify the ciphertext hash, and perform a test read with the recovery key. Plaintext temporary files are prohibited. The operator chooses and controls the external destination and encryption recipient.

## Restore interface

Restore always targets a new, empty PostgreSQL service instance. It never overwrites the only copy of a running database. The guarded sequence is:

1. verify target BTP/CF identity, archive format, ciphertext hash, and decryption access;
2. create or select an empty isolated restore target through a separately approved operation;
3. compare application/MTA versions and run compatible schema migrations;
4. require an explicit mapping decision for old XSUAA tenant/subject identifiers;
5. import both schemas in one controlled maintenance window;
6. compare recorded and restored counts and verify LangGraph checkpoint reads;
7. rerun forced-RLS, no-identity, and two-subject isolation tests;
8. switch an application binding only after review, retaining the source for rollback.

If identity continuity cannot be proven after moving to a new subaccount, the default is to keep the restored rows inaccessible. Never rewrite all rows to the new administrator or disable row-level security to make history appear.

## Required human gates

- entering or rotating a provider key;
- approving role-assignment apply or access removal;
- selecting the external encrypted-backup destination and recovery-key custodian;
- starting a backup that reads private conversation content;
- creating a restore service, approving identity mapping, or switching bindings;
- deleting any source database or backup.

These gates remain even after the bootstrap command is implemented.
