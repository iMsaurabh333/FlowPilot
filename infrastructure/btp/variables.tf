variable "global_account_subdomain" {
  description = "Subdomain of the existing SAP BTP global account."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.global_account_subdomain))
    error_message = "global_account_subdomain must be a valid SAP BTP subdomain."
  }
}

variable "subaccount_id" {
  description = "UUID of the existing SAP BTP subaccount."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subaccount_id))
    error_message = "subaccount_id must be a UUID."
  }
}

variable "subaccount_name" {
  description = "Expected display name of the existing subaccount."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.subaccount_name)) > 0
    error_message = "subaccount_name cannot be empty."
  }
}

variable "subaccount_subdomain" {
  description = "Expected subdomain of the existing subaccount."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.subaccount_subdomain))
    error_message = "subaccount_subdomain must be a valid SAP BTP subdomain."
  }
}

variable "region" {
  description = "Expected SAP BTP region of the existing subaccount."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z]{2}[0-9]{2}$", var.region))
    error_message = "region must look like us10 or eu10."
  }
}

variable "cloud_foundry_environment_id" {
  description = "UUID of the existing Cloud Foundry environment instance."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.cloud_foundry_environment_id))
    error_message = "cloud_foundry_environment_id must be a UUID."
  }
}

variable "manage_entitlements" {
  description = "Enable reviewed import or creation of the complete FlowPilot prerequisite entitlement set. Disabled for discovery and dry runs."
  type        = bool
  default     = false
  nullable    = false
}

variable "existing_entitlement_keys" {
  description = "Required entitlement keys already present and therefore imported when entitlement management is explicitly enabled."
  type        = set(string)
  default     = []
  nullable    = false

  validation {
    condition = alltrue([
      for key in var.existing_entitlement_keys : contains([
        "APPLICATION_RUNTIME/MEMORY",
        "application-logs/lite",
        "cloudfoundry/trial",
        "credstore/trial",
        "destination/lite",
        "postgresql-db/trial",
        "xsuaa/application",
      ], key)
    ])
    error_message = "existing_entitlement_keys contains an entitlement outside FlowPilot's reviewed prerequisite set."
  }

  validation {
    condition     = var.manage_entitlements || length(var.existing_entitlement_keys) == 0
    error_message = "existing_entitlement_keys must be empty while manage_entitlements is false."
  }
}

variable "validate_flowpilot_role_collections" {
  description = "Validate that the three XSUAA-created FlowPilot role collections exist after MTA deployment."
  type        = bool
  default     = false
  nullable    = false
}

variable "manage_flowpilot_role_assignments" {
  description = "Enable a reviewed post-deployment plan for FlowPilot user-to-role-collection assignments."
  type        = bool
  default     = false
  nullable    = false
}

variable "assign_current_user_as_flowpilot_admin" {
  description = "Assign the local-profile bootstrap operator to FlowPilotAdmins when role management is explicitly enabled."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition = !var.assign_current_user_as_flowpilot_admin || (
      var.manage_flowpilot_role_assignments &&
      var.current_user_name != null &&
      length(trimspace(var.current_user_name)) > 0
    )
    error_message = "assign_current_user_as_flowpilot_admin requires role management and a non-empty sensitive current_user_name."
  }
}

variable "current_user_name" {
  description = "Bootstrap operator identity from an ignored local profile. Terraform marks it sensitive and never discovers it through btp_whoami."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.current_user_name == null ? true : length(trimspace(var.current_user_name)) > 0
    error_message = "current_user_name must be null or a non-empty user name."
  }
}

variable "current_user_identity_provider_origin" {
  description = "Optional custom identity-provider origin for the currently authenticated user; leave null for SAP's default identity provider."
  type        = string
  default     = null

  validation {
    condition     = var.current_user_identity_provider_origin == null ? true : length(trimspace(var.current_user_identity_provider_origin)) > 0
    error_message = "current_user_identity_provider_origin must be null or a non-empty origin."
  }
}

variable "flowpilot_role_assignments" {
  description = "Additional post-deployment FlowPilot role assignments. Real identities belong only in ignored local inputs and protected state."
  type = map(object({
    role_collection_name = string
    user_name            = string
    origin               = optional(string)
  }))
  default   = {}
  nullable  = false
  sensitive = true

  validation {
    condition = alltrue([
      for assignment in values(var.flowpilot_role_assignments) :
      contains([
        "FlowPilotAdmins",
        "FlowPilotOperators",
        "FlowPilotUsers",
      ], assignment.role_collection_name) &&
      length(trimspace(assignment.user_name)) > 0 &&
      (assignment.origin == null ? true : length(trimspace(assignment.origin)) > 0)
    ])
    error_message = "Each role assignment needs a non-empty user, an optional non-empty origin, and one of the three reviewed FlowPilot role collections."
  }

  validation {
    condition     = var.manage_flowpilot_role_assignments || length(var.flowpilot_role_assignments) == 0
    error_message = "flowpilot_role_assignments must be empty while manage_flowpilot_role_assignments is false."
  }
}
