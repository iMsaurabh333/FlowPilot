locals {
  required_entitlements = {
    "APPLICATION_RUNTIME/MEMORY" = {
      service_name = "APPLICATION_RUNTIME"
      plan_name    = "MEMORY"
      amount       = 4
    }
    "application-logs/lite" = {
      service_name = "application-logs"
      plan_name    = "lite"
      amount       = null
    }
    "cloudfoundry/trial" = {
      service_name = "cloudfoundry"
      plan_name    = "trial"
      amount       = null
    }
    "credstore/trial" = {
      service_name = "credstore"
      plan_name    = "trial"
      amount       = 1
    }
    "destination/lite" = {
      service_name = "destination"
      plan_name    = "lite"
      amount       = null
    }
    "postgresql-db/trial" = {
      service_name = "postgresql-db"
      plan_name    = "trial"
      amount       = 1
    }
    "xsuaa/application" = {
      service_name = "xsuaa"
      plan_name    = "application"
      amount       = null
    }
  }
}

data "btp_subaccount" "current" {
  id = var.subaccount_id

  lifecycle {
    postcondition {
      condition     = self.state == "OK"
      error_message = "The selected SAP BTP subaccount is not in state OK."
    }

    postcondition {
      condition     = self.name == var.subaccount_name && self.subdomain == var.subaccount_subdomain && self.region == var.region
      error_message = "The selected subaccount does not match the expected name, subdomain, and region."
    }
  }
}

data "btp_subaccount_entitlements" "current" {
  subaccount_id = data.btp_subaccount.current.id
}

data "btp_subaccount_environment_instance" "cloud_foundry" {
  subaccount_id = data.btp_subaccount.current.id
  id            = var.cloud_foundry_environment_id

  lifecycle {
    postcondition {
      condition     = self.state == "OK"
      error_message = "The selected Cloud Foundry environment instance is not in state OK."
    }

    postcondition {
      condition     = lower(self.service_name) == "cloudfoundry"
      error_message = "The selected environment instance is not Cloud Foundry."
    }
  }
}

locals {
  discovered_entitlements = {
    for entitlement in values(data.btp_subaccount_entitlements.current.values) :
    "${entitlement.service_name}/${entitlement.plan_name}" => entitlement
  }

  missing_required_entitlements = setsubtract(
    toset(keys(local.required_entitlements)),
    toset(keys(local.discovered_entitlements)),
  )

  existing_entitlements_to_import = var.manage_entitlements ? {
    for key in var.existing_entitlement_keys : key => local.required_entitlements[key]
  } : {}
}

check "required_entitlements" {
  assert {
    condition     = length(local.missing_required_entitlements) == 0
    error_message = "The subaccount is missing one or more FlowPilot prerequisite entitlements. Review the missing_required_entitlements output before adding resources or applying changes."
  }
}

resource "btp_subaccount_entitlement" "required" {
  for_each = var.manage_entitlements ? local.required_entitlements : {}

  subaccount_id = data.btp_subaccount.current.id
  service_name  = each.value.service_name
  plan_name     = each.value.plan_name
  amount        = each.value.amount

  lifecycle {
    prevent_destroy = true
  }
}

import {
  for_each = local.existing_entitlements_to_import

  to = btp_subaccount_entitlement.required[each.key]
  identity = {
    subaccount_id = var.subaccount_id
    service_name  = each.value.service_name
    plan_name     = each.value.plan_name
  }
}
