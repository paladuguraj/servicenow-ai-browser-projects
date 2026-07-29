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

const SCOPE = 'x_csat_survey';
const base = process.env.SN_INSTANCE_URL.replace(/\/$/, '');
const auth = Buffer.from(`${process.env.SN_USERNAME}:${process.env.SN_PASSWORD}`).toString('base64');
const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: `Basic ${auth}`,
};

async function snGet(table, params = '') {
  const res = await fetch(`${base}/api/now/table/${table}?${params}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${table} ${res.status}: ${JSON.stringify(body)}`);
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

async function ensureAcl(name, table, operation, roles = 'admin,itil') {
  const existing = await snGet('sys_security_acl', `sysparm_query=name=${table}^operation=${operation}&sysparm_fields=sys_id`);
  if (existing.length) return;
  await snPost('sys_security_acl', {
    name: table,
    operation,
    type: 'record',
    active: true,
    admin_overrides: true,
    description: `CSAT Survey ${operation} access`,
    script: `answer = true;`,
    advanced: true,
  });
  console.log(`ACL: ${table}.${operation}`);
}

async function main() {
  const tables = await snGet('sys_db_object', 'sysparm_query=nameSTARTSWITHx_csat_survey&sysparm_fields=sys_id,name,ws_access');
  for (const table of tables) {
    if (table.ws_access !== 'true' && table.ws_access !== true) {
      await snPatch('sys_db_object', table.sys_id, { ws_access: true });
      console.log(`Enabled ws_access: ${table.name}`);
    }
    for (const op of ['read', 'create', 'write', 'delete']) {
      await ensureAcl(`${table.name}.${op}`, table.name, op);
    }
  }

  const page = (await snGet('sys_ui_page', 'sysparm_query=name=csat_survey_request&sysparm_fields=sys_id,processing_script'))[0];
  if (page && !page.processing_script.includes('typeof request')) {
    const wrapped = `(function() {\n${page.processing_script}\n})();`;
    await snPatch('sys_ui_page', page.sys_id, { processing_script: wrapped });
    console.log('Wrapped UI page processing script');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
