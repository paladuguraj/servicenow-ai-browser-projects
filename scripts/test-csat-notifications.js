#!/usr/bin/env node
/**
 * Verify CSAT survey generation and email notifications end to end:
 * create a request, confirm assignment emails, complete a survey instance,
 * then confirm submission emails.
 *
 * Listing recipients, raising a request and completing a survey all need
 * server-side calls, so they run through a temporary probe endpoint.
 */
const { snGet, sleep } = require('./lib/sn-client');
const { withProbe } = require('./lib/probe');

const HELPER_SCRIPT = `(function process(request, response) {
  var body = request.body ? request.body.data : null;

  if (body && body.action === 'users')
    return { result: new CSATSurveyService().getUsersByCompany(body.company_id) };

  if (body && body.action === 'create_request') {
    return { result: new CSATSurveyService().createSurveyRequest({
      company: body.company,
      metric_type: body.metric_type,
      recipient_mode: 'selected_users',
      selected_users: body.selected_users,
      schedule_frequency: 'immediate',
      notes: body.notes,
      submit: true
    }) };
  }

  if (body && body.action === 'complete_instance') {
    var gr = new GlideRecord('asmt_assessment_instance');
    if (!gr.get(body.instance_id))
      return { result: { error: 'instance not found: ' + body.instance_id } };

    var before = gr.getValue('state');
    gr.setValue('state', 'complete');
    gr.setValue('taken_on', new GlideDateTime());
    gr.update();

    var after = new GlideRecord('asmt_assessment_instance');
    after.get(body.instance_id);
    return { result: { state_before: before, state_after: after.getValue('state') } };
  }

  return { result: { error: 'unknown action' } };
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

async function runScenario(call, template, company, users, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}`);
  console.log(`  Template: ${template.name} (notify_user=${template.notify_user})`);
  console.log(`${'='.repeat(60)}`);

  const startedAt = nowStamp();
  await sleep(1500);

  const created = await call({
    body: {
      action: 'create_request',
      company: company.sys_id,
      metric_type: template.sys_id,
      selected_users: users.map((u) => u.sys_id),
      notes: `Notification verification: ${label}`,
    },
  });

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

  const completeBody = await call({ body: { action: 'complete_instance', instance_id: instanceId } });
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

async function findEligibleRecipients(call, wanted) {
  const companies = await snGet(
    'core_company',
    'sysparm_query=name!=N/A^ORDERBYname&sysparm_fields=sys_id,name&sysparm_limit=60'
  );

  for (const company of companies) {
    const eligible = ((await call({ body: { action: 'users', company_id: company.sys_id } })) || []).filter(
      (u) => u.eligible
    );
    if (eligible.length >= wanted) return { company, users: eligible.slice(0, wanted) };
  }
  return null;
}

async function main() {
  await withProbe('csat_notifications', HELPER_SCRIPT, async (call) => {
    const smtp = (await snGet('sys_properties', 'sysparm_query=name=glide.email.smtp.active&sysparm_fields=value'))[0];
    console.log(`Outbound email enabled: ${smtp ? smtp.value : 'unset'}`);

    const notifyOn = (await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey^name=Customer Satisfaction Survey&sysparm_fields=sys_id,name,notify_user'
    ))[0];
    const notifyOff = (await snGet(
      'asmt_metric_type',
      'sysparm_query=active=true^evaluation_method=survey^name=Knowledge Lab Session Feedback Survey&sysparm_fields=sys_id,name,notify_user'
    ))[0];

    const scenarios = [
      ['notify_user = true', notifyOn, 'Scenario 1: template with platform notifications enabled'],
      ['notify_user = false', notifyOff, 'Scenario 2: template with platform notifications disabled'],
    ].filter(([, template]) => template);

    const results = [];
    for (const [name, template, label] of scenarios) {
      // Each scenario needs its own recipients: sending puts them into the
      // 90-day cooldown, so reusing the same people would skip everything
      // after the first run.
      const found = await findEligibleRecipients(call, 2);
      if (!found) {
        console.log(`\n${label}\n  No eligible recipients left (all within the 90-day cooldown).`);
        results.push([name, null]);
        continue;
      }
      results.push([name, await runScenario(call, template, found.company, found.users, label)]);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('SUMMARY');
    results.forEach(([name, ok]) =>
      console.log(`  ${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}`)
    );
  }, 'POST');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
