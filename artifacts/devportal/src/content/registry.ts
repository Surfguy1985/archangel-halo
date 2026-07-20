import billingService from "./billing-service.md?raw";
import billingIntegrationAddendum from "./billing-integration-addendum.md?raw";

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
];
