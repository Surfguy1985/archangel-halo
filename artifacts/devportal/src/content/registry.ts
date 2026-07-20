import billingService from "./billing-service.md?raw";
import billingIntegrationAddendum from "./billing-integration-addendum.md?raw";
import pricingModel from "./pricing-model.md?raw";
import pricingConfig from "./pricing-config.md?raw";

export interface DocEntry {
  slug: string;
  title: string;
  category: string;
  description: string;
  markdown: string;
}

export const docs: DocEntry[] = [
  {
    slug: "billing-service",
    title: "Billing Service",
    category: "Platform Services",
    description:
      "User-tier pricing, module Legos, Stripe collection, metering, dunning, Stripe Connect and enterprise routing.",
    markdown: billingService,
  },
  {
    slug: "billing-integration-addendum",
    title: "Billing Integration Addendum",
    category: "Platform Services",
    description:
      "Commercial source of truth, collection models (partner wholesale, HALO direct, Stripe Connect), charge timing, enterprise pricing boundaries, and integration sequence.",
    markdown: billingIntegrationAddendum,
  },
  {
    slug: "pricing-model",
    title: "User-Tier Pricing Model",
    category: "Commercial",
    description:
      "50-user pricing bands, a-la-carte module rates, API usage and overage pricing, wholesale calculator, enterprise triggers, and billing definitions.",
    markdown: pricingModel,
  },
  {
    slug: "pricing-config",
    title: "Pricing Configuration (JSON)",
    category: "Commercial",
    description:
      "Machine-readable pricing config v2.1.0: tiers, module rates, bundles, API overage bands, enterprise framework, and collection model.",
    markdown: pricingConfig,
  },
];
