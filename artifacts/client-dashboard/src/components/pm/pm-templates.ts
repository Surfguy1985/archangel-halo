import { Wrench, User, FileText, DollarSign, Key, Package, Paintbrush, Clipboard, Handshake, Plus } from 'lucide-react';

export interface PmTemplate {
  key: string;
  name: string;
  icon: typeof Wrench;
  description: string;
  category: 'maintenance' | 'lease' | 'rent' | 'move' | 'coordination' | 'blank';
  priority: 'normal' | 'high' | 'urgent';
  checklist?: string[];
  labelPreset?: string;
}

export const PM_TEMPLATES: PmTemplate[] = [
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

export const PM_CATEGORY_COLORS: Record<string, string> = {
  maintenance: '#007AFF',
  lease: '#34C759',
  rent: '#FF9500',
  move: '#5856D6',
  coordination: '#AF52DE',
  blank: '#8E8E93',
};
