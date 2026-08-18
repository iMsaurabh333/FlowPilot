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

### Temporary fast-track execution mode

On 2026-08-18, the human explicitly deferred the detailed teaching walkthrough until the project is complete so implementation can proceed with lower time and token overhead. For the remainder of the current project:

- the assistant may execute the approved Checkpoint 3A steps without a separate lesson or approval between every read-only and reversible substep;
- every command category, failed attempt, corrected assumption, final result, and reusable lesson must still be recorded in `DevFlow.md`;
- the source material and command explanations remain in this guide so the deferred walkthrough can replay the real project evidence instead of reconstructing it from memory;
- browser SSO, MFA, CAPTCHA, secret entry, destructive or replacement actions, paid-resource choices, Terraform apply, and live application deployment retain explicit human gates;
- the boundary between Checkpoint 3A and Checkpoint 4 remains unchanged. Checkpoint 3A cannot deploy the pending chat runtime.

This is an execution-mode exception, not a deletion of the learning objective. The project-close review must cover the BTP CLI, Cloud Foundry CLI, Terraform, MTA, secret handling, recovery, and GitHub automation using the accumulated audit trail.

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

## Current workstation tool inventory

**Last checked:** 2026-08-18 on Windows x64. This records the development workstation used for the guided trial-account walkthrough; the future bootstrap must perform equivalent checks on Windows, macOS, or Linux rather than hard-code these paths.

| Tool                  | Discovered version                                                                 | Status for FlowPilot                    | Lesson or required follow-up                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js               | `24.12.0`                                                                          | Ready                                   | Matches the repository's `24.x` engine contract.                                                                                                                                 |
| npm                   | `11.11.1` through the normal user launcher; `11.6.2` in the base Node installation | Ready                                   | The normal launcher redirects to the user npm prefix. Restricted automation may need an explicitly accessible npm CLI, but the workstation installation does not require repair. |
| Git                   | `2.52.0.windows.1`                                                                 | Ready                                   | Used for source recovery and checkpoint history; no provider credentials belong in Git.                                                                                          |
| SAP BTP CLI           | Client `2.106.1`; server `2.116.2` at installation verification                    | Ready                                   | Installed from SAP's official Windows AMD64 archive in the documented user-local directory. Login remains a separate Step 3 action.                                              |
| Cloud Foundry CLI     | `8.18.4`                                                                           | Ready                                   | Meets the MultiApps requirement for CF CLI v8. The user-level CF configuration must be accessible when commands run.                                                             |
| MultiApps CF plugin   | `3.11.1`                                                                           | Ready                                   | Supplies `cf deploy` and other MTA lifecycle commands. It remains the application deployer.                                                                                      |
| Terraform             | `1.15.8` on `windows_amd64`                                                        | Ready                                   | Installed from HashiCorp's signed and checksummed Windows AMD64 archive in the documented user-local directory. Provider initialization remains a separate repository step.      |
| MBT npm wrapper       | `1.2.49` from the root lockfile                                                    | Ready                                   | Repository-local tooling is preferred over an unpinned global launcher.                                                                                                          |
| MBT native executable | `1.2.47`                                                                           | Ready with version distinction recorded | This is the executable installed by the locked npm wrapper and it already passed FlowPilot's strict MTA build. The preflight must report both wrapper and native versions.       |
| GNU Make              | `3.81` at `C:\Program Files (x86)\GnuWin32\bin\make.exe`                           | Ready but not on `PATH`                 | MBT already built FlowPilot successfully with this executable. The future orchestrator must discover or receive the path without changing global configuration silently.         |

No installation, upgrade, login, service call, or infrastructure mutation was performed during this inventory.

### Installation candidates for separate approval

- **SAP BTP CLI — completed 2026-08-18:** client `2.106.1` was installed from SAP's official Windows AMD64 archive after published-checksum and archive-path verification. See [Download and Start Using the btp CLI Client](https://help.sap.com/docs/btp/sap-business-technology-platform/download-and-start-using-btp-cli-client?locale=en-us).
- **Terraform — completed 2026-08-18:** client `1.15.8` was installed from HashiCorp's official Windows AMD64 archive after PGP signature, SHA-256, archive-path, and Windows Authenticode verification. See [Install Terraform](https://developer.hashicorp.com/terraform/install) and [Verify Terraform binary archives](https://developer.hashicorp.com/terraform/tutorials/cli/verify-archive).

SAP BTP CLI and Terraform are now ready. Installing Terraform does not initialize a provider, create state, inspect BTP through Terraform, or authorize an apply.

