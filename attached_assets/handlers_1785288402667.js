/**
 * YOUR INTEGRATIONS LIVE HERE.
 * Each on(...) below is a stub — replace the body with the real call.
 * Nothing else in the package needs to change.
 */
import { on } from './hooks.js';

const log = (tag) => (evt) => console.log('  → ' + tag, evt.payload?.card?.card_id || '');

/* messaging ---------------------------------------------------------------- */
on('sms.resident.window', log('SMS resident their arrival window'));
on('sms.resident.delay',  log('SMS resident about a parts delay'));
on('notify.resident',     log('Email/SMS the resident'));
on('notify.lead',         log('Email the prospect'));
on('notify.vendor',       log('Email the vendor'));
on('notify.tech',         log('Push to the tech app'));
on('notify.owner',        log('Email the owner'));
on('notify.inspector',    log('Email the city inspector'));
on('page.oncall',         log('PAGE the on-call phone'));
on('page.manager',        log('PAGE the property manager'));

/* accounting --------------------------------------------------------------- */
on('ap.queued_for_run',   log('Queue invoice into the next AP run'));
on('ach.file_generated',  log('Generate the NACHA file'));
on('ledger.posted',       log('Post to the GL'));
on('budget.commit',       log('Commit against the budget line'));

/* access ------------------------------------------------------------------- */
on('access.revoked',      log('Revoke the NFC credential'));
on('access.auto_revoke',  log('Auto-revoke on stage change'));

/* crew / field ------------------------------------------------------------- */
on('crew.geofence_enter', log('Crew entered the geofence — start the clock'));
on('crew.geofence_exit',  log('Crew left the geofence — stop the clock'));
on('vendor.job_report_generated', log('Build the Halo job report PDF'));

/* everything, for the audit trail ------------------------------------------ */
on('*', (evt, name) => { if (name !== '*') console.log('[event] ' + name); });
