#!/usr/bin/env node
/**
 * Patch deployed CSAT artifacts with corrected table/field names.
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

async function main() {
  const scriptInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyService&sysparm_fields=sys_id'))[0];
  await snPatch('sys_script_include', scriptInclude.sys_id, {
    script: readArtifact('script-includes/CSATSurveyService.js'),
    active: true,
  });
  console.log('Updated CSATSurveyService');

  const businessRule = (await snGet('sys_script', 'sysparm_query=name=CSAT Survey Request - Process on Submit&sysparm_fields=sys_id'))[0];
  await snPatch('sys_script', businessRule.sys_id, {
    collection: 'u_x_csat_survey_request',
    script: readArtifact('business-rules/process-on-submit.js'),
    active: true,
    when: 'after',
    action_insert: true,
    action_update: true,
  });
  console.log('Updated business rule');

  const scheduledJob = (await snGet('sysauto_script', 'sysparm_query=name=CSAT Survey Request - Scheduled Runner&sysparm_fields=sys_id'))[0];
  await snPatch('sysauto_script', scheduledJob.sys_id, {
    script: readArtifact('scheduled-jobs/runner.js'),
    active: true,
  });
  console.log('Updated scheduled job');

  const ajaxInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyAjax&sysparm_fields=sys_id'))[0];
  await snPatch('sys_script_include', ajaxInclude.sys_id, {
    script: readArtifact('script-includes/CSATSurveyAjax.js'),
    active: true,
    client_callable: true,
  });
  console.log('Updated CSATSurveyAjax');

  const notificationInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyNotification&sysparm_fields=sys_id'))[0];
  if (notificationInclude) {
    await snPatch('sys_script_include', notificationInclude.sys_id, {
      script: readArtifact('script-includes/CSATSurveyNotification.js'),
      active: true,
    });
    console.log('Updated CSATSurveyNotification');
  }

  const submitBr = (await snGet('sys_script', 'sysparm_query=name=CSAT Survey - Notify on Submission&sysparm_fields=sys_id'))[0];
  if (submitBr) {
    await snPatch('sys_script', submitBr.sys_id, {
      script: readArtifact('business-rules/notify-on-survey-submitted.js'),
      active: true,
    });
    console.log('Updated submission notification business rule');
  }

  const uiPage = (await snGet('sys_ui_page', 'sysparm_query=name=csat_survey_request&sysparm_fields=sys_id'))[0];
  await snPatch('sys_ui_page', uiPage.sys_id, {
    html: readArtifact('ui-pages/csat_survey_request.jelly.xml'),
    processing_script: readArtifact('ui-pages/csat_survey_request.processing.js'),
    endpoint: 'csat_survey_request',
    direct: true,
    title: 'CSAT Survey Request',
  });
  console.log('Updated UI page');

  for (const mod of await snGet('sys_app_module', 'sysparm_query=titleLIKECSAT Survey&sysparm_fields=sys_id,title,name')) {
    const table = mod.title.includes('Executions') ? 'u_x_csat_survey_execution' : 'u_x_csat_survey_request';
    await snPatch('sys_app_module', mod.sys_id, { name: table, link_type: 'LIST' });
    console.log(`Updated module ${mod.title} -> ${table}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
