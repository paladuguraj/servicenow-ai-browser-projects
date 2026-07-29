#!/usr/bin/env node
/**
 * Verify CSAT survey generation and email notifications end to end:
 * create a request, confirm assignment emails, complete a survey instance,
 * then confirm submission emails.
 *
 * Completing a survey requires a server-side state change, so this installs a
 * temporary Scripted REST helper and removes it again when finished.
 */
const { base, headers, snGet, snPost, snDelete, sleep } = require('./lib/sn-client');

const COMPLETE_SCRIPT = `(function process(request, response) {
  var v = request.queryParams.instance_id;
  var instanceId = String(Array.isArray(v) ? v[0] : v || '');

  var gr = new GlideRecord('asmt_assessment_instance');
  if (!gr.get(instanceId))
    return { error: 'instance not found: ' + instanceId };

  var before = gr.getValue('state');
  gr.setValue('state', 'complete');
  gr.setValue('taken_on', new GlideDateTime());
  gr.update();

  var after = new GlideRecord('asmt_assessment_instance');
  after.get(instanceId);
  return { state_before: before, state_after: after.getValue('state') };
})(request, response);`;

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function emailsSince(timestamp) {
  return snGet(
    'sys_email',
    `sysparm_query=sys_created_on>=${encodeURIComponent(timestamp)}^ORDERBYDESCsys_created_on&sysparm_fields=subject,recipients,state,type`
  );
}

/**
 * The notification engine generates email asynchronously, so poll until the
 * expected messages appear rather than sampling once.
 */
async function waitForEmails(timestamp, match, expectedCount, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let found = [];
  while (Date.now() < deadline) {
    const all = await emailsSince(timestamp);
    found = all.filter((e) => match.test(e.subject || ''));
    if (found.length >= expectedCount) return found;
    await sleep(3000);
  }
  return found;
}

async function installHelper(apiSysId) {
  const existing = await snGet(
    'sys_ws_operation',
    `sysparm_query=web_service_definition=${apiSysId}^name=test_complete_instance&sysparm_fields=sys_id`
  );
  if (existing.length) return existing[0].sys_id;
  const created = await snPost('sys_ws_operation', {
    web_service_definition: apiSysId,
    name: 'test_complete_instance',
    http_method: 'GET',
    relative_path: '/test_complete_instance',
    active: true,
    operation_script: COMPLETE_SCRIPT,
    requires_authentication: true,
  });
  return created.sys_id;
}

async function runScenario(apiBase, template, company, users, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}`);
  console.log(`  Template: ${template.name} (notify_user=${template.notify_user})`);
  console.log(`${'='.repeat(60)}`);

  const startedAt = nowStamp();
  await sleep(1500);

  const createRes = await fetch(`${base}${apiBase}/requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      company: company.sys_id,
      metric_type: template.sys_id,
      recipient_mode: 'selected_users',
      selected_users: users.map((u) => u.sys_id),
      schedule_frequency: 'immediate',
      notes: `Notification verification: ${label}`,
      submit: true,
    }),
  });
  const created = (await createRes.json()).result;

  const executions = await snGet(
    'u_x_csat_survey_execution',
    `sysparm_query=u_survey_request=${created.sys_id}&sysparm_fields=u_status,u_message,u_assessment_instance`
  );
  console.log('\nExecutions:');
  executions.forEach((e) => console.log(`  ${e.u_status}: ${e.u_message}`));

  const successful = executions.filter((e) => e.u_status === 'success');
  if (!successful.length) {
    console.log('  No surveys generated; skipping email checks.');
    return false;
  }

  const invitePattern = new RegExp(`${escapeRegex(template.name)}: Your opinion matters`);
  const assignEmails = await waitForEmails(startedAt, invitePattern, successful.length);
  console.log(`\nAssignment emails (${assignEmails.length}/${successful.length} expected):`);
  assignEmails.forEach((e) => console.log(`  [${e.state}] ${e.subject} -> ${e.recipients}`));

  const instanceId = successful[0].u_assessment_instance.value || successful[0].u_assessment_instance;
  const beforeSubmit = nowStamp();
  await sleep(1500);

  const completeRes = await fetch(`${base}${apiBase}/test_complete_instance?instance_id=${instanceId}`, { headers });
  const completeBody = (await completeRes.json()).result;
  console.log(`\nCompleted instance ${instanceId}: ${completeBody.state_before} -> ${completeBody.state_after}`);

  const submitPattern = new RegExp(
    `(Thank you for completing ${escapeRegex(template.name)}|CSAT survey response received: ${escapeRegex(template.name)})`
  );
  const submitEmails = await waitForEmails(beforeSubmit, submitPattern, 2);
  console.log(`\nSubmission emails (${submitEmails.length}/2 expected):`);
  submitEmails.forEach((e) => console.log(`  [${e.state}] ${e.subject} -> ${e.recipients}`));

  const execAfter = await snGet(
    'u_x_csat_survey_execution',
    `sysparm_query=u_assessment_instance=${instanceId}&sysparm_fields=u_status,u_message`
  );
  console.log('\nAudit trail:');
  execAfter.forEach((e) => console.log(`  ${e.u_status}: ${e.u_message}`));

  return assignEmails.length >= successful.length && submitEmails.length >= 2;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const api = (await snGet('sys_ws_definition', 'sysparm_query=name=CSAT Survey API&sysparm_fields=sys_id,base_uri'))[0];
  const helperSysId = await installHelper(api.sys_id);

  try {
    const smtp = (await snGet('sys_properties', 'sysparm_query=name=glide.email.smtp.active&sysparm_fields=value'))[0];
    console.log(`Outbound email enabled: ${smtp ? smtp.value : 'unset'}`);

    const company =
      (await snGet('core_company', 'sysparm_query=name=ACME North America&sysparm_fields=sys_id,name'))[0] ||
      (await snGet('core_company', 'sysparm_query=name!=N/A&sysparm_limit=1&sysparm_fields=sys_id,name'))[0];

    const users = await snGet(
      'sys_user',
      `sysparm_query=active=true^company=${company.sys_id}^emailISNOTEMPTY&sysparm_limit=2&sysparm_fields=sys_id,name,email`
    );
    console.log(`Company: ${company.name} (${users.length} recipients with email)`);

    if (!users.length) {
      console.log('No users with email addresses; cannot verify delivery.');
      return;
    }

    const notifyOn = (await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey^name=Customer Satisfaction Survey&sysparm_fields=sys_id,name,notify_user'
    ))[0];
    const notifyOff = (await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey^name=Knowledge Lab Session Feedback Survey&sysparm_fields=sys_id,name,notify_user'
    ))[0];

    const results = [];
    results.push(['notify_user = true', await runScenario(apiBase(api), notifyOn, company, users, 'Scenario 1: template with platform notifications enabled')]);
    if (notifyOff)
      results.push(['notify_user = false', await runScenario(apiBase(api), notifyOff, company, users, 'Scenario 2: template with platform notifications disabled')]);

    console.log(`\n${'='.repeat(60)}`);
    console.log('SUMMARY');
    results.forEach(([name, ok]) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`));
  } finally {
    await snDelete('sys_ws_operation', helperSysId);
    console.log('\nRemoved temporary test helper endpoint.');
  }
}

function apiBase(api) {
  return api.base_uri;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
