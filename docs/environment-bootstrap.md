# Environment bootstrap and recovery

## Purpose

Checkpoint 3A turns FlowPilot's SAP BTP setup into a repeatable, teachable recovery process. It prepares the project to move from an expired trial account to a new trial or enterprise subaccount without reconstructing entitlements, roles, application services, and deployment steps from memory.

The checkpoint follows one learning rule:

> Perform and understand each step, codify it, verify it, and only then add it to the one-command bootstrap.

The human runs or explicitly approves every infrastructure-changing command during the guided walkthrough. The AI assistant explains the purpose, inputs, expected output, verification, common failures, and rollback before moving forward.

## Checkpoint boundary

Checkpoint 3A may:

- inventory and validate the required local tools;
- authenticate interactively with SAP BTP and Cloud Foundry through browser SSO;
- discover the current trial account without exposing credentials;
- add versioned Terraform configuration for BTP account prerequisites;
- run and review Terraform plans;
- apply an approved, non-destructive account-level change;
- codify application-role assignment after XSUAA creates the roles;
- build and validate the MTA without deploying it;
- add a cross-platform bootstrap orchestrator with dry-run and confirmation gates;
- document secret injection and PostgreSQL backup/restore procedures;
- rehearse all non-destructive recovery steps against the current trial account.

Checkpoint 3A does not authorize:

- creating, deleting, or replacing the current trial account;
- running `terraform destroy`;
- allowing Terraform to take ownership of resources already owned by the MTA;
- deploying the Checkpoint 2 or Checkpoint 3 runtime to the live space;
- storing SAP, Groq, database, service-key, or Terraform-state secrets in Git;
- configuring an unattended GitHub deployment with a personal SAP account;
- beginning the Checkpoint 4 live deployment and persistence smoke test.

The first live deployment through the completed bootstrap remains Checkpoint 4 and requires a separate human approval.

## Resource ownership

Each resource must have exactly one declarative owner.

| Resource or activity                                                 | Owner                                                            | Reason                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Trial global-account activation and legal acceptance                 | Human through SAP onboarding                                     | These actions exist outside the new account's automation boundary.                                    |
| Existing/default trial subaccount discovery                          | Bootstrap orchestrator                                           | SAP trial onboarding normally supplies it; discovery avoids creating a conflicting second subaccount. |
| Service entitlements and quotas                                      | SAP BTP Terraform provider                                       | These are account-level prerequisites that must exist before the MTA can create service instances.    |
| Cloud Foundry environment discovery or approved creation             | SAP BTP Terraform provider                                       | The environment belongs to the subaccount layer, not to the application archive.                      |
| Cloud Foundry space targeting                                        | Bootstrap orchestrator and CF CLI                                | The MTA deployer operates against the explicitly selected org and space.                              |
| API, AppRouter, web content, routes, service instances, and bindings | `mta.yaml` through `cf deploy`                                   | The MTA already expresses module ordering and application-service dependencies.                       |
| XSUAA scopes, role templates, and FlowPilot role collections         | `xs-security.json` through the MTA                               | The roles are application definitions and are created or updated with XSUAA.                          |
| User assignment to FlowPilot role collections                        | SAP BTP Terraform provider after MTA deployment                  | Assignment is account administration; the referenced application roles must exist first.              |
| Node dependency restoration, tests, and MTA build                    | Locked npm scripts and MBT                                       | Application builds must be reproducible from Git lockfiles.                                           |
| Groq or other provider secrets                                       | SAP-managed credential service or approved secure injection path | Secret values must remain outside Git, Terraform source, logs, and command history.                   |
| Conversation data backup and restore                                 | Dedicated recovery command and encrypted external storage        | Source control is not a database backup system.                                                       |
| Verification on pushes and pull requests                             | GitHub Actions                                                   | The current workflow remains credential-free and does not deploy the trial account.                   |
| Trial deployment orchestration                                       | Local bootstrap command                                          | Browser SSO is appropriate for a human-operated trial workflow.                                       |

Terraform must not recreate or import `flowpilot-auth`, `flowpilot-destination`, `flowpilot-logs`, `flowpilot-postgres`, `flowpilot-api`, or `flowpilot-approuter`. Those remain MTA-owned.

## Guided-learning protocol

Every step uses the same gate:

1. Explain the responsibility and why it belongs in this layer.
2. Identify the source-controlled file and non-secret inputs.
3. Show the exact read-only or mutating command before it runs.
4. State the expected output and how success will be verified.
5. Identify credential exposure, cost, data-loss, and replacement risks.
6. Have the human run or explicitly approve the command.
7. Compare actual output with the expectation.
8. Record failed attempts, corrected assumptions, and the final result in `DevFlow.md`.
9. Stop for human confirmation before the next learning step.

During the teaching walkthrough:

- do not use Terraform `-auto-approve`;
- save a reviewed plan before an apply whenever the provider supports it;
- never paste access tokens, passwords, provider keys, service-key JSON, or Terraform state into chat;
- redact account IDs only when publishing outside the private project context, but always redact secret values;
- prefer read-only discovery before creating or changing a resource;
- make reruns idempotent so an interrupted recovery can continue safely.

## Learning and implementation sequence

