#!/usr/bin/env node
/**
 * Deploy the CSAT Survey Request backend: tables, server logic and menus.
 *
 * Everything is created in the global scope on purpose. A scoped application
 * would force its own Default update set (splitting the deployment across two
 * sets that cannot be merged) and this is deliberately not a separate app.
 */

const { base, headers, snGet, snPost, snPatch, snDelete, readArtifact, announceTarget } = require('./lib/sn-client');

const GLOBAL_SCOPE = 'global';
const APP_MENU_TITLE = 'CSAT Survey';

async function ensureAppMenu() {
  const existing = await snGet(
    'sys_app_application',
    `sysparm_query=title=${encodeURIComponent(APP_MENU_TITLE)}&sysparm_fields=sys_id,title`
  );
  if (existing.length) {
    console.log(`Application menu exists: ${APP_MENU_TITLE}`);
    return existing[0].sys_id;
  }
  const menu = await snPost('sys_app_application', {
    title: APP_MENU_TITLE,
    hint: 'CSAT survey requests and execution audit',
    active: true,
    order: 100,
    sys_scope: GLOBAL_SCOPE,
  });
  console.log(`Created application menu: ${APP_MENU_TITLE}`);
  return menu.sys_id;
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
    sys_scope: GLOBAL_SCOPE,
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
  // ServiceNow prefixes new columns on global custom tables with u_, so a
  // second run must look for both spellings or it will try to recreate them.
  const existing = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${table}^elementIN${element},u_${element}&sysparm_fields=sys_id,element`
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
    sys_scope: GLOBAL_SCOPE,
    ...extra.extraFields,
  });
  console.log(`  + column ${table}.${element} (${columnType})`);
  return col.sys_id;
}

/**
 * Resolves the stored column name for a logical field. Columns added to a
 * global custom table get a u_ prefix, and choices attached to the unprefixed
 * name are silently ignored by the platform.
 */
async function resolveElement(table, element) {
  const found = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${table}^elementIN${element},u_${element}&sysparm_fields=element`
  );
  return found.length ? found[0].element : element;
}

async function ensureChoice(table, element, value, label, sequence) {
  const column = await resolveElement(table, element);
  const existing = await snGet(
    'sys_choice',
    `sysparm_query=name=${table}^element=${column}^value=${value}&sysparm_fields=sys_id`
  );
  if (existing.length) {
    await snPatch('sys_choice', existing[0].sys_id, { label, sequence, inactive: false });
    return;
  }
  await snPost('sys_choice', {
    name: table,
    element: column,
    value,
    label,
    sequence,
    language: 'en',
    inactive: false,
    sys_scope: GLOBAL_SCOPE,
  });
  console.log(`  + choice ${table}.${column}=${value}`);
}

/**
 * Keeps a retired choice on the table so historical records still render a
 * label, but hides it from new selections.
 */
async function retireChoice(table, element, value) {
  const column = await resolveElement(table, element);
  const existing = await snGet(
    'sys_choice',
    `sysparm_query=name=${table}^elementIN${element},${column}^value=${value}&sysparm_fields=sys_id,inactive`
  );
  for (const choice of existing) {
    await snPatch('sys_choice', choice.sys_id, { inactive: true });
  }
  if (existing.length) console.log(`  retired choice ${table}.${column}=${value}`);
}

/**
 * Removes choices left attached to the unprefixed column name by earlier runs.
 */
async function cleanupOrphanChoices(table, element) {
  const column = await resolveElement(table, element);
  if (column === element) return;
  const orphans = await snGet(
    'sys_choice',
    `sysparm_query=name=${table}^element=${element}&sysparm_fields=sys_id,value`
  );
  for (const orphan of orphans) {
    await snDelete('sys_choice', orphan.sys_id);
  }
  if (orphans.length) console.log(`  removed ${orphans.length} orphaned choice(s) on ${table}.${element}`);
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
    sys_scope: GLOBAL_SCOPE,
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
    sys_scope: GLOBAL_SCOPE,
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

async function ensureModule(title, table, appMenuSysId) {
  const existing = await snGet('sys_app_module', `sysparm_query=title=${encodeURIComponent(title)}&sysparm_fields=sys_id`);
  const payload = {
    title,
    name: table,
    query: '',
    link_type: 'LIST',
    application: appMenuSysId,
    active: true,
    sys_scope: GLOBAL_SCOPE,
  };
  if (existing.length) {
    await snPatch('sys_app_module', existing[0].sys_id, payload);
    console.log(`Updated module: ${title}`);
    return;
  }
  await snPost('sys_app_module', payload);
  console.log(`Created module: ${title}`);
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
  await ensureColumn(requestTable, 'recipient_mode', 'choice', 'Recipient Mode', { choice: 3, default_value: 'primary_user' });
  await ensureColumn(requestTable, 'schedule_frequency', 'choice', 'Schedule Frequency', { choice: 3, default_value: 'immediate' });
  await ensureColumn(requestTable, 'state', 'choice', 'State', { choice: 3, default_value: 'draft' });
  await ensureColumn(requestTable, 'next_run', 'glide_date_time', 'Next Run');
  await ensureColumn(requestTable, 'last_run', 'glide_date_time', 'Last Run');
  await ensureColumn(requestTable, 'requested_by', 'reference', 'Requested By', { reference: 'sys_user' });
  await ensureColumn(requestTable, 'notes', 'string', 'Notes', { max_length: 4000, extraFields: { internal_type: 'string', text_index: false } });
  await ensureColumn(requestTable, 'active', 'boolean', 'Active', { default_value: 'true' });

  for (const field of ['recipient_mode', 'schedule_frequency', 'state'])
    await cleanupOrphanChoices(requestTable, field);
  await cleanupOrphanChoices(executionTable, 'status');

  await ensureChoice(requestTable, 'recipient_mode', 'primary_user', 'Account Primary Contact', 10);
  await ensureChoice(requestTable, 'recipient_mode', 'selected_users', 'Selected Users only', 20);
  await retireChoice(requestTable, 'recipient_mode', 'all_users');
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
  announceTarget('Deploy CSAT tables and server logic');
  const appMenuSysId = await ensureAppMenu();
  await deployTables();

  await ensureScriptInclude('CSATSurveyAjax', readArtifact('script-includes/CSATSurveyAjax.js'));
  await ensureScriptInclude('CSATSurveyService', readArtifact('script-includes/CSATSurveyService.js'));
  await ensureScriptInclude('CSATSurveyNotification', readArtifact('script-includes/CSATSurveyNotification.js'));
  await ensureScriptInclude('CSATSurveyReport', readArtifact('script-includes/CSATSurveyReport.js'));
  await ensureBusinessRule(
    'CSAT Survey Request - Process on Submit',
    'u_x_csat_survey_request',
    'after',
    readArtifact('business-rules/process-on-submit.js')
  );
  await ensureScheduledJob('CSAT Survey Request - Scheduled Runner', readArtifact('scheduled-jobs/runner.js'));

  await ensureModule('CSAT Survey Requests', 'u_x_csat_survey_request', appMenuSysId);
  await ensureModule('CSAT Survey Executions', 'u_x_csat_survey_execution', appMenuSysId);

  console.log('\nDeployment complete.');
  console.log(`Portal is deployed separately: node scripts/deploy-csat-portal.js`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
