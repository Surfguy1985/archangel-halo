import billingService from "./billing-service.md?raw";

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
];
