#!/usr/bin/env node
/**
 * Creates escalation form fields on sn_customerservice_escalation per
 * SNOW_Escalation_Widget_update_v2.1 (all items except #2 Escalation Source).
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

const FIELDS = [
  {
    element: 'u_escalation_level',
    column_label: 'Escalation Level / Tier',
    internal_type: 'integer',
    max_length: 40,
    choice: '1',
    choices: ['Level 1', 'Level 2', 'Level 3', 'Level 4'],
  },
  {
    element: 'u_escalation_reason',
    column_label: 'Escalation Reason / Justification',
    internal_type: 'string',
    max_length: 255,
    choice: '3',
    attributes: 'list_collector=true',
    choices: [
      'SLO Breach',
      'Repeated Issue',
      'Recommended Fix Not Implemented',
      'Carrier/Vendor Non-Responsive',
      'Technical Complexity',
      'Inactivity',
      'Business Critical',
    ],
  },
  {
    element: 'u_documentation_accuracy',
    column_label: 'Documentation Accuracy Flag',
    internal_type: 'string',
    max_length: 40,
    choice: '1',
    choices: ['Case Notes Accurate', 'Documentation Error Identified'],
  },
  {
    element: 'u_escalation_category',
    column_label: 'Escalation Category / Type',
    internal_type: 'string',
    max_length: 40,
    choice: '1',
    choices: [
      'Technical Investigation',
      'Performance Optimization',
      'Service Restoration',
      'Carrier/Vendor Coordination',
      'On-Site Dispatch',
      'Management Review & Decision',
      'Account Management/Billing',
      'Architecture/Design Review',
    ],
  },
  {
    element: 'u_escalation_owner',
    column_label: 'Owner',
    internal_type: 'string',
    max_length: 40,
    choice: '1',
    choices: [
      'NOC',
      'Engineering Team',
      'Customer Success / Account Management',
      'Finance / Billing',
      'Executive Management',
      'Platform Team',
    ],
  },
  {
    element: 'u_communication_channel',
    column_label: 'Communication Channel Used for Escalation',
    internal_type: 'string',
    max_length: 255,
    choice: '3',
    attributes: 'list_collector=true',
    choices: [
      'Email',
      'Phone Call',
      'Slack Channel',
      'Microsoft Teams',
      'Management Review Meeting',
    ],
  },
  {
    element: 'u_customer_impact_status',
    column_label: 'Customer Impact Status',
    internal_type: 'string',
    max_length: 255,
    choice: '3',
    attributes: 'list_collector=true',
    choices: [
      'Severity = Hard Down',
      'Intermittent Issues',
      'Degraded Performance',
      'No Current Impact – Preventive Escalation',
    ],
  },
  {
    element: 'u_additional_notes',
    column_label: 'Additional Notes',
    internal_type: 'string',
    max_length: 1000,
    choice: '0',
  },
];

async function ensureField(field) {
  const existing = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${TABLE}^element=${field.element}&sysparm_fields=sys_id,element&sysparm_limit=1`,
  );
  if (existing.length) {
    console.log(`  field exists: ${field.element}`);
    return existing[0];
  }

  const payload = {
    name: TABLE,
    element: field.element,
    column_label: field.column_label,
    internal_type: field.internal_type,
    max_length: field.max_length,
    choice: field.choice,
    active: true,
  };
  if (field.attributes) payload.attributes = field.attributes;

  const created = await snPost('sys_dictionary', payload);
  console.log(`  created field: ${field.element}`);
  return created;
}

async function ensureChoices(element, choices) {
  if (!choices?.length) return;

  const existing = await snGet(
    'sys_choice',
    `sysparm_query=name=${TABLE}^element=${element}&sysparm_fields=value,label&sysparm_limit=100`,
  );
  const existingLabels = new Set(existing.map((c) => c.label));

  for (let i = 0; i < choices.length; i++) {
    const label = choices[i];
    if (existingLabels.has(label)) {
      console.log(`    choice exists: ${element} = ${label}`);
      continue;
    }
    await snPost('sys_choice', {
      name: TABLE,
      element,
      label,
      value: String(i),
      sequence: String(i * 10),
      language: 'en',
      inactive: false,
    });
    console.log(`    created choice: ${element} = ${label}`);
  }
}

async function main() {
  console.log(`Deploying escalation fields to ${base} on ${TABLE}\n`);

  for (const field of FIELDS) {
    console.log(`\n${field.column_label} (${field.element})`);
    await ensureField(field);
    await ensureChoices(field.element, field.choices);
  }

  const elements = FIELDS.map((f) => f.element).join('^ORelement=');
  const verify = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${TABLE}^element=${elements}&sysparm_fields=element,column_label,internal_type,max_length,choice&sysparm_order_by=element`,
  );
  console.log('\n=== Verification ===');
  for (const f of verify) {
    console.log(`${f.element} | ${f.column_label} | ${f.internal_type?.value ?? f.internal_type} | max=${f.max_length}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
