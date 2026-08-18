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
