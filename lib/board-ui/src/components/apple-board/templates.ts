import { Wrench, User, FileText, DollarSign, Key, Package, Paintbrush, Clipboard, Handshake, Plus, HelpCircle, FileCheck, CalendarClock, Lock, FileSearch, PlayCircle, Home, AlertTriangle, Leaf } from 'lucide-react';

export interface AppleTemplate {
  key: string;
  name: string;
  icon: any;
  description: string;
  category: 'maintenance' | 'lease' | 'rent' | 'move' | 'coordination' | 'blank' | 'vendor' | 'billing' | 'access';
  priority: 'normal' | 'high' | 'urgent';
  checklist?: string[];
  labelPreset?: string;
}

export const PM_TEMPLATES: AppleTemplate[] = [
  {
    key: 'work_order',
    name: 'Work Order',
    icon: Wrench,
    description: 'Track a maintenance or repair task',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'maintenance',
    checklist: ['Describe issue', 'Assign vendor', 'Schedule work', 'Verify complete'],
  },
  {
    key: 'tenant_issue',
    name: 'Tenant Issue',
    icon: User,
    description: 'Log and resolve a tenant concern',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'tenant',
    checklist: ['Log complaint', 'Contact tenant', 'Resolve issue', 'Follow up'],
  },
  {
    key: 'lease_renewal',
    name: 'Lease Renewal',
    icon: FileText,
    description: 'Manage a lease renewal process',
    category: 'lease',
    priority: 'normal',
    labelPreset: 'lease',
    checklist: ['Pull current lease', 'Draft new terms', 'Send to tenant', 'Signed'],
  },
  {
    key: 'rent_collection',
    name: 'Rent Collection',
    icon: DollarSign,
    description: 'Track rent payment follow-up',
    category: 'rent',
    priority: 'high',
    labelPreset: 'rent',
    checklist: ['Send reminder', 'Record payment', 'Late fee if needed'],
  },
  {
    key: 'move_in',
    name: 'Move-In',
    icon: Key,
    description: 'Coordinate a new tenant move-in',
    category: 'move',
    priority: 'normal',
    labelPreset: 'move',
    checklist: ['Inspection', 'Keys handoff', 'Utilities on', 'Welcome packet'],
  },
  {
    key: 'move_out',
    name: 'Move-Out',
    icon: Package,
    description: 'Process a tenant departure',
    category: 'move',
    priority: 'normal',
    labelPreset: 'move',
    checklist: ['Notice received', 'Final inspection', 'Deposit reconciliation', 'List unit'],
  },
  {
    key: 'unit_turnover',
    name: 'Unit Turnover',
    icon: Paintbrush,
    description: 'Ready a vacant unit for market',
    category: 'maintenance',
    priority: 'high',
    labelPreset: 'turnover',
    checklist: ['Clean unit', 'Paint walls', 'Repairs', 'Photos', 'List unit'],
  },
  {
    key: 'inspection',
    name: 'Inspection',
    icon: Clipboard,
    description: 'Schedule and document inspections',
    category: 'coordination',
    priority: 'normal',
    labelPreset: 'inspection',
    checklist: ['Schedule time', 'Walk units', 'File report'],
  },
  {
    key: 'vendor_coordination',
    name: 'Vendor Coordination',
    icon: Handshake,
    description: 'Coordinate external service work',
    category: 'coordination',
    priority: 'normal',
    labelPreset: 'vendor',
    checklist: ['Get quotes', 'Pick vendor', 'Schedule work', 'Review quality'],
  },
  {
    key: 'blank',
    name: 'Blank Card',
    icon: Plus,
    description: 'Start from scratch',
    category: 'blank',
    priority: 'normal',
  },
];