### SAP BTP CLI installation record

- Installer source reviewed: `https://cli.btp.cloud.sap/btpcli-install.ps1`
- Installer-script SHA-256 at review: `6CB6292D779EF6857525115937EAB3AEF4BD86B46A138C6F6370B9BC3714E3AC`
- Archive source: `https://tools.hana.ondemand.com/additional/btp-cli-windows-amd64-latest.tar.gz`
- Published and verified archive SHA-1: `85F193EA89A5667B68EB8CF71A17D765AB507AA3`
- Recorded archive SHA-256: `3EDFBF6C9A0069D1A265CA3E061497ED605CCB6F400CAE3D0708488BDCBB396C`
- Installed `btp.exe` SHA-256: `F3C1BA51225382E89B3F9B78EE74817E5BDF21D779A1A29D77E9448A5B81B0DD`
- Installed path: `C:\Users\saura\AppData\Local\Programs\btpcli\btp.exe`
- Persisted configuration: the exact containing directory was added once to the user `PATH`.
- Authentication state after verification: not logged in.
- Temporary installer-review and archive-extraction directories: removed after successful verification.

The reviewed SAP script downloads the archive, checks SAP's published SHA-1, extracts `btp.exe`, and updates user `PATH`. The guided installation used a fail-closed equivalent because the reviewed script reports a checksum mismatch without an explicit terminating statement before extraction. Removal consists of deleting the exact user-local installation directory and removing only its exact user `PATH` entry; perform both through a separately reviewed command.

### Terraform installation record

- Version and platform: Terraform `1.15.8`, `windows_amd64`
- Archive source: `https://releases.hashicorp.com/terraform/1.15.8/terraform_1.15.8_windows_amd64.zip`
- Checksum source: `terraform_1.15.8_SHA256SUMS`
- Checksum signature: `terraform_1.15.8_SHA256SUMS.72D7468F.sig`
- Verified HashiCorp PGP fingerprint: `C874011F0AB405110D02105534365D9472D7468F`
- Verified archive SHA-256: `2FF41D2129AFB1982733C132C61A8D6EF038F879F3AEEDE7FC28B8B8B24ACF02`
- Validated archive entries: `LICENSE.txt`, `terraform.exe`
- Installed executable SHA-256: `6EB0A1CB89344C97CCF2928DDC2D7A6CB71A1837B7ECCCFD5991466B6D751E03`
- Windows Authenticode status: `Valid`, signer `HashiCorp, Inc.`, certificate thumbprint `65B9DA802B1273FB147374C3C122DB21ABECDFC4`
- Installed path: `C:\Users\saura\AppData\Local\Programs\terraform\terraform.exe`
- Persisted configuration: the exact containing directory was added once to the user `PATH`.
- Provider and state status after verification: no provider selections, no initialization, and no Terraform state.
- Temporary verification and extraction directories: removed after successful installation.

The installer used a temporary GPG home so it did not alter the user's normal keyring. Removal consists of deleting only the exact user-local Terraform directory and removing only its exact user `PATH` entry. Provider downloads, `.terraform` directories, lockfiles, and state are separate repository concerns and were not created by this installation.

## Current BTP and Cloud Foundry target profile

**Last verified:** 2026-08-18 using browser SSO and read-only CLI discovery.

The current trial has one discoverable subaccount named `trial` in region `us10`. Its Cloud Foundry environment is targeted at `https://api.cf.us10-001.hana.ondemand.com`, organization `7d472741trial`, and space `dev`. The BTP global-account target and the CF organization resolve to the same trial landscape.

The account UUIDs are stored only in `config/environments/btp.local.json`, which is ignored by Git. The committed `config/environments/btp.example.json` documents the schema with placeholders. Neither file may contain passwords, SSO tokens, service keys, database credentials, LLM API keys, or Terraform state.

Create or refresh a profile from supported CLI output:

```powershell
btp login --sso
btp target
btp list accounts/subaccount
cf login --sso -a https://api.cf.us10-001.hana.ondemand.com
cf target -o 7d472741trial -s dev
cf target
```

SAP BTP CLI client `2.106.1` does not accept `--format json` for `list accounts/subaccount`; the bootstrap must parse neither presentation text nor an unsupported option. Until a stable machine-readable command is verified, discovery should validate the values against the explicit local profile and fail on ambiguity.

The 2026-08-18 read-only inventory also showed both deployed FlowPilot applications stopped by trial cleanup and all retained managed services healthy. Application startup and live deployment are intentionally outside this discovery step.

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
