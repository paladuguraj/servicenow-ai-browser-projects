#!/usr/bin/env node
/**
 * Verifies connectivity to the ServiceNow PDI via REST API.
 * Requires SN_USERNAME and SN_PASSWORD in the environment (or .env).
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

const instanceUrl = (process.env.SN_INSTANCE_URL || 'https://dev413733.service-now.com').replace(/\/$/, '');
const username = process.env.SN_USERNAME;
const password = process.env.SN_PASSWORD;

async function main() {
  console.log(`Instance: ${instanceUrl}`);

  const health = await fetch(`${instanceUrl}/now`);
  console.log(`UI reachable: ${health.ok ? 'yes' : 'no'} (HTTP ${health.status})`);

  if (!username || !password) {
    console.error('\nMissing credentials. Set SN_USERNAME and SN_PASSWORD in .env or your environment.');
    process.exit(1);
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const api = await fetch(`${instanceUrl}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=user_name,name`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
    },
  });

  const body = await api.text();
  if (!api.ok) {
    console.error(`\nAPI auth failed (HTTP ${api.status}): ${body}`);
    process.exit(1);
  }

  const data = JSON.parse(body);
  const user = data.result?.[0];
  console.log(`\nAuthenticated as: ${user?.user_name ?? username} (${user?.name ?? 'unknown'})`);
  console.log('Connection successful.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
