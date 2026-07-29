#!/usr/bin/env node
/**
 * Deploy CSAT survey email notifications (script include + submission business rule).
 * Assignment emails use native ServiceNow events (assign.send_survey / record.send_survey).
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const base = process.env.SN_INSTANCE_URL.replace(/\/$/, '');
const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: `Basic ${Buffer.from(`${process.env.SN_USERNAME}:${process.env.SN_PASSWORD}`).toString('base64')}`,
};

async function snGet(table, params = '') {
  const res = await fetch(`${base}/api/now/table/${table}?${params}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${table}: ${JSON.stringify(body)}`);
  return body.result;
}

async function snPost(table, data) {
  const res = await fetch(`${base}/api/now/table/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 201) throw new Error(`POST ${table}: ${JSON.stringify(body)}`);
  return body.result;
}

async function snPatch(table, sysId, data) {
  const res = await fetch(`${base}/api/now/table/${table}/${sysId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`PATCH ${table}/${sysId}: ${JSON.stringify(body)}`);
  return body.result;
}

function readArtifact(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'servicenow', filename), 'utf8');
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

async function ensureBusinessRule() {
  const name = 'CSAT Survey - Notify on Submission';
  const existing = await snGet('sys_script', `sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id`);
  const payload = {
    name,
    collection: 'asmt_assessment_instance',
    when: 'after',
    action_insert: false,
    action_update: true,
    filter_condition:
      'trigger_table=u_x_csat_survey_request^trigger_idISNOTEMPTY^metric_type.evaluation_method=survey^stateCHANGESTOcomplete^EQ',
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
  console.log('Deploying CSAT survey email notifications...\n');
  await ensureScriptInclude('CSATSurveyNotification', readArtifact('script-includes/CSATSurveyNotification.js'));
  await ensureBusinessRule();
  console.log('\nNotification deployment complete.');
  console.log('- Assignment: native assign.send_survey / record.send_survey events');
  console.log('- Submission: thank-you to respondent + notice to requestor');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
