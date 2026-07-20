# Pricing Configuration (JSON)

Machine-readable pricing configuration for the HALO platform, version 2.1.0. This file is the canonical input for the pricing engine: user tiers in 50-user bands, module rates and minimums, bundle discounts, API overage bands, enterprise triggers and the collection model.

Use this file to drive integrations, quoting tools and the billing service. The human-readable companion is the User-Tier Pricing Model document.

## Full configuration

```json
{
  "version": "2.1.0",
  "currency": "USD",
  "billing_model": "monthly_active_users_plus_modules_plus_metered_usage",
  "billing_interval": "monthly",
  "user_tier_increment": 50,
  "standard_max_users": 1000,
  "user_definition": "Unique monthly active end user across the partner tenant.",
  "tiers": [
    {
      "tier": "1-50",
      "min_users": 1,
      "max_users": 50,
      "core_monthly_fee": 995,
      "included_api_calls": 250000,
      "included_storage_gb": 112.5,
      "rate_limit_rps": 25,
      "effective_core_per_user": 19.9,
      "module_price_multiplier": 1.0,
      "support": "Standard"
    },
    {
      "tier": "51-100",
      "min_users": 51,
      "max_users": 100,
      "core_monthly_fee": 1445,
      "included_api_calls": 500000,
      "included_storage_gb": 125.0,
      "rate_limit_rps": 35,
      "effective_core_per_user": 14.45,
      "module_price_multiplier": 1.0,
      "support": "Standard"
    },
    {
      "tier": "101-150",
      "min_users": 101,
      "max_users": 150,
      "core_monthly_fee": 1870,
      "included_api_calls": 750000,
      "included_storage_gb": 137.5,
      "rate_limit_rps": 45,
      "effective_core_per_user": 12.466666666666667,
      "module_price_multiplier": 1.0,
      "support": "Standard"
    },
    {
      "tier": "151-200",
      "min_users": 151,
      "max_users": 200,
      "core_monthly_fee": 2270,
      "included_api_calls": 1000000,
      "included_storage_gb": 150.0,
      "rate_limit_rps": 55,
      "effective_core_per_user": 11.35,
      "module_price_multiplier": 1.0,
      "support": "Standard"
    },
    {
      "tier": "201-250",
      "min_users": 201,
      "max_users": 250,
      "core_monthly_fee": 2645,
      "included_api_calls": 1250000,
      "included_storage_gb": 162.5,
      "rate_limit_rps": 65,
      "effective_core_per_user": 10.58,
      "module_price_multiplier": 1.0,
      "support": "Standard"
    },
    {
      "tier": "251-300",
      "min_users": 251,
      "max_users": 300,
      "core_monthly_fee": 2995,
      "included_api_calls": 1500000,
      "included_storage_gb": 175.0,
      "rate_limit_rps": 75,
      "effective_core_per_user": 9.983333333333333,
      "module_price_multiplier": 0.9,
      "support": "Priority"
    },
    {
      "tier": "301-350",
      "min_users": 301,
      "max_users": 350,
      "core_monthly_fee": 3320,
      "included_api_calls": 1750000,
      "included_storage_gb": 187.5,
      "rate_limit_rps": 85,
      "effective_core_per_user": 9.485714285714286,
      "module_price_multiplier": 0.9,
      "support": "Priority"
    },
    {
      "tier": "351-400",
      "min_users": 351,
      "max_users": 400,
      "core_monthly_fee": 3620,
      "included_api_calls": 2000000,
      "included_storage_gb": 200.0,
      "rate_limit_rps": 95,
      "effective_core_per_user": 9.05,
      "module_price_multiplier": 0.9,
      "support": "Priority"
    },
    {
      "tier": "401-450",
      "min_users": 401,
      "max_users": 450,
      "core_monthly_fee": 3910,
      "included_api_calls": 2250000,
      "included_storage_gb": 212.5,
      "rate_limit_rps": 105,
      "effective_core_per_user": 8.688888888888888,
      "module_price_multiplier": 0.9,
      "support": "Priority"
    },
    {
      "tier": "451-500",
      "min_users": 451,
      "max_users": 500,
      "core_monthly_fee": 4185,
      "included_api_calls": 2500000,
      "included_storage_gb": 225.0,
      "rate_limit_rps": 115,
      "effective_core_per_user": 8.37,
      "module_price_multiplier": 0.9,
      "support": "Priority"
    },
    {
      "tier": "501-550",
      "min_users": 501,
      "max_users": 550,
      "core_monthly_fee": 4450,
      "included_api_calls": 2750000,
      "included_storage_gb": 237.5,
      "rate_limit_rps": 125,
      "effective_core_per_user": 8.090909090909092,
      "module_price_multiplier": 0.8,
      "support": "Advanced"
    },
    {
      "tier": "551-600",
      "min_users": 551,
      "max_users": 600,
      "core_monthly_fee": 4700,
      "included_api_calls": 3000000,
      "included_storage_gb": 250.0,
      "rate_limit_rps": 135,
      "effective_core_per_user": 7.833333333333333,
      "module_price_multiplier": 0.8,
      "support": "Advanced"
    },
    {
      "tier": "601-650",
      "min_users": 601,
      "max_users": 650,
      "core_monthly_fee": 4940,
      "included_api_calls": 3250000,
      "included_storage_gb": 262.5,
      "rate_limit_rps": 145,
      "effective_core_per_user": 7.6,
      "module_price_multiplier": 0.8,
      "support": "Advanced"
    },
    {
      "tier": "651-700",
      "min_users": 651,
      "max_users": 700,
      "core_monthly_fee": 5165,
      "included_api_calls": 3500000,
      "included_storage_gb": 275.0,
      "rate_limit_rps": 155,
      "effective_core_per_user": 7.378571428571429,
      "module_price_multiplier": 0.8,
      "support": "Advanced"
    },
    {
      "tier": "701-750",
      "min_users": 701,
      "max_users": 750,
      "core_monthly_fee": 5375,
      "included_api_calls": 3750000,
      "included_storage_gb": 287.5,
      "rate_limit_rps": 165,
      "effective_core_per_user": 7.166666666666667,
      "module_price_multiplier": 0.8,
      "support": "Advanced"
    },
    {
      "tier": "751-800",
      "min_users": 751,
      "max_users": 800,
      "core_monthly_fee": 5575,
      "included_api_calls": 4000000,
      "included_storage_gb": 300.0,
      "rate_limit_rps": 175,
      "effective_core_per_user": 6.96875,
      "module_price_multiplier": 0.7,
      "support": "Advanced"
    },
    {
      "tier": "801-850",
      "min_users": 801,
      "max_users": 850,
      "core_monthly_fee": 5765,
      "included_api_calls": 4250000,
      "included_storage_gb": 312.5,
      "rate_limit_rps": 185,
      "effective_core_per_user": 6.7823529411764705,
      "module_price_multiplier": 0.7,
      "support": "Advanced"
    },
    {
      "tier": "851-900",
      "min_users": 851,
      "max_users": 900,
      "core_monthly_fee": 5940,
      "included_api_calls": 4500000,
      "included_storage_gb": 325.0,
      "rate_limit_rps": 195,
      "effective_core_per_user": 6.6,
      "module_price_multiplier": 0.7,
      "support": "Advanced"
    },
    {
      "tier": "901-950",
      "min_users": 901,
      "max_users": 950,
      "core_monthly_fee": 6100,
      "included_api_calls": 4750000,
      "included_storage_gb": 337.5,
      "rate_limit_rps": 205,
      "effective_core_per_user": 6.421052631578948,
      "module_price_multiplier": 0.7,
      "support": "Advanced"
    },
    {
      "tier": "951-1000",
      "min_users": 951,
      "max_users": 1000,
      "core_monthly_fee": 6250,
      "included_api_calls": 5000000,
      "included_storage_gb": 350.0,
      "rate_limit_rps": 215,
      "effective_core_per_user": 6.25,
      "module_price_multiplier": 0.7,
      "support": "Advanced"
    }
  ],
  "modules": [
    {
      "name": "HALO Money",
      "description": "Banking connections, invoices, bills, payments, expenses and cash visibility.",
      "rate": 3.0,
      "minimum": 100,
      "meter": "Payment and bank-provider costs pass through.",
      "id": "money"
    },
    {
      "name": "HALO Books",
      "description": "Double-entry ledger, categorization, reconciliation, close and financial statements.",
      "rate": 6.0,
      "minimum": 250,
      "meter": "Optional outsourced bookkeeping priced separately.",
      "id": "books"
    },
    {
      "name": "HALO Tax",
      "description": "Tax readiness, obligations, workpapers, forms, preparer workflow and filing status.",
      "rate": 5.0,
      "minimum": 200,
      "meter": "Preparation, filing and government fees pass through.",
      "id": "tax"
    },
    {
      "name": "HALO Sell",
      "description": "CRM, leads, proposals, contracts, pipeline, customers and recurring billing.",
      "rate": 4.0,
      "minimum": 150,
      "meter": "Email/SMS delivery costs pass through.",
      "id": "sell"
    },
    {
      "name": "HALO Work",
      "description": "Projects, jobs, tasks, time, approvals, deliverables and job profitability.",
      "rate": 4.0,
      "minimum": 150,
      "meter": "Mapping or specialty field-service APIs pass through.",
      "id": "work"
    },
    {
      "name": "HALO Team",
      "description": "Employees, contractors, onboarding, permissions, time and payroll orchestration.",
      "rate": 3.0,
      "minimum": 100,
      "meter": "Payroll-provider and payment fees pass through.",
      "id": "team"
    },
    {
      "name": "HALO Documents",
      "description": "Document vault, templates, sharing, OCR and electronic signature workflows.",
      "rate": 2.0,
      "minimum": 75,
      "meter": "OCR and signature envelopes are usage-metered.",
      "id": "docs"
    },
    {
      "name": "HALO Analytics",
      "description": "Dashboards, KPIs, business health, forecasting and cross-module reporting.",
      "rate": 2.5,
      "minimum": 100,
      "meter": "Heavy warehouse/BI workloads may require enterprise pricing.",
      "id": "analytics"
    },
    {
      "name": "HALO Automations",
      "description": "Rules, triggers, approvals, schedules, webhooks and multi-step workflows.",
      "rate": 3.5,
      "minimum": 125,
      "meter": "High-volume workflow executions are usage-metered.",
      "id": "automation"
    },
    {
      "name": "HALO AI",
      "description": "Business copilot, document intelligence, recommendations and controlled actions.",
      "rate": 5.0,
      "minimum": 200,
      "meter": "Model, token, voice and image costs pass through plus service fee.",
      "id": "ai"
    },
    {
      "name": "HALO Connector Hub",
      "description": "Provider-neutral connectors, sync jobs, credentials, mapping and event routing.",
      "rate": 2.0,
      "minimum": 100,
      "meter": "Third-party connector licenses pass through.",
      "id": "integrations"
    }
  ],
  "bundles": [
    {
      "id": "business_essentials",
      "name": "Business Essentials",
      "modules": [
        "HALO Money",
        "HALO Books",
        "HALO Tax",
        "HALO Documents",
        "HALO Analytics"
      ],
      "discount_pct": 0.15
    },
    {
      "id": "operations_suite",
      "name": "Operations Suite",
      "modules": [
        "HALO Sell",
        "HALO Work",
        "HALO Team",
        "HALO Documents",
        "HALO Automations"
      ],
      "discount_pct": 0.15
    },
    {
      "id": "full_business_os",
      "name": "Full Business OS",
      "modules": [
        "HALO Money",
        "HALO Books",
        "HALO Tax",
        "HALO Sell",
        "HALO Work",
        "HALO Team",
        "HALO Documents",
        "HALO Analytics",
        "HALO Automations",
        "HALO AI",
        "HALO Connector Hub"
      ],
      "discount_pct": 0.25
    }
  ],
  "api_usage": {
    "included_calls_formula": "5000 * tier.max_users",
    "overage_bands": [
      {
        "excess_calls_from": 0,
        "excess_calls_to": 10000000,
        "usd_per_1000_calls": 0.75
      },
      {
        "excess_calls_from": 10000001,
        "excess_calls_to": 50000000,
        "usd_per_1000_calls": 0.5
      }
    ],
    "enterprise_trigger_calls": 50000000,
    "enterprise_trigger_rps": 250,
    "storage_overage_usd_per_gb_month": 0.1,
    "third_party_service_fee_pct": 0.2
  },
  "enterprise": {
    "eligibility_triggers": [
      "More than 1,000 monthly active users",
      "More than 50 million API calls per month",
      "Sustained throughput above 250 requests per second",
      "Dedicated environment, region or data residency",
      "99.95% or higher contractual SLA",
      "Custom compliance, security or audit requirements",
      "24/7 support or named technical account management"
    ],
    "commercial_framework": {
      "annual_platform_commitment": "$75,000-$250,000+",
      "monthly_active_user_rate": "$2-$6 per MAU",
      "api_rate": "$0.08-$0.35 per 1,000 calls",
      "dedicated_environment": "$3,000-$15,000 per month",
      "implementation": "$25,000-$250,000 one time",
      "premium_support_and_sla": "10%-20% of annual contract value",
      "security_and_compliance_package": "$15,000-$100,000 per year",
      "term": "12-36 months"
    }
  },
  "professional_services": {
    "included": false,
    "note": "Bookkeeping, tax preparation, legal, implementation and managed services are separate SKUs."
  },
  "collection_model": {
    "default": "partner_wholesale",
    "fixed_fees": "billed_in_advance",
    "usage_true_ups": "billed_in_arrears",
    "standard_collection": "stripe_charge_automatically",
    "enterprise_collection": "stripe_send_invoice_or_wire",
    "third_party_costs": "pass_through_plus_service_fee"
  }
}
```
