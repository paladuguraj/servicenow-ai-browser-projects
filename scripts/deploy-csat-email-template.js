#!/usr/bin/env node
/**
 * Deploy the CSAT survey invitation email.
 *
 * Portal-raised surveys were being picked up by "Survey User Invite v2-
 * Manually Created", which is built for case-triggered surveys: its subject
 * renders empty task_id placeholders and its link mail script only prints a
 * link when current.task_id.company resolves an account, which never happens
 * for a portal survey.
 *
 * This creates a dedicated invitation that follows the same pattern, resolves
 * the sender from the CSAT request's company, and links to the Service Portal.
 * The existing case notification is scoped so it no longer catches portal
 * surveys, preventing duplicate emails.
 */
const { snGet, snPost, snPatch, snDelete, readArtifact, announceTarget } = require('./lib/sn-client');

const REQUEST_TABLE = 'u_x_csat_survey_request';
const INSTANCE_TABLE = 'asmt_assessment_instance';
const CASE_NOTIFICATION = 'Survey User Invite v2- Manually Created';
const NOTIFICATION_NAME = 'CSAT Survey Invitation';

// The first two are the customer's existing scripts, extended so the shared
// "Survey User Invite v2- Manually Created" template also works for surveys
// raised from the portal. The case behaviour in each is untouched.
const MAIL_SCRIPTS = [
  ['set_survey_partners_from', 'mail-scripts/set_survey_partners_from.js', 'Resolves the survey invitation sender from the case or CSAT survey request'],
  ['asmt_assessment_instance_script_for_partners', 'mail-scripts/asmt_assessment_instance_script_for_partners.js', 'Prints the survey link for case-triggered or portal-raised surveys'],
  ['csat_survey_portal_notes', 'mail-scripts/csat_survey_portal_notes.js', 'Prints the note captured on the CSAT survey request'],
];

// Superseded by the shared scripts above.
const RETIRED_MAIL_SCRIPTS = ['csat_survey_portal_from', 'csat_survey_portal_link'];

async function ensureMailScript(name, artifact, description) {
  const script = readArtifact(artifact);
  const existing = await snGet('sys_script_email', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  const payload = { name, script, description };

  if (existing.length) {
    await snPatch('sys_script_email', existing[0].sys_id, payload);
    console.log(`Updated mail script: ${name}`);
    return;
  }
  await snPost('sys_script_email', payload);
  console.log(`Created mail script: ${name}`);
}

async function removeRetiredMailScripts() {
  for (const name of RETIRED_MAIL_SCRIPTS) {
    const found = await snGet('sys_script_email', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
    for (const script of found) {
      await snDelete('sys_script_email', script.sys_id);
      console.log(`Removed superseded mail script: ${name}`);
    }
  }
}

async function ensureNotification() {
  const existing = await snGet(
    'sysevent_email_action',
    `sysparm_query=name=${encodeURIComponent(NOTIFICATION_NAME)}&sysparm_fields=sys_id`
  );

  const payload = {
    name: NOTIFICATION_NAME,
    collection: INSTANCE_TABLE,
    event_name: 'assign.send_survey',
    // Custom gs.eventQueue notifications are only picked up by the legacy
    // event generator; the default 'engine' type ignores them.
    generation_type: 'event',
    action_insert: false,
    action_update: false,
    active: true,
    recipient_fields: 'user',
    subject: '${metric_type} - we would value your feedback',
    message_html: readArtifact('notifications/csat-survey-invitation.html'),
    // ^EQ is the end-of-query marker the condition builder appends; without it
    // the UI re-renders the condition inconsistently on save.
    condition: `trigger_table=${REQUEST_TABLE}^EQ`,
    include_attachments: false,
    force_delivery: true,
    send_self: true,
    type: 'email',
    description: 'Survey invitation for requests raised through the CSAT Survey Portal',
  };

  if (existing.length) {
    await snPatch('sysevent_email_action', existing[0].sys_id, payload);
    console.log(`Updated notification: ${NOTIFICATION_NAME}`);
    return;
  }
  await snPost('sysevent_email_action', payload);
  console.log(`Created notification: ${NOTIFICATION_NAME}`);
}

/**
 * Any other active notification on the assignment events will also fire for a
 * portal survey, so the recipient gets several invitations. Adding a trigger
 * table exclusion narrows each one without changing how it behaves for the
 * case- or task-triggered surveys it was written for.
 */
async function excludeOtherInvitations() {
  const others = await snGet(
    'sysevent_email_action',
    'sysparm_query=collection=asmt_assessment_instance^active=true' +
      `^name!=${encodeURIComponent(NOTIFICATION_NAME)}` +
      '&sysparm_fields=sys_id,name,event_name,condition,generation_type'
  );

  const candidates = others.filter((n) => {
    const listensOnAssignment = ['assign.send_survey', 'record.send_survey'].indexOf(n.event_name) !== -1;
    return listensOnAssignment || n.name === CASE_NOTIFICATION;
  });

  if (!candidates.length) {
    console.log('No other active invitation notifications to narrow.');
    return;
  }

  for (const n of candidates) {
    // Record-based ("engine") notifications are evaluated the moment the
    // instance is inserted, which is before the portal has stamped
    // trigger_table onto it, so a trigger_table guard would never hold. Those
    // notifications are all written for task-triggered surveys and render
    // task_id in their subject and link, so requiring task_id both excludes
    // portal surveys and stops them producing a broken email on their own.
    const guard = n.generation_type === 'event'
      ? `trigger_table!=${REQUEST_TABLE}`
      : 'task_idISNOTEMPTY';

    let current = n.condition || '';

    // Drop a previously applied trigger_table guard that cannot work here.
    if (guard === 'task_idISNOTEMPTY')
      current = current.replace(new RegExp(`\\^?trigger_table!=${REQUEST_TABLE}`), '');

    if (current.indexOf(guard) !== -1) {
      console.log(`Already excludes portal surveys: ${n.name}`);
      continue;
    }

    const updated = current ? `${current.replace(/\^EQ$/, '')}^${guard}^EQ` : `${guard}^EQ`;
    await snPatch('sysevent_email_action', n.sys_id, { condition: updated });
    console.log(`Excluded portal surveys from: ${n.name}  (${guard})`);
  }
}

async function reportState() {
  const listeners = await snGet(
    'sysevent_email_action',
    'sysparm_query=collection=asmt_assessment_instance^active=true^event_nameINassign.send_survey,record.send_survey^ORname=Survey User Invite v2- Manually Created&sysparm_fields=name,event_name,condition,active,generation_type'
  );
  console.log('\nActive notifications that could fire on a survey assignment:');
  listeners.forEach((l) => {
    const condition = l.condition || '';
    // Either guard is sufficient: portal surveys have no task_id, and once
    // stamped they carry the CSAT trigger table.
    const excluded =
      condition.includes(`trigger_table!=${REQUEST_TABLE}`) || condition.includes('task_idISNOTEMPTY');
    console.log(`  ${l.name}`);
    console.log(`     event: ${l.event_name || '(record-based)'} | catches portal surveys: ${!excluded}`);
  });
}

async function main() {
  announceTarget('Deploy CSAT survey invitation email');

  for (const [name, artifact, description] of MAIL_SCRIPTS)
    await ensureMailScript(name, artifact, description);

  await removeRetiredMailScripts();
  await ensureNotification();
  await excludeOtherInvitations();
  await reportState();

  console.log('\nInvitation deployed. Outbound email is unchanged.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
