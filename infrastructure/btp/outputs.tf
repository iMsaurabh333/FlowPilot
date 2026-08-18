output "validated_target" {
  description = "Non-secret summary of the existing BTP and Cloud Foundry target."
  value = {
    subaccount_name      = data.btp_subaccount.current.name
    subaccount_subdomain = data.btp_subaccount.current.subdomain
    region               = data.btp_subaccount.current.region
    subaccount_state     = data.btp_subaccount.current.state
    environment_service  = data.btp_subaccount_environment_instance.cloud_foundry.service_name
    environment_plan     = data.btp_subaccount_environment_instance.cloud_foundry.plan_name
    environment_state    = data.btp_subaccount_environment_instance.cloud_foundry.state
  }
}

output "required_entitlement_status" {
  description = "Category and assigned quota for the FlowPilot prerequisite entitlements discovered in the subaccount."
  value = {
    for key, entitlement in local.discovered_entitlements : key => {
      category       = entitlement.category
      quota_assigned = entitlement.quota_assigned
    } if contains(keys(local.required_entitlements), key)
  }
}

output "missing_required_entitlements" {
  description = "Prerequisite entitlement keys that discovery could not find; this must be empty before MTA deployment."
  value       = sort(tolist(local.missing_required_entitlements))
}

output "validated_flowpilot_role_collections" {
  description = "Post-deployment FlowPilot role collections found by the optional validation gate."
  value = {
    for name, collection in data.btp_subaccount_role_collection.flowpilot : name => {
      description = collection.description
      read_only   = collection.read_only
    }
  }
}
