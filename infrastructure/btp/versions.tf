terraform {
  required_version = ">= 1.15.0, < 1.16.0"

  required_providers {
    btp = {
      source  = "SAP/btp"
      version = "1.25.0"
    }
  }
}

provider "btp" {
  globalaccount = var.global_account_subdomain
}
