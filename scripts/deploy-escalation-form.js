#!/usr/bin/env node
/**
 * Adds escalation custom fields to the request_escalation form view on
 * sn_customerservice_escalation.
 */

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const root = path.join(__dirname, '..');
  const envPath = process.env.ENV_FILE
    ? path.resolve(root, process.env.ENV_FILE)
    : path.join(root, '.env');
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

const TABLE = 'sn_customerservice_escalation';
const VIEW = 'request_escalation';
const SECTION_SYS_ID = '4f590b0ab3600300b85d6e5f26a8dcab';

const FORM_FIELDS = [
  { element: 'u_escalation_level', position: 14 },
  { element: 'u_escalation_reason', position: 15 },
  { element: 'u_documentation_accuracy', position: 16 },
  { element: 'u_escalation_category', position: 17 },
  { element: 'u_escalation_owner', position: 18 },
  { element: 'u_communication_channel', position: 19 },
  { element: 'u_customer_impact_status', position: 20 },
  { element: 'u_additional_notes', position: 21 },
];

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

async function ensureFormElement({ element, position }) {
  const existing = await snGet(
    'sys_ui_element',
    `sysparm_query=sys_ui_section=${SECTION_SYS_ID}^element=${element}&sysparm_fields=sys_id,element,position&sysparm_limit=1`,
  );
  if (existing.length) {
    console.log(`  form element exists: ${element} (position ${existing[0].position})`);
    return existing[0];
  }

  const created = await snPost('sys_ui_element', {
    name: TABLE,
    element,
    sys_ui_section: SECTION_SYS_ID,
    position: String(position),
    type: '',
  });
  console.log(`  added to form: ${element} (position ${position})`);
  return created;
}

async function main() {
  console.log(`Updating ${VIEW} form on ${TABLE} at ${base}\n`);

  const view = await snGet('sys_ui_view', `sysparm_query=name=${VIEW}&sysparm_fields=sys_id,name,title&sysparm_limit=1`);
  if (!view.length) throw new Error(`View ${VIEW} not found`);
  console.log(`View: ${view[0].title} (${view[0].sys_id})\n`);

  for (const field of FORM_FIELDS) {
    await ensureFormElement(field);
  }

  const elems = await snGet(
    'sys_ui_element',
    `sysparm_query=sys_ui_section=${SECTION_SYS_ID}&sysparm_fields=element,position&sysparm_order_by=position`,
  );
  console.log('\n=== request_escalation form fields ===');
  elems
    .filter((e) => !e.element.startsWith('.'))
    .forEach((e) => console.log(`  ${e.position}: ${e.element}`));
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
