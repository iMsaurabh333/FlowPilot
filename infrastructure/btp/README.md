# SAP BTP account prerequisites

This directory validates the existing SAP BTP trial target before FlowPilot's MTA is built or deployed. Terraform owns account-level prerequisites only; `mta.yaml` remains the sole owner of applications, routes, managed-service instances, service bindings, and XSUAA application roles.

## Authentication

Local trial work reuses an interactive SAP BTP CLI session. The provider configuration never contains a user name, password, token, or assertion.

```powershell
btp login --sso
$env:USE_BTPCLI_SESSION = "true"
```

The SAP BTP provider documents BTP CLI session reuse as a local interactive flow and does not support it in CI/CD. GitHub Actions therefore validates formatting and static configuration only; it does not use a personal trial-account session.

## Local inputs

Copy values from the ignored `config/environments/btp.local.json` profile into `TF_VAR_...` environment variables or an ignored `terraform.tfvars` file. Never add credentials, SSO tokens, service keys, database URLs, or provider API keys to Terraform variables. Post-deployment role assignment is the only interface that accepts personal user identifiers; keep them in ignored local inputs and protect the resulting Terraform state.

The required variables are listed in `terraform.tfvars.example`. The real `terraform.tfvars`, generated auto-variable files, local state, saved plans, crash logs, and provider cache are ignored by Git.

## Safe command sequence

Run from the repository root:

```powershell
terraform -chdir=infrastructure/btp fmt -check
terraform -chdir=infrastructure/btp init
terraform -chdir=infrastructure/btp validate
terraform -chdir=infrastructure/btp plan -out=flowpilot.tfplan
terraform -chdir=infrastructure/btp show -no-color flowpilot.tfplan
```

The default configuration is discovery-only because `manage_entitlements` is `false`. A missing entitlement produces a plan warning and appears in `missing_required_entitlements`.

After discovery, a separately reviewed recovery plan may set `manage_entitlements = true` and list every already-present prerequisite in `existing_entitlement_keys`. Terraform then imports those existing grants into state and proposes creation only for keys omitted from that list. Never guess this list: generate it from current discovery, review category, quota, plan availability, and cost, save the plan, and obtain approval before apply.

Entitlement resources have `prevent_destroy = true`. FlowPilot automation will not remove an entitlement; retirement requires a separate ownership and impact review. The default trial plan therefore remains unable to import, create, update, or delete BTP resources.

## Post-deployment role assignment

`mta.yaml` and `xs-security.json` create `FlowPilotUsers`, `FlowPilotOperators`, and `FlowPilotAdmins`. Terraform validates and assigns these collections only after a successful MTA deployment; it never creates or edits their application roles.

The default role settings are disabled. A read-only post-deployment check may set `validate_flowpilot_role_collections=true`. A separately reviewed assignment plan may also set `manage_flowpilot_role_assignments=true`, optionally assign the ignored-profile bootstrap operator to `FlowPilotAdmins`, and include additional identities from that profile. Identity variables and resource values are sensitive so normal plan output redacts them. Do not use the provider's `btp_whoami` data source here: provider `1.25.0` prints its email as the read-status ID even when the downstream resource field is sensitive.

Role-assignment resources have `prevent_destroy=true`. Existing assignments are not imported automatically because provider `1.25.0` does not document assignment import. Before the first apply, inspect the role collection's existing users and omit duplicates. Revocation requires a separate access-removal review outside the bootstrap.

## State boundary

Terraform uses its local backend during this human-operated trial checkpoint. Local state can contain account metadata and is ignored by Git; it is not an acceptable shared production backend. The dependency lockfile is committed after initialization so every workstation downloads the same provider version and verifies the selected package checksums.

Do not run `terraform destroy`. Do not import or declare MTA-owned resources. Live account mutation, saved-plan apply, and Checkpoint 4 deployment require separate human approval.
