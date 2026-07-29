#!/usr/bin/env node
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
    method: 'POST', headers, body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 201) throw new Error(`POST ${table}: ${JSON.stringify(body)}`);
  return body.result;
}

async function snPatch(table, sysId, data) {
  const res = await fetch(`${base}/api/now/table/${table}/${sysId}`, {
    method: 'PATCH', headers, body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`PATCH ${table}/${sysId}: ${JSON.stringify(body)}`);
  return body.result;
}

function readArtifact(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'servicenow', relPath), 'utf8');
}

function buildJellyPage() {
  return `<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<j2:set var="jvar_notitle" value="true"/>
<g:evaluate var="jvar_company_gr" object="true" jelly="true">
  var gr = new GlideRecord('core_company');
  gr.addQuery('name', '!=', 'N/A');
  gr.orderBy('name');
  gr.query();
  gr;
</g:evaluate>
<g:evaluate var="jvar_template_gr" object="true" jelly="true">
  var gr = new GlideRecord('asmt_metric_type');
  gr.addQuery('active', true);
  gr.addQuery('evaluation_method', 'survey');
  gr.orderBy('name');
  gr.query();
  gr;
</g:evaluate>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; background: #f8fafc; }
  .container { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
  h1 { margin-top: 0; font-size: 24px; }
  .field { margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  select, textarea { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box; }
  textarea { min-height: 80px; }
  .users-panel { border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px; max-height: 240px; overflow: auto; background: #f9fafb; }
  .user-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .actions { margin-top: 24px; display: flex; gap: 12px; }
  button { background: #0b5cab; color: #fff; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; }
  button.secondary { background: #64748b; }
  .message { margin-top: 16px; padding: 12px; border-radius: 4px; display: none; }
  .message.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .message.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .hint { color: #64748b; font-size: 12px; margin-top: 4px; }
  .inline-group label { font-weight: normal; display: inline-flex; align-items: center; gap: 6px; margin-right: 16px; }
</style>
<div class="container">
  <h1>CSAT Survey Request</h1>
  <p class="hint">Select a company, choose recipients and survey template, then schedule delivery.</p>
  <div class="field">
    <label for="company">Company / Account</label>
    <select id="company"><option value="">-- Select company --</option>
      <j:while test="\${jvar_company_gr.next()}">
        <option value="\${jvar_company_gr.sys_id}">\${jvar_company_gr.name}</option>
      </j:while>
    </select>
  </div>
  <div class="field">
    <label>Recipients</label>
    <div class="inline-group">
      <label><input type="radio" name="recipient_mode" value="all_users" checked="checked"/> All users in company</label>
      <label><input type="radio" name="recipient_mode" value="selected_users"/> Selected users only</label>
    </div>
  </div>
  <div class="field">
    <label>Users in selected company</label>
    <div id="usersPanel" class="users-panel"><div class="hint">Select a company to load users.</div></div>
  </div>
  <div class="field">
    <label for="metric_type">Survey Template</label>
    <select id="metric_type"><option value="">-- Select survey template --</option>
      <j:while test="\${jvar_template_gr.next()}">
        <option value="\${jvar_template_gr.sys_id}">\${jvar_template_gr.name}</option>
      </j:while>
    </select>
  </div>
  <div class="field">
    <label for="schedule_frequency">Schedule</label>
    <select id="schedule_frequency">
      <option value="immediate">Send immediately</option>
      <option value="every_30_days">Every 30 days</option>
      <option value="every_60_days">Every 60 days</option>
    </select>
  </div>
  <div class="field">
    <label for="notes">Notes</label>
    <textarea id="notes" placeholder="Optional notes for audit/reporting"></textarea>
  </div>
  <div class="actions">
    <button type="button" id="submitBtn">Create Survey Request</button>
    <button type="button" class="secondary" id="resetBtn">Reset</button>
  </div>
  <div id="message" class="message"></div>
</div>
<g:requires name="CSAT Survey Request Client" type="script"/>
</j:jelly>`.replace(/motion\.div/g, 'div');
}

async function ensureScriptInclude(name, script, clientCallable) {
  const existing = await snGet('sys_script_include', `sysparm_query=name=${name}&sysparm_fields=sys_id`);
  const payload = {
    name,
    api_name: name,
    script,
    active: true,
    access: 'public',
    client_callable: clientCallable,
    description: 'CSAT Survey Request application',
  };
  if (existing.length) {
    await snPatch('sys_script_include', existing[0].sys_id, payload);
  } else {
    await snPost('sys_script_include', payload);
  }
  console.log(`Script include: ${name}`);
}

async function main() {
  await ensureScriptInclude('CSATSurveyService', readArtifact('script-includes/CSATSurveyService.js'), false);
  await ensureScriptInclude('CSATSurveyAjax', readArtifact('script-includes/CSATSurveyAjax.js'), true);

  const uiScript = readArtifact('ui-scripts/csat_survey_request_client.js');
  const existingUi = await snGet('sys_ui_script', 'sysparm_query=name=CSAT Survey Request Client&sysparm_fields=sys_id');
  if (existingUi.length) {
    await snPatch('sys_ui_script', existingUi[0].sys_id, { script: uiScript, active: true, ui_type: 0, global: true });
  } else {
    await snPost('sys_ui_script', { name: 'CSAT Survey Request Client', script: uiScript, active: true, ui_type: 0, global: true });
  }

  const html = buildJellyPage();
  const page = (await snGet('sys_ui_page', 'sysparm_query=name=csat_survey_request&sysparm_fields=sys_id'))[0];
  await snPatch('sys_ui_page', page.sys_id, { html, processing_script: '', title: 'CSAT Survey Request' });
  console.log('UI page deployed with server-rendered dropdowns');
}

main().catch((e) => { console.error(e); process.exit(1); });
