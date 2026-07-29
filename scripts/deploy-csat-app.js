#!/usr/bin/env node
/**
 * Deploy CSAT Survey Request application to ServiceNow PDI.
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

const SCOPE = 'x_csat_survey';
const base = process.env.SN_INSTANCE_URL.replace(/\/$/, '');
const auth = Buffer.from(`${process.env.SN_USERNAME}:${process.env.SN_PASSWORD}`).toString('base64');
const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: `Basic ${auth}`,
};

let scopeSysId = null;

async function snGet(table, params = '') {
  const res = await fetch(`${base}/api/now/table/${table}?${params}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${table} ${res.status}: ${JSON.stringify(body)}`);
  return body.result;
}

async function snPost(table, data) {
  const res = await fetch(`${base}/api/now/table/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 201) throw new Error(`POST ${table} ${res.status}: ${JSON.stringify(body)}`);
  return body.result;
}

async function snPatch(table, sysId, data) {
  const res = await fetch(`${base}/api/now/table/${table}/${sysId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`PATCH ${table}/${sysId} ${res.status}: ${JSON.stringify(body)}`);
  return body.result;
}

async function ensureScope() {
  const existing = await snGet('sys_scope', `sysparm_query=scope=${SCOPE}&sysparm_fields=sys_id,scope`);
  if (existing.length) {
    scopeSysId = existing[0].sys_id;
    console.log(`Scope exists: ${SCOPE} (${scopeSysId})`);
    return;
  }
  const created = await snPost('sys_scope', {
    scope: SCOPE,
    sys_name: 'CSAT Survey Request',
    short_description: 'CSAT survey scheduling and request management',
  });
  scopeSysId = created.sys_id;
  console.log(`Created scope: ${SCOPE} (${scopeSysId})`);
}

async function ensureApp() {
  const existing = await snGet('sys_app', `sysparm_query=scope=${SCOPE}&sysparm_fields=sys_id,name`);
  if (existing.length) {
    console.log(`App exists: ${existing[0].name}`);
    return existing[0].sys_id;
  }
  const app = await snPost('sys_app', {
    name: 'CSAT Survey Request',
    scope: SCOPE,
    short_description: 'Schedule and track CSAT survey requests by company/account',
    vendor: 'CSAT Survey',
    version: '1.0.0',
    active: true,
    sys_scope: scopeSysId,
  });
  console.log(`Created app: ${app.name} (${app.sys_id})`);
  return app.sys_id;
}

async function ensureTable(name, label, extra = {}) {
  const existing = await snGet('sys_db_object', `sysparm_query=name=${name}&sysparm_fields=sys_id,name`);
  if (existing.length) {
    console.log(`Table exists: ${name}`);
    return existing[0].sys_id;
  }
  const table = await snPost('sys_db_object', {
    name,
    label,
    sys_scope: scopeSysId,
    create_access: true,
    read_access: true,
    update_access: true,
    delete_access: true,
    is_extendable: false,
    live_feed_enabled: false,
    ...extra,
  });
  console.log(`Created table: ${name} (${table.sys_id})`);
  return table.sys_id;
}

async function ensureColumn(table, element, columnType, label, extra = {}) {
  const existing = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${table}^element=${element}&sysparm_fields=sys_id,element`
  );
  if (existing.length) {
    return existing[0].sys_id;
  }
  const col = await snPost('sys_dictionary', {
    name: table,
    element,
    column_label: label,
    internal_type: columnType,
    max_length: extra.max_length || (columnType === 'string' ? 255 : undefined),
    reference: extra.reference,
    choice: extra.choice,
    default_value: extra.default_value,
    mandatory: extra.mandatory || false,
    active: true,
    sys_scope: scopeSysId,
    ...extra.extraFields,
  });
  console.log(`  + column ${table}.${element} (${columnType})`);
  return col.sys_id;
}

async function ensureChoice(table, element, value, label, sequence) {
  const existing = await snGet(
    'sys_choice',
    `sysparm_query=name=${table}^element=${element}^value=${value}&sysparm_fields=sys_id`
  );
  if (existing.length) return;
  await snPost('sys_choice', {
    name: table,
    element,
    value,
    label,
    sequence,
    language: 'en',
    inactive: false,
    sys_scope: scopeSysId,
  });
}

async function ensureScriptInclude(name, script) {
  const existing = await snGet('sys_script_include', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch('sys_script_include', existing[0].sys_id, { script, active: true });
    console.log(`Updated script include: ${name}`);
    return existing[0].sys_id;
  }
  const si = await snPost('sys_script_include', {
    name,
    api_name: name,
    script,
    active: true,
    access: 'public',
    client_callable: false,
    sys_scope: scopeSysId,
    description: 'CSAT Survey Request application logic',
  });
  console.log(`Created script include: ${name}`);
  return si.sys_id;
}

async function ensureBusinessRule(name, table, when, script, order = 100) {
  const existing = await snGet('sys_script', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  const payload = {
    script,
    active: true,
    when,
    action_insert: true,
    action_update: true,
  };
  if (existing.length) {
    await snPatch('sys_script', existing[0].sys_id, payload);
    console.log(`Updated business rule: ${name}`);
    return existing[0].sys_id;
  }
  const br = await snPost('sys_script', {
    name,
    collection: table,
    when,
    action_insert: true,
    action_update: true,
    order,
    active: true,
    advanced: true,
    script,
    sys_scope: scopeSysId,
    description: 'CSAT Survey Request automation',
  });
  console.log(`Created business rule: ${name}`);
  return br.sys_id;
}

async function ensureScheduledJob(name, script) {
  const existing = await snGet('sysauto_script', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch('sysauto_script', existing[0].sys_id, { script, active: true });
    console.log(`Updated scheduled job: ${name}`);
    return existing[0].sys_id;
  }
  const job = await snPost('sysauto_script', {
    name,
    script,
    active: true,
  });
  console.log(`Created scheduled job: ${name}`);
  return job.sys_id;
}

async function ensureUiPage(name, html, processingScript) {
  const existing = await snGet('sys_ui_page', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch('sys_ui_page', existing[0].sys_id, { html, processing_script: processingScript });
    console.log(`Updated UI page: ${name}`);
    return existing[0].sys_id;
  }
  const page = await snPost('sys_ui_page', {
    name,
    title: 'CSAT Survey Request',
    category: 'general',
    html,
    processing_script: processingScript,
    direct: true,
    endpoint: name,
    sys_scope: scopeSysId,
  });
  console.log(`Created UI page: ${name}`);
  return page.sys_id;
}

async function ensureModule(title, table) {
  const existing = await snGet('sys_app_module', `sysparm_query=title=${title}&sysparm_fields=sys_id`);
  if (existing.length) return;
  await snPost('sys_app_module', {
    title,
    name: table,
    query: '',
    link_type: 'LIST',
    application: (await snGet('sys_app', `sysparm_query=scope=${SCOPE}&sysparm_fields=sys_id`))[0].sys_id,
    active: true,
    sys_scope: scopeSysId,
  });
  console.log(`Created module: ${title}`);
}

function readArtifact(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'servicenow', filename), 'utf8');
}

async function deployTables() {
  const requestTable = 'u_x_csat_survey_request';
  const userTable = 'u_x_csat_survey_request_user';
  const executionTable = 'u_x_csat_survey_execution';

  await ensureTable(requestTable, 'CSAT Survey Request');
  await ensureTable(userTable, 'CSAT Survey Request User');
  await ensureTable(executionTable, 'CSAT Survey Execution');

  // Request table fields
  // Skip number column — ServiceNow reserves it or it already exists on custom tables
  await ensureColumn(requestTable, 'company', 'reference', 'Company', { reference: 'core_company', mandatory: true });
  await ensureColumn(requestTable, 'metric_type', 'reference', 'Survey Template', { reference: 'asmt_metric_type', mandatory: true });
  await ensureColumn(requestTable, 'recipient_mode', 'choice', 'Recipient Mode', { choice: 3, default_value: 'all_users' });
  await ensureColumn(requestTable, 'schedule_frequency', 'choice', 'Schedule Frequency', { choice: 3, default_value: 'immediate' });
  await ensureColumn(requestTable, 'state', 'choice', 'State', { choice: 3, default_value: 'draft' });
  await ensureColumn(requestTable, 'next_run', 'glide_date_time', 'Next Run');
  await ensureColumn(requestTable, 'last_run', 'glide_date_time', 'Last Run');
  await ensureColumn(requestTable, 'requested_by', 'reference', 'Requested By', { reference: 'sys_user' });
  await ensureColumn(requestTable, 'notes', 'string', 'Notes', { max_length: 4000, extraFields: { internal_type: 'string', text_index: false } });
  await ensureColumn(requestTable, 'active', 'boolean', 'Active', { default_value: 'true' });

  await ensureChoice(requestTable, 'recipient_mode', 'all_users', 'All users in company', 10);
  await ensureChoice(requestTable, 'recipient_mode', 'selected_users', 'Selected users only', 20);
  await ensureChoice(requestTable, 'schedule_frequency', 'immediate', 'Send immediately', 10);
  await ensureChoice(requestTable, 'schedule_frequency', 'every_30_days', 'Every 30 days', 20);
  await ensureChoice(requestTable, 'schedule_frequency', 'every_60_days', 'Every 60 days', 30);
  await ensureChoice(requestTable, 'state', 'draft', 'Draft', 10);
  await ensureChoice(requestTable, 'state', 'active', 'Active', 20);
  await ensureChoice(requestTable, 'state', 'paused', 'Paused', 30);
  await ensureChoice(requestTable, 'state', 'completed', 'Completed', 40);
  await ensureChoice(requestTable, 'state', 'cancelled', 'Cancelled', 50);

  // Request user M2M
  await ensureColumn(userTable, 'survey_request', 'reference', 'Survey Request', { reference: requestTable, mandatory: true });
  await ensureColumn(userTable, 'user', 'reference', 'User', { reference: 'sys_user', mandatory: true });

  // Execution log
  await ensureColumn(executionTable, 'survey_request', 'reference', 'Survey Request', { reference: requestTable, mandatory: true });
  await ensureColumn(executionTable, 'user', 'reference', 'User', { reference: 'sys_user' });
  await ensureColumn(executionTable, 'metric_type', 'reference', 'Survey Template', { reference: 'asmt_metric_type' });
  await ensureColumn(executionTable, 'assessment_instance', 'reference', 'Assessment Instance', { reference: 'asmt_assessment_instance' });
  await ensureColumn(executionTable, 'status', 'choice', 'Status', { choice: 3, default_value: 'pending' });
  await ensureColumn(executionTable, 'message', 'string', 'Message', { max_length: 4000 });
  await ensureColumn(executionTable, 'executed_on', 'glide_date_time', 'Executed On');
  await ensureColumn(executionTable, 'scheduled_for', 'glide_date_time', 'Scheduled For');

  await ensureChoice(executionTable, 'status', 'pending', 'Pending', 10);
  await ensureChoice(executionTable, 'status', 'success', 'Success', 20);
  await ensureChoice(executionTable, 'status', 'failed', 'Failed', 30);
  await ensureChoice(executionTable, 'status', 'skipped', 'Skipped', 40);
}

async function main() {
  console.log('Deploying CSAT Survey Request application...\n');
  await ensureScope();
  await ensureApp();
  await deployTables();

  await ensureScriptInclude('CSATSurveyAjax', readArtifact('script-includes/CSATSurveyAjax.js'));
  await ensureScriptInclude('CSATSurveyService', readArtifact('script-includes/CSATSurveyService.js'));
  await ensureBusinessRule(
    'CSAT Survey Request - Process on Submit',
    'u_x_csat_survey_request',
    'after',
    readArtifact('business-rules/process-on-submit.js')
  );
  await ensureScheduledJob('CSAT Survey Request - Scheduled Runner', readArtifact('scheduled-jobs/runner.js'));

  const html = readArtifact('ui-pages/csat_survey_request.jelly.xml');
  await ensureUiPage('csat_survey_request', html, '');

  await ensureModule('CSAT Survey Requests', 'u_x_csat_survey_request');
  await ensureModule('CSAT Survey Executions', 'u_x_csat_survey_execution');

  console.log('\nDeployment complete.');
  console.log(`UI Page: ${base}/csat_survey_request.do`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
