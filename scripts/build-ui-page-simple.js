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

function sanitize(html) {
  return html.replace(/<\/?motion\.div/g, (tag) => tag.replace('motion.', ''));
}

function buildPageHtml() {
  return sanitize(fs.readFileSync(path.join(__dirname, '../servicenow/ui-pages/csat_survey_request.jelly.xml'), 'utf8'));
}

async function patchRecord(table, query, payload) {
  const found = (await fetch(`${base}/api/now/table/${table}?${query}`, { headers }).then((r) => r.json())).result[0];
  if (!found) return;
  await fetch(`${base}/api/now/table/${table}/${found.sys_id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
}

async function main() {
  const html = buildPageHtml();
  const processingScript = fs.readFileSync(
    path.join(__dirname, '../servicenow/ui-pages/csat_survey_request.processing.js'),
    'utf8'
  );
  const clientScript = fs.readFileSync(path.join(__dirname, '../servicenow/ui-scripts/csat_survey_request_client.js'), 'utf8');

  await patchRecord('sys_ui_page', 'sysparm_query=name=csat_survey_request&sysparm_fields=sys_id', {
    html,
    processing_script: processingScript,
    title: 'CSAT Survey Request',
    endpoint: 'csat_survey_request',
    direct: true,
  });

  await patchRecord('sys_ui_script', 'sysparm_query=name=CSAT Survey Request Client&sysparm_fields=sys_id', {
    script: clientScript,
    active: true,
    global: true,
    ui_type: 0,
    description: 'CSAT Survey Request form client logic',
  });

  console.log('UI deployed:', `${base}/csat_survey_request.do`);
}

main().catch((e) => { console.error(e); process.exit(1); });