| Step | Lesson and deliverable                                                                                                             | Mutation boundary                                                | Human gate                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1    | Define ownership, scope, learning protocol, and recovery success criteria.                                                         | Documentation only.                                              | Approve the Checkpoint 3A contract.                                                |
| 2    | Inventory Node, npm, Git, BTP CLI, CF CLI, MultiApps, Terraform, MBT, and GNU Make; explain why each exists.                       | Read-only version checks.                                        | Approve any tool installation or upgrade separately.                               |
| 3    | Teach `btp login --sso`, `cf login --sso`, account targeting, org/space targeting, and safe environment discovery.                 | Authentication sessions only; no platform configuration changes. | Confirm the discovered target before it is recorded locally.                       |
| 4    | Introduce Terraform configuration, providers, variables, state, plan files, drift, and secret boundaries.                          | Repository files and local ignored state only.                   | Review configuration before `terraform init`.                                      |
| 5    | Generate and interpret the first account-prerequisite plan.                                                                        | Read-only plan and refresh.                                      | Approve or reject every proposed change.                                           |
| 6    | Apply only approved entitlement or environment prerequisites and verify them independently.                                        | BTP account-level changes only.                                  | Confirm the saved plan immediately before apply.                                   |
| 7    | Explain the MTA dependency graph, build a clean archive, and verify its contents.                                                  | Local build artifacts only.                                      | Confirm that live `cf deploy` remains deferred.                                    |
| 8    | Codify post-deployment FlowPilot role assignment and preview it against existing roles.                                            | Plan/read only in Checkpoint 3A.                                 | Live assignment waits for a reviewed plan and applicable deployment state.         |
| 9    | Define secure provider-secret injection and database backup/restore interfaces without committing values.                          | Templates and tests only.                                        | Human supplies secrets only during the later approved runtime step.                |
| 10   | Assemble the proven operations into a cross-platform bootstrap command with dry-run, confirmation, resume, and verification modes. | Local orchestration; live deployment disabled in Checkpoint 3A.  | Review each internal stage and the final dry run.                                  |
| 11   | Rehearse recovery from a fresh clone against the current trial without replacing or redeploying live resources.                    | Read-only discovery, plan, build, and smoke checks.              | Accept documented limitations that require the next trial account or Checkpoint 4. |

## Intended recovery experience

After a new trial has been activated and the repository has been cloned, the final operator experience should be:

```powershell
btp login --sso
cf login --sso
npm run btp:bootstrap
```

The bootstrap must pause before account mutation and again before live MTA deployment. It must print the target global account, subaccount, Cloud Foundry API, organization, and space before either approval.

For the current trial workflow, GitHub Actions remains a credential-free verifier. A future enterprise workflow may call the same Terraform and MTA operations with a technical identity, certificate, or approved workload federation, but GitHub Actions does not become an infrastructure owner.

## Recovery inputs

The bootstrap may accept these non-secret values from a local, ignored environment profile:

- global-account subdomain;
- subaccount ID or discoverable subaccount name;
- region and Cloud Foundry API endpoint;
- organization and space names;
- administrator user name and identity-provider origin;
- desired non-secret model provider and model name.

Secret inputs must come from interactive secure prompts, approved environment variables, or a managed credential service. The profile, Terraform variables, plan output, GitHub logs, and application logs must not contain secret values.

## Recovery success criteria

Checkpoint 3A is complete when:

- a new developer can explain which resources Terraform owns and which resources the MTA owns;
- required tools and their versions can be checked with one read-only command;
- BTP and CF targets can be discovered without using the cockpit for routine configuration;
- Terraform can produce a reviewed, understandable plan for account prerequisites;
- any approved account-level apply is repeatable and a second plan shows no unexpected drift;
- the MTA can be built from a fresh clone with locked dependencies;
- role-assignment, secret-injection, backup, and restore operations have safe documented interfaces;
- the bootstrap dry run shows every intended action and refuses live deployment during Checkpoint 3A;
- all unavoidable manual actions are explicitly listed;
- the procedure, failures, recoveries, and remaining trial limitations are recorded in `DevFlow.md`;
- the human has approved every learning step and the overall checkpoint.

## Unavoidable manual actions

Automation cannot safely eliminate:

1. Creating or reactivating the SAP trial global account and accepting SAP terms.
2. Completing browser SSO or multi-factor authentication for a human-operated trial.
3. Choosing a different service or plan when SAP does not offer the requested entitlement in the new trial region.
4. Supplying new provider secrets through an approved secure channel.
5. Approving a Terraform plan and the first live MTA deployment.
6. Deciding how identities from an expired XSUAA tenant map to restored conversation ownership.

## Data portability warning

Git restores application code and declarative configuration; it does not restore PostgreSQL conversations. Before an account expires, the recovery workflow must export application data to encrypted external storage and verify that it can be read back. Because conversation rows are isolated by XSUAA tenant and subject identifiers, restoring them into a new subaccount may require an explicitly reviewed identity-mapping migration. That migration must never weaken row-level isolation.

## Primary references

- [SAP BTP account administration using infrastructure as code](https://help.sap.com/docs/btp/sap-business-technology-platform/account-administration-using-infrastructure-as-code)
- [Terraform Provider for SAP BTP](https://registry.terraform.io/providers/SAP/btp/latest/docs)
- [BTP subaccount entitlement resource](https://registry.terraform.io/providers/SAP/btp/latest/docs/resources/subaccount_entitlement)
- [BTP environment-instance resource](https://registry.terraform.io/providers/SAP/btp/latest/docs/resources/subaccount_environment_instance)
- [BTP role-collection assignment resource](https://registry.terraform.io/providers/SAP/btp/latest/docs/resources/subaccount_role_collection_assignment)
- [SAP BTP CLI browser SSO login](https://help.sap.com/docs/btp/btp-cli-command-reference/btp-login?locale=en-US)
- [Cloud Foundry MultiApps CLI plugin](https://github.com/cloudfoundry/multiapps-cli-plugin)
