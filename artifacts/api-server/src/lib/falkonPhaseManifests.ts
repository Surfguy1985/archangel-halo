/**
 * Falkon Network — Phase 2–6 dormant manifests.
 *
 * Phase 1 is always active (bootstrapped via DB). These manifests describe
 * planned capabilities for Phases 2–6. They are inert until an operator runs
 * the activation command. Financial or autonomous behaviour is NEVER executed
 * for a dormant phase.
 */

export interface PhaseCapabilityPreview {
  id: string;
  name: string;
  description: string;
}

export interface PhaseManifest {
  phase: number;
  name: string;
  description: string;
  capabilities: PhaseCapabilityPreview[];
  prerequisites: string[];
  whatThisUnlocks: string;
  /**
   * Tracks build / activation progress for this phase.
   *   undefined  — not yet built (default for phases 4–6)
   *   "draft"    — implementation built; activation prerequisites not met
   *   "active"   — commercially activated (all prerequisites satisfied)
   */
  builtState?: "draft" | "active";
}

export const PHASE_MANIFESTS: PhaseManifest[] = [
  {
    phase: 1,
    name: "Network Node",
    description:
      "HALO is a first-class Falkon Network node with a published business identity, Ed25519-signed trust, a production capability catalog, and UR Founders as its first verified peer.",
    capabilities: [
      {
        id: "property-management-platform",
        name: "Property Management Platform",
        description:
          "Onboard and manage residential and commercial properties with full operations workflow — work orders, vendors, scheduling, and billing.",
      },
      {
        id: "property-operations-workflow",
        name: "Property Operations Workflow",
        description:
          "End-to-end work order lifecycle from initial request through completion, client approval, and invoice.",
      },
      {
        id: "contractor-make-ready-ops",
        name: "Contractor Make-Ready Operations",
        description:
          "12-phase make-ready pipeline: scope → vendor selection → scheduling → arrival → photos → QC → invoice approval → resident-ready.",
      },
      {
        id: "job-dispatch-discovery",
        name: "Job & Dispatch Discovery",
        description:
          "Discover available crew capacity and request dispatch for service jobs within the Falkon Network.",
      },
    ],
    prerequisites: [
      "Ed25519 signing identity active",
      "UR Founders peer registered",
      "Production trust document served",
    ],
    whatThisUnlocks:
      "HALO can receive and approve inbound capability requests from UR Founders, send outbound requests for entity formation and compliance, and provide live status tracking for all cross-business work.",
  },
  {
    phase: 2,
    name: "Connected Companies",
    description:
      "Universal Falkon Requests across many businesses. Any registered Falkon peer can request HALO capabilities and HALO can proactively reach any peer.",
    capabilities: [
      {
        id: "multi-business-request-network",
        name: "Multi-Business Request Network",
        description:
          "Accept and route capability requests from any verified Falkon peer, not just UR Founders.",
      },
      {
        id: "company-directory",
        name: "Company Directory",
        description:
          "Browse and connect with businesses in the broader Falkon Network.",
      },
      {
        id: "universal-cross-business-requests",
        name: "Universal Cross-Business Requests",
        description:
          "Initiate outbound requests to any Falkon-registered business for any mapped capability.",
      },
    ],
    prerequisites: [
      "Phase 1 active",
      "At least 1 cross-business request fulfilled",
      "Gateway ASSISTED mode or higher",
      "Peer directory endpoint registered",
    ],
    whatThisUnlocks:
      "HALO becomes a full participant in the Falkon Network marketplace — discoverable by any peer and able to reach any registered business for cross-business work.",
  },
  {
    phase: 3,
    name: "Falkon Exchange",
    description:
      "Publish HALO microservices, APIs, and workflow capabilities as structured products on the Falkon Exchange with ownership and revenue metadata.",
    capabilities: [
      {
        id: "exchange-listings",
        name: "Exchange Listings",
        description:
          "List HALO capabilities as purchasable services with pricing, SLA, and availability metadata.",
      },
      {
        id: "api-marketplace",
        name: "API Marketplace",
        description:
          "Expose HALO APIs for programmatic consumption by partner businesses with metered billing.",
      },
      {
        id: "workflow-products",
        name: "Workflow Products",
        description:
          "Package HALO operational workflows (make-ready, inspection, billing) as licensable products.",
      },
    ],
    prerequisites: [
      "Phase 2 active",
      "LIVE mode active",
      "At least 5 fulfilled cross-business requests",
      "Exchange merchant agreement accepted",
    ],
    whatThisUnlocks:
      "HALO generates revenue from its operational excellence by licensing make-ready, property management, and dispatch capabilities to other businesses on the Falkon Exchange.",
    // Phase 3 is built and in draft-ready state. Commercial activation requires
    // all four prerequisites to be satisfied — enforced at /exchange/activate.
    builtState: "draft",
  },
  {
    phase: 4,
    name: "Economic Network",
    description:
      "Falkon partner rate cards, referral and revenue relationships, procurement rails, reputation scoring, and Premio-compatible shared-reward hooks.",
    capabilities: [
      {
        id: "partner-rate-cards",
        name: "Partner Rate Cards",
        description:
          "Negotiate and publish preferred pricing with Falkon network partners for recurring cross-business work.",
      },
      {
        id: "referral-revenue-sharing",
        name: "Referral & Revenue Sharing",
        description:
          "Earn and distribute revenue for cross-network referrals, introductions, and fulfillments.",
      },
      {
        id: "procurement-rails",
        name: "Procurement Rails",
        description:
          "Automate purchase orders and vendor onboarding across the Falkon Network.",
      },
      {
        id: "premio-reward-hooks",
        name: "Premio Reward Hooks",
        description:
          "Share loyalty and reward events with Premio-compatible partner programs.",
      },
    ],
    prerequisites: [
      "Phase 3 active",
      "Revenue sharing agreement in place",
      "Reputation score ≥ 4.5",
      "At least 3 Exchange listings live",
    ],
    whatThisUnlocks:
      "HALO participates in the full economic layer of the Falkon Network — earning referral fees, sharing revenue with partners, and benefiting from the network's collective procurement power.",
  },
  {
    phase: 5,
    name: "Agent-to-Agent Commerce",
    description:
      "Permissioned business-agent negotiation and fulfillment. JARVIS can autonomously negotiate and fulfill cross-business requests within defined policy bounds.",
    capabilities: [
      {
        id: "agent-negotiation",
        name: "Agent Negotiation",
        description:
          "JARVIS autonomously negotiates terms with peer business agents for routine cross-business work.",
      },
      {
        id: "autonomous-fulfillment",
        name: "Autonomous Fulfillment",
        description:
          "End-to-end fulfillment without human intervention for pre-approved capability types within policy bounds.",
      },
      {
        id: "policy-governed-delegation",
        name: "Policy-Governed Delegation",
        description:
          "Human-in-the-loop overrides and policy guardrails ensure every autonomous action is bounded and auditable.",
      },
    ],
    prerequisites: [
      "Phase 4 active",
      "Agent policy configuration complete",
      "Human-in-the-loop override layer active",
      "Security audit complete",
    ],
    whatThisUnlocks:
      "JARVIS becomes a full economic agent — able to source, negotiate, and close cross-business work on HALO's behalf while keeping humans in control of policy and exception handling.",
  },
  {
    phase: 6,
    name: "Falkon Protocol",
    description:
      "External AI agents and enterprise systems (ERP, CRM, facility management) integrate with HALO via the Falkon Protocol standard.",
    capabilities: [
      {
        id: "protocol-gateway",
        name: "Protocol Gateway",
        description:
          "Accept and route requests from any Falkon Protocol-compatible agent or enterprise system.",
      },
      {
        id: "enterprise-integration",
        name: "Enterprise Integration",
        description:
          "Bidirectional sync with ERP, CRM, and facility management platforms via the Falkon Protocol.",
      },
      {
        id: "external-agent-access",
        name: "External Agent Access",
        description:
          "Third-party AI agents can query HALO capabilities and request work fulfillment via structured Protocol messages.",
      },
    ],
    prerequisites: [
      "Phase 5 active",
      "Protocol specification audit complete",
      "Security review passed",
      "Enterprise integration agreements in place",
    ],
    whatThisUnlocks:
      "HALO becomes a Protocol-level participant in the broader AI-economy — accessible to enterprise systems and external agents as a trusted operational node.",
  },
];

/** The four Phase-1 capabilities published in HALO's catalog. */
export const PHASE1_CAPABILITIES = PHASE_MANIFESTS[0]!.capabilities;
