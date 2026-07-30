#!/usr/bin/env node
/**
 * Deploy CSAT survey email notifications.
 *
 * Assignment emails use the platform "Survey Invitation" notification driven by
 * the native assign.send_survey event. Submission emails use a custom event plus
 * two notification records (respondent thank-you, requestor alert).
 */

const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

/**
 * Turning on outbound email can release everything already sitting in the
 * queue, so on a shared instance that has to be a deliberate act. Pass
 * --enable-email to change it; otherwise just report the current setting.
 */
async function reviewOutboundEmail() {
  const name = 'glide.email.smtp.active';
  const optIn = process.argv.includes('--enable-email');
  const existing = await snGet('sys_properties', `sysparm_query=name=${name}&sysparm_fields=sys_id,value`);
  const current = existing.length ? existing[0].value : '(unset)';

  if (current === 'true') {
    console.log(`Outbound email already enabled (${name}=true)`);
    return;
  }

  if (!optIn) {
    console.log(`Outbound email is DISABLED (${name}=${current}).`);
    console.log('  Notifications will be recorded in sys_email but not delivered.');
    console.log('  Re-run with --enable-email to turn it on once you are ready to send.');
    return;
  }

  if (existing.length) await snPatch('sys_properties', existing[0].sys_id, { value: 'true' });
  else await snPost('sys_properties', { name, value: 'true', type: 'boolean', description: 'Enable outbound email delivery' });
  console.log(`Enabled outbound email (${name}=true, was ${current})`);
}

async function ensureScriptInclude(name, script) {
  const existing = await snGet('sys_script_include', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch('sys_script_include', existing[0].sys_id, { script, active: true, access: 'public' });
    console.log(`Updated script include: ${name}`);
    return existing[0].sys_id;
  }
  const created = await snPost('sys_script_include', {
    name,
    api_name: name,
    script,
    active: true,
    access: 'public',
    client_callable: false,
    description: 'CSAT survey email notifications',
  });
  console.log(`Created script include: ${name}`);
  return created.sys_id;
}

async function ensureEvent(name, table, description) {
  const existing = await snGet('sysevent_register', `sysparm_query=event_name=${name}&sysparm_fields=sys_id`);
  const payload = { event_name: name, table, description };
  if (existing.length) {
    await snPatch('sysevent_register', existing[0].sys_id, payload);
    console.log(`Updated event: ${name}`);
    return;
  }
  await snPost('sysevent_register', payload);
  console.log(`Created event: ${name}`);
}

async function ensureNotification(config) {
  const existing = await snGet(
    'sysevent_email_action',
    `sysparm_query=name=${encodeURIComponent(config.name)}&sysparm_fields=sys_id`
  );
  const payload = {
    name: config.name,
    collection: 'asmt_assessment_instance',
    event_name: config.event_name,
    // Custom gs.eventQueue notifications are only picked up by the legacy
    // event generator; the default 'engine' type ignores them.
    generation_type: 'event',
    action_insert: false,
    action_update: false,
    active: true,
    subject: config.subject,
    message_html: config.message_html,
    recipient_fields: config.recipient_fields || '',
    event_parm_1: config.event_parm_1 === true,
    event_parm_2: config.event_parm_2 === true,
    include_attachments: false,
    force_delivery: true,
    send_self: true,
    type: 'email',
  };
  if (existing.length) {
    await snPatch('sysevent_email_action', existing[0].sys_id, payload);
    console.log(`Updated notification: ${config.name}`);
    return;
  }
  await snPost('sysevent_email_action', payload);
  console.log(`Created notification: ${config.name}`);
}

async function ensureBusinessRule() {
  const name = 'CSAT Survey - Notify on Submission';
  const existing = await snGet('sys_script', `sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id`);
  const payload = {
    name,
    collection: 'asmt_assessment_instance',
    when: 'after',
    action_insert: false,
    action_update: true,
    filter_condition: 'trigger_table=u_x_csat_survey_request^stateCHANGESTOcomplete^EQ',
    advanced: true,
    active: true,
    order: 100,
    script: readArtifact('business-rules/notify-on-survey-submitted.js'),
  };
  if (existing.length) {
    await snPatch('sys_script', existing[0].sys_id, payload);
    console.log(`Updated business rule: ${name}`);
    return;
  }
  await snPost('sys_script', payload);
  console.log(`Created business rule: ${name}`);
}

async function main() {
  announceTarget('Deploy CSAT notifications');

  await reviewOutboundEmail();

  await ensureScriptInclude('CSATSurveyNotification', readArtifact('script-includes/CSATSurveyNotification.js'));

  await ensureEvent(
    'csat.survey.submitted',
    'asmt_assessment_instance',
    'Fired when a CSAT survey linked to a survey request is completed. parm1=requestor, parm2=respondent.'
  );

  await ensureNotification({
    name: 'CSAT Survey Submitted - Thank You',
    event_name: 'csat.survey.submitted',
    recipient_fields: 'user',
    subject: 'Thank you for completing ${metric_type}',
    message_html: [
      '<p>Hi ${user},</p>',
      '<p>Thank you for completing the <strong>${metric_type}</strong> survey.</p>',
      '<p>Your feedback helps us improve the services we deliver to you.</p>',
    ].join('\n'),
  });

  await ensureNotification({
    name: 'CSAT Survey Submitted - Requestor',
    event_name: 'csat.survey.submitted',
    event_parm_1: true,
    subject: 'CSAT survey response received: ${metric_type}',
    message_html: [
      '<p>Hello,</p>',
      '<p>A response was submitted for the <strong>${metric_type}</strong> survey.</p>',
      '<p><strong>Respondent:</strong> ${user}<br/>',
      '<strong>Completed:</strong> ${taken_on}<br/>',
      '<strong>State:</strong> ${state}</p>',
      '<p>Review responses in the CSAT portal execution log for full audit details.</p>',
    ].join('\n'),
  });

  await ensureBusinessRule();

  console.log('\nNotification deployment complete.');
  console.log('- Assigned:   platform Survey Invitation email (assign.send_survey)');
  console.log('- Submitted:  thank-you to respondent + alert to requestor');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
