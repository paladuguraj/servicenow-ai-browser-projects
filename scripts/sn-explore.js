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
const auth = Buffer.from(`${process.env.SN_USERNAME}:${process.env.SN_PASSWORD}`).toString('base64');

async function snGet(table, params = '') {
  const url = `${base}/api/now/table/${table}?${params}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${table} ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const queries = [
    ['customer_account', 'sysparm_limit=3&sysparm_fields=sys_id,name,account_parent,active'],
    ['core_company', 'sysparm_limit=3&sysparm_fields=sys_id,name,active'],
    ['customer_contact', 'sysparm_limit=3&sysparm_fields=sys_id,first_name,last_name,email,account,active'],
    ['asmt_metric_type', 'sysparm_limit=5&sysparm_fields=sys_id,name,description,active,table,evaluation_method'],
    ['asmt_assessment_instance', 'sysparm_limit=2&sysparm_fields=sys_id,metric_type,state,user,taken_on'],
    ['sys_db_object', 'sysparm_query=nameLIKEasmt&sysparm_limit=20&sysparm_fields=name,label,super_class'],
    ['sys_scope', 'sysparm_query=scopeCONTAINScsat&sysparm_limit=5&sysparm_fields=scope,sys_name'],
  ];

  for (const [table, params] of queries) {
    try {
      const data = await snGet(table, params);
      console.log(`\n=== ${table} (${data.result?.length ?? 0} rows) ===`);
      console.log(JSON.stringify(data.result, null, 2));
    } catch (e) {
      console.log(`\n=== ${table} ERROR ===`);
      console.log(e.message);
    }
  }
}

main().catch(console.error);
