/**
 * TEMPLATE REGISTRY — the 22 card types.
 * Each template declares its pipeline, its module grammar, which action fires
 * from the primary/secondary button, and the automations that run when the card
 * enters a given stage.  This is the single source of truth the board renders
 * from and the automation engine reads.
 */
export const TEMPLATES = {
  wo:        { name:'Work Order',              category:'maintenance', sla:240,
               pipeline:['Reported','Dispatched','On Site','Parts Hold','QC','Closed'],
               modules:['time','progress','check','stack'],
               actions:{ approve:'maint.dispatch_tech', deny:'maint.hold_for_parts' },
               onEnter:{ Dispatched:['sms.resident.window','tech_app.push'], QC:['photo.qc_required'], Closed:['survey.send','invoice.expect'] } },

  makeready: { name:'Make-Ready / Turn',       category:'maintenance', sla:2880,
               pipeline:['Vacated','Scoped','Trades','Punch','Inspected','Rent Ready'],
               modules:['time','progress','check','photos','stack'],
               actions:{ approve:'turn.release_for_reinspection', deny:'turn.hold_unit' },
               onEnter:{ Punch:['inspection.schedule'], 'Rent Ready':['leasing.unit_available','access.revoke_vendor_keys','marketing.publish'] } },

  invoice:   { name:'Invoice',                 category:'money', sla:1440,
               pipeline:['Received','Coded','Approved','Scheduled','Paid'],
               modules:['money','docs','approve','stack'],
               actions:{ approve:'ap.approve_invoice', deny:'ap.hold_invoice' },
               onEnter:{ Approved:['ap.queue_for_run','notify.vendor'], Paid:['ledger.post','budget.actualize'] } },

  aprun:     { name:'Payment Run',             category:'money', sla:600,
               pipeline:['Assembling','Manager OK','Owner OK','Funded','Sent'],
               modules:['money','bars','split','time','approve'],
               actions:{ approve:'ap.release_payment_run', deny:'ap.split_payment_run' },
               onEnter:{ 'Owner OK':['notify.owner'], Funded:['ach.generate'], Sent:['remittance.email','ledger.post'] } },

  crew:      { name:'Vendor Crew — Live Job',  category:'vendor', sla:300,
               pipeline:['Dispatched','En Route','On Site','Wrapping','Signed Off'],
               modules:['roster','scope','progress','photos','findings','time','report','stack'],
               actions:{ approve:'vendor.signoff_job', deny:'vendor.reject_job',
                         findings:'maint.create_work_order_from_finding',
                         map:'crew.locate_requested', report:'vendor.job_report_opened' },
               onEnter:{ 'On Site':['geofence.arm','photo.before_required'],
                         Wrapping:['photo.after_required','findings.review'],
                         'Signed Off':['report.generate','access.revoke_credentials','ap.invoice_expected'] } },

  change:    { name:'Change Order',            category:'vendor', sla:180,
               pipeline:['Submitted','Priced','Manager OK','Owner OK','Merged'],
               modules:['money','photos','time','approve'],
               actions:{ approve:'vendor.approve_change_order', deny:'vendor.deny_change_order' },
               onEnter:{ 'Manager OK':['budget.commit'], Merged:['job.scope_updated','crew.unblock'] } },

  coi:       { name:'COI / Compliance',        category:'compliance', sla:43200,
               pipeline:['Requested','Received','Verified','On File','Expiring'],
               modules:['docs','time','approve','stack'],
               actions:{ approve:'compliance.request_coi_renewal', deny:'compliance.suspend_vendor' },
               onEnter:{ Expiring:['notify.vendor','jobs.flag_uninsured'], 'On File':['vendor.unblock'] } },

  supply:    { name:'Supply Order',            category:'vendor', sla:1440,
               pipeline:['Drafted','Approved','Ordered','Shipped','Received'],
               modules:['bars','items','split','approve'],
               actions:{ approve:'purchasing.issue_po', deny:'purchasing.edit_draft' },
               onEnter:{ Approved:['budget.reserve'], Received:['inventory.increment','par.rebaseline'] } },

  dispatch:  { name:'Schedule & Dispatch',     category:'maintenance', sla:240,
               pipeline:['Draft','Balanced','Published','Running','Reconciled'],
               modules:['bars','check','split','time','approve'],
               actions:{ approve:'dispatch.autobalance_route', deny:'dispatch.assign_manually' },
               onEnter:{ Published:['tech_app.push','sms.resident.windows'], Reconciled:['payroll.hours_posted'] } },

  key:       { name:'Virtual Key / NFC',       category:'access', sla:480,
               pipeline:['Issued','Active','Used','Expired','Revoked'],
               modules:['key','log','time'],
               actions:{ approve:'access.extend_credential', deny:'access.revoke_credential' },
               onEnter:{ Expired:['access.auto_revoke'], Revoked:['audit.access_closed'] } },

  msg:       { name:'Resident Thread',         category:'people', sla:120,
               pipeline:['New','Read','Replied','Resolved','Surveyed'],
               modules:['thread','split','time','approve','stack'],
               actions:{ approve:'comms.send_suggested_reply', deny:'comms.open_composer' },
               onEnter:{ Replied:['sla.response_met'], Resolved:['survey.send'] } },

  occ:       { name:'Occupancy & Exposure',    category:'intel', sla:null,
               pipeline:['Live','Weekly','Monthly','Trailing','Forecast'],
               modules:['metric','bars','split','approve'],
               actions:{ approve:'leasing.prioritize_gap_units', deny:'ops.snooze_card' },
               onEnter:{ Forecast:['owner.report_scheduled'] } },

  tour:      { name:'Tour / Lead',             category:'leasing', sla:1440,
               pipeline:['Inquiry','Contacted','Toured','Applied','Leased'],
               modules:['score','time','check','split','approve','stack'],
               actions:{ approve:'leasing.confirm_tour_and_hold', deny:'leasing.release_unit' },
               onEnter:{ Toured:['followup.schedule'], Applied:['screening.run'], Leased:['turn.priority_raise','promo.redeem'] } },

  renewal:   { name:'Lease Renewal',           category:'leasing', sla:14400,
               pipeline:['Eligible','Offered','Negotiating','Signed','Declined'],
               modules:['score','money','bars','split','approve'],
               actions:{ approve:'leasing.send_renewal_offer', deny:'leasing.adjust_renewal_rate' },
               onEnter:{ Offered:['notify.resident','reminder.schedule'], Declined:['turn.forecast','marketing.publish'] } },

  delinq:    { name:'Delinquency',             category:'money', sla:4320,
               pipeline:['1-10d','11-30d','31-60d','Notice','Filed'],
               modules:['money','log','split','time','approve'],
               actions:{ approve:'collections.serve_notice', deny:'collections.offer_payment_plan' },
               onEnter:{ Notice:['legal.queue','ledger.lock'], Filed:['attorney.package'] } },

  inspect:   { name:'Move-Out Inspection',     category:'leasing', sla:30240,
               pipeline:['Scheduled','Walked','Priced','Statement','Refunded'],
               modules:['photos','check','money','split','approve'],
               actions:{ approve:'leasing.generate_deposit_statement', deny:'inspection.schedule_rewalk' },
               onEnter:{ Priced:['turn.budget_update'], Statement:['statutory.clock_start'], Refunded:['ach.send'] } },

  budget:    { name:'Budget Variance',         category:'intel', sla:null,
               pipeline:['Live','Flagged','Reforecast','Approved','Closed'],
               modules:['metric','bars','split','approve'],
               actions:{ approve:'finance.send_reforecast', deny:'finance.absorb_variance' },
               onEnter:{ Reforecast:['notify.owner'], Closed:['ledger.period_close'] } },

  pm:        { name:'Preventive Maintenance',  category:'maintenance', sla:12960,
               pipeline:['Scheduled','Due','Assigned','Serviced','Logged'],
               modules:['score','split','check','time','approve'],
               actions:{ approve:'maint.book_pm_service', deny:'maint.defer_pm' },
               onEnter:{ Serviced:['asset.warranty_reset','runtime.counter_reset'], Logged:['asset.history_append'] } },

  violation: { name:'Code Violation',          category:'compliance', sla:10080,
               pipeline:['Notice','Assessed','Curing','Re-inspect','Cleared'],
               modules:['docs','check','bars','split','time','approve'],
               actions:{ approve:'compliance.dispatch_and_file_packet', deny:'compliance.request_extension' },
               onEnter:{ Curing:['work_order.create'], 'Re-inspect':['notify.inspector','packet.file'], Cleared:['fine.accrual_stop'] } },

  promo:     { name:'Promo / Concession',      category:'leasing', sla:14400,
               pipeline:['Drafted','Live','Converting','Ending','Closed'],
               modules:['metric','bars','split','approve'],
               actions:{ approve:'leasing.extend_promo', deny:'leasing.end_promo' },
               onEnter:{ Live:['units.retag','marketing.publish'], Closed:['concession.reconcile'] } },

  bonus:     { name:'Tech Bonus & Payroll',    category:'people', sla:4320,
               pipeline:['Accruing','Reviewed','Approved','Paid','Logged'],
               modules:['score','bars','money','split','approve'],
               actions:{ approve:'payroll.approve_bonus', deny:'payroll.send_to_review' },
               onEnter:{ Approved:['payroll.line_queue'], Paid:['notify.tech'] } },

  emergency: { name:'After-Hours Emergency',   category:'maintenance', sla:60,
               pipeline:['Called','Escalated','Dispatched','Made Safe','Reported'],
               modules:['time','check','approve','stack'],
               actions:{ approve:'emergency.escalate_oncall', deny:'emergency.page_manager' },
               onEnter:{ Escalated:['page.oncall'], 'Made Safe':['incident.report_open'], Reported:['insurance.notify','owner.notify'] } }
};

export const templateIds = () => Object.keys(TEMPLATES);
