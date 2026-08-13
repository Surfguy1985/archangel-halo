/**
 * Falkon Ops — Capability Registry.
 *
 * Static registry of HALO ↔ Falkon capability mappings.
 * "mapped" = HALO has native data for this; "stub" = partial/placeholder.
 */

export type CapabilityStatus = "mapped" | "stub" | "unmapped";

export interface FalkonCapability {
  id: string;
  name: string;
  description: string;
  haloDataSource: string;
  status: CapabilityStatus;
  /** Falkon pipeline stage this capability feeds */
  pipelineStage?: string;
}

export const FALKON_CAPABILITIES: FalkonCapability[] = [
  // ─── Existing HALO workflows ───────────────────────────────────────────
  {
    id: "work-order",
    name: "Work Order",
    description: "Job creation, assignment, and completion tracking",
    haloDataSource: "jobs table + boardStatus",
    status: "mapped",
    pipelineStage: "scoping",
  },
  {
    id: "inspection",
    name: "Inspection",
    description: "Walk QC review and structured job checklists",
    haloDataSource: "Walk app + job_checklists table",
    status: "mapped",
    pipelineStage: "qc_review",
  },
  {
    id: "scheduling",
    name: "Scheduling",
    description: "Crew schedules and calendar event management",
    haloDataSource: "crew_schedules + calendar_events tables",
    status: "mapped",
    pipelineStage: "scheduled",
  },
  {
    id: "crew",
    name: "Crew Management",
    description: "Crew roster, assignments, and dispatch",
    haloDataSource: "crews + crew_jobs tables",
    status: "mapped",
    pipelineStage: "vendor_selection",
  },
  {
    id: "photos",
    name: "Photo Capture",
    description: "Before/after photo capture and storage",
    haloDataSource: "crew_photos table + Walk photo pipeline",
    status: "mapped",
    pipelineStage: "before_photos",
  },
  {
    id: "check-in",
    name: "GPS Check-In",
    description: "GPS arrival and departure tracking",
    haloDataSource: "crew_checkins table (lat/lng/kind)",
    status: "mapped",
    pipelineStage: "arriving",
  },
  {
    id: "field.checkin",
    name: "Field Check-In",
    description: "Hashed two-tap GPS check-in. Dispatch from HALO, never client jobId.",
    haloDataSource: "POST /checkin/:token/checkin + halo_field evidence",
    status: "mapped",
    pipelineStage: "arriving",
  },
  {
    id: "field.location",
    name: "Field Location",
    description: "Session-justified GPS trail while checked in. Stops at checkout.",
    haloDataSource: "POST /checkin/:token/location + crew_track_points + halo_field evidence",
    status: "mapped",
    pipelineStage: "arriving",
  },
  {
    id: "bid-estimate",
    name: "Bid & Estimate",
    description: "Bid creation and price-book line items",
    haloDataSource: "bids table + price_items",
    status: "mapped",
    pipelineStage: "scoping",
  },
  {
    id: "change-order",
    name: "Change Orders",
    description: "Client-initiated and field change orders",
    haloDataSource: "jobs.changeOrderStatus + change_orders flow",
    status: "mapped",
    pipelineStage: "work_in_progress",
  },
  {
    id: "invoice",
    name: "Invoice",
    description: "Invoice creation, line items, and PDF generation",
    haloDataSource: "invoices + job_line_items tables",
    status: "mapped",
    pipelineStage: "invoice_validation",
  },
  {
    id: "approval",
    name: "Approval",
    description: "Client walk approval and invoice approval actions",
    haloDataSource: "clientBoard approve_walk / approve actions",
    status: "mapped",
    pipelineStage: "approval_pending",
  },
  {
    id: "payment",
    name: "Payment",
    description: "Client payments and crew payouts",
    haloDataSource: "payments + crew_payments tables",
    status: "mapped",
    pipelineStage: "approval_pending",
  },
  {
    id: "asset-registry",
    name: "Asset Registry",
    description: "Property unit site-map boxes and Falkon unit twins",
    haloDataSource: "property_units (CMS) + falkon_units (twin)",
    status: "mapped",
    pipelineStage: "needs_turn",
  },
  {
    id: "notifications",
    name: "Notifications",
    description: "Push, SMS, and email notifications to crews and clients",
    haloDataSource: "activities + Expo push + Resend email",
    status: "mapped",
  },
  {
    id: "sop-engine",
    name: "SOP Engine",
    description: "AI-extracted billing rules and property SOPs",
    haloDataSource: "property_sop_rules table",
    status: "mapped",
  },
  {
    id: "documents",
    name: "Documents",
    description: "File storage, PDFs, and document management",
    haloDataSource: "Replit Object Storage (/api/storage/*)",
    status: "mapped",
  },

  // ─── New Falkon-specific capabilities ─────────────────────────────────
  {
    id: "property-registry",
    name: "Property Registry",
    description: "Property Twin sync: HALO properties → Falkon property records",
    haloDataSource: "properties table → Property Twin",
    status: "mapped",
    pipelineStage: "needs_turn",
  },
  {
    id: "unit-registry",
    name: "Unit Registry",
    description: "Unit/Asset Twin: stable UUID per unit label, synced to Falkon",
    haloDataSource: "falkon_units table → Unit Twin",
    status: "mapped",
    pipelineStage: "needs_turn",
  },
  {
    id: "vendor-registry",
    name: "Vendor Registry",
    description: "Vendor/Crew Twin sync: HALO crews → Falkon vendor records",
    haloDataSource: "crews + falkon_vendor_id → Vendor Twin",
    status: "mapped",
    pipelineStage: "vendor_selection",
  },
  {
    id: "make-ready",
    name: "Make-Ready Pipeline",
    description: "12-phase durable make-ready execution from needs-turn to resident-ready",
    haloDataSource: "falkon_executions pipeline",
    status: "mapped",
  },
  {
    id: "vendor-compliance",
    name: "Vendor Compliance",
    description: "COI verification, license tracking, and compliance status",
    haloDataSource: "crews.coi_expiry + falkon_compliance_status",
    status: "mapped",
    pipelineStage: "vendor_selection",
  },
  {
    id: "preventive-maintenance",
    name: "Preventive Maintenance",
    description: "Scheduled recurring maintenance tasks (stub — no PM data yet)",
    haloDataSource: "(stub — no PM data in HALO yet)",
    status: "stub",
  },
  {
    id: "turn-costing",
    name: "Turn Costing",
    description: "Job financials, margin guardian, and cost analysis",
    haloDataSource: "job financials + margin_pct + margin_min",
    status: "mapped",
    pipelineStage: "invoice_validation",
  },
  {
    id: "weather.risk_scan",
    name: "Weather Risk Scan",
    description: "Read-only Open-Meteo risk scan for HALO properties. No schedule write.",
    haloDataSource: "properties lat/lng + Open-Meteo forecast",
    status: "mapped",
    pipelineStage: "scheduled",
  },
  {
    id: "ops.eod_briefing",
    name: "End-of-Day Briefing",
    description: "HALO snapshot from Base44 projection, jobs, check-ins, and photos. Deterministic fallback.",
    haloDataSource: "jobs + crew_checkins + crew_photos + base44_evidence + halo_eod_briefings",
    status: "mapped",
  },
  {
    id: "catalog.lookup",
    name: "Catalog Lookup",
    description: "Jaccard matcher over HALO price_items and catalog_items. Read-only.",
    haloDataSource: "price_items + catalog_items",
    status: "mapped",
  },
  {
    id: "weather.schedule_recommend",
    name: "Weather Schedule Recommend",
    description: "Recommendation packet for weather-risk jobs. Never writes Base44 or HALO schedules.",
    haloDataSource: "jobs.scheduled_on + weather.risk_scan",
    status: "mapped",
    pipelineStage: "scheduled",
  },
  {
    id: "estimate.from_evidence",
    name: "Estimate from Evidence",
    description: "Draft line items from text or Walk captures + catalog match. Not an invoice.",
    haloDataSource: "walks + catalog matcher + halo_estimate_drafts",
    status: "mapped",
    pipelineStage: "scoping",
  },
  {
    id: "field.walk_report",
    name: "Walk Report",
    description: "HALO Walk completion projected into halo_walk evidence (outside Base44 sync).",
    haloDataSource: "walks + base44_evidence resource halo_walk",
    status: "mapped",
    pipelineStage: "qc_review",
  },
  {
    id: "comms.sms",
    name: "Crew SMS",
    description: "Twilio inbound store + Falkon-gated outbound. No worker inbox UI.",
    haloDataSource: "crews.phone + halo_sms_messages",
    status: "mapped",
  },
  {
    id: "field.voice_eod",
    name: "Voice EOD",
    description: "Outbound Vapi end-of-day call. ASSISTED approval required. Fail closed if unconfigured.",
    haloDataSource: "crews.phone + halo_voice_eod_calls + Vapi",
    status: "mapped",
  },
];

export const CAPABILITY_MAP = new Map(FALKON_CAPABILITIES.map((c) => [c.id, c]));

/** Returns the capability registry as a flat list for gateway registration. */
export function getCapabilityRegistration() {
  return FALKON_CAPABILITIES.map(({ id, status }) => ({ id, status }));
}