export const VENDOR_TEMPLATES: AppleTemplate[] = [
  {
    key: 'maintenance_request',
    name: 'Maintenance Request',
    icon: Wrench,
    description: 'Request work from the office',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'request',
    checklist: ['Describe issue', 'Provide unit/location', 'Attach photos'],
  },
  {
    key: 'vendor_question',
    name: 'Vendor Question',
    icon: HelpCircle,
    description: 'Ask a question about a job',
    category: 'vendor',
    priority: 'normal',
    labelPreset: 'question',
  },
  {
    key: 'approval_needed',
    name: 'Approval Needed',
    icon: FileCheck,
    description: 'Request sign-off on a quote or scope',
    category: 'coordination',
    priority: 'high',
    labelPreset: 'approval',
  },
  {
    key: 'schedule_change',
    name: 'Schedule Change',
    icon: CalendarClock,
    description: 'Notify office of timing changes',
    category: 'coordination',
    priority: 'normal',
    labelPreset: 'schedule',
  },
  {
    key: 'billing_question',
    name: 'Billing Question',
    icon: DollarSign,
    description: 'Inquire about an invoice',
    category: 'billing',
    priority: 'normal',
    labelPreset: 'billing',
  },
  {
    key: 'site_access_note',
    name: 'Site Access Note',
    icon: Lock,
    description: 'Key, gate, or tenant access info',
    category: 'access',
    priority: 'normal',
    labelPreset: 'access',
  },
  {
    key: 'request_bid',
    name: 'Request Bid',
    icon: FileSearch,
    description: 'Ask for a quote or estimate',
    category: 'vendor',
    priority: 'normal',
    labelPreset: 'bid',
    checklist: ['Review scope', 'Submit estimate', 'Awaiting approval'],
  },
  {
    key: 'start_new_job',
    name: 'Start New Job',
    icon: PlayCircle,
    description: 'Begin new authorized work',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'job',
    checklist: ['Crew dispatched', 'Materials sourced', 'Work in progress', 'Final clean up'],
  },
  {
    key: 'add_a_unit',
    name: 'Add a Unit',
    icon: Home,
    description: 'Manage work specific to a unit',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'unit',
    checklist: ['Unit #:', 'Tenant notified', 'Work completed'],
  },
  {
    key: 'unit_turnover',
    name: 'Unit Turnover',
    icon: Paintbrush,
    description: 'Ready a vacant unit for new tenant',
    category: 'maintenance',
    priority: 'high',
    labelPreset: 'turnover',
    checklist: ['Trash out', 'Paint', 'Carpet/Floors', 'Deep clean', 'Final walk'],
  },
  {
    key: 'emergency_repair',
    name: 'Emergency Repair',
    icon: AlertTriangle,
    description: 'Urgent issue requiring immediate action',
    category: 'maintenance',
    priority: 'urgent',
    labelPreset: 'emergency',
    checklist: ['Mitigate damage', 'Assess root cause', 'Permanent fix', 'Report to management'],
  },
  {
    key: 'landscaping_request',
    name: 'Landscaping Request',
    icon: Leaf,
    description: 'Groundskeeping or outdoor maintenance',
    category: 'maintenance',
    priority: 'normal',
    labelPreset: 'landscaping',
    checklist: ['Inspect area', 'Complete service', 'Remove debris'],
  },
  {
    key: 'inspection_request',
    name: 'Inspection Request',
    icon: Clipboard,
    description: 'Schedule a formal site or unit inspection',
    category: 'coordination',
    priority: 'normal',
    labelPreset: 'inspection',
    checklist: ['Schedule date/time', 'Conduct walkthrough', 'Generate report', 'Send to office'],
  },
  {
    key: 'blank',
    name: 'Blank Card',
    icon: Plus,
    description: 'Start from scratch',
    category: 'blank',
    priority: 'normal',
  },
];

// Palette lives in ./palette (dependency-free) so the contrast guard can
// import it without pulling in lucide/react; re-exported here to keep the
// existing import surface unchanged.
export { APPLE_CATEGORY_COLORS, APPLE_CATEGORY_TEXT } from './palette';

// ---------------------------------------------------------------------------
// HARDENING: audience-aware template resolution.
//
// `unit_turnover` and `blank` exist in BOTH arrays with different icons and
// categories. The old lookup (`PM_TEMPLATES.find(...) || VENDOR_TEMPLATES
// .find(...)`) let PM win unconditionally, so vendor cards silently rendered
// with PM styling. Stored cards keep their existing keys — nothing in the DB
// changes — the fix is resolving against the viewer's own catalog first.
// ---------------------------------------------------------------------------

export type BoardAudience = 'pm' | 'vendor';

export function resolveTemplate(
  key: string | null | undefined,
  audience?: BoardAudience,
): AppleTemplate | undefined {
  if (!key) return undefined;
  const primary = audience === 'vendor' ? VENDOR_TEMPLATES : PM_TEMPLATES;
  const secondary = audience === 'vendor' ? PM_TEMPLATES : VENDOR_TEMPLATES;
  return primary.find((t) => t.key === key) ?? secondary.find((t) => t.key === key);
}

// Boot-time guard for the NEXT collision. Duplicate keys inside one catalog
// are a bug outright; cross-catalog duplicates are allowed (resolved by
// audience above) but logged so they're a decision, not an accident.
if ((globalThis as any).process?.env?.NODE_ENV !== 'production') {
  for (const [label, arr] of [['PM_TEMPLATES', PM_TEMPLATES], ['VENDOR_TEMPLATES', VENDOR_TEMPLATES]] as const) {
    const seen = new Set<string>();
    for (const t of arr) {
      if (seen.has(t.key)) console.error(`[templates] duplicate key "${t.key}" inside ${label}`);
      seen.add(t.key);
    }
  }
  const pmKeys = new Set(PM_TEMPLATES.map((t) => t.key));
  for (const t of VENDOR_TEMPLATES) {
    if (pmKeys.has(t.key)) console.warn(`[templates] "${t.key}" exists in both catalogs — resolved by audience`);
  }
}
