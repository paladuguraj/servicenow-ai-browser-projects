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
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 201) throw new Error(`POST ${table}: ${JSON.stringify(body)}`);
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

const OPERATIONS = [
  {
    name: 'companies',
    http_method: 'GET',
    relative_path: '/companies',
    script: `(function process(request, response) {\n  return new CSATSurveyService().getCompanies();\n})(request, response);`,
  },
  {
    name: 'templates',
    http_method: 'GET',
    relative_path: '/templates',
    script: `(function process(request, response) {\n  return new CSATSurveyService().getSurveyTemplates();\n})(request, response);`,
  },
  {
    name: 'users',
    http_method: 'GET',
    relative_path: '/users',
    script: `(function process(request, response) {\n  return new CSATSurveyService().getUsersByCompany(request.queryParams.company_id);\n})(request, response);`,
  },
  {
    name: 'requests',
    http_method: 'POST',
    relative_path: '/requests',
    script: `(function process(request, response) {\n  var body = request.body.data || request.body;\n  return new CSATSurveyService().createSurveyRequest(body);\n})(request, response);`,
  },
];

async function ensureRestApi() {
  const existing = await snGet('sys_ws_definition', 'sysparm_query=name=CSAT Survey API&sysparm_fields=sys_id');
  let apiId;
  if (existing.length) {
    apiId = existing[0].sys_id;
    await snPatch('sys_ws_definition', apiId, { active: true, base_uri: '/api/x_csat/survey' });
  } else {
    const api = await snPost('sys_ws_definition', {
      name: 'CSAT Survey API',
      short_description: 'API for CSAT Survey Request UI',
      base_uri: '/api/x_csat/survey',
      active: true,
      consumes: 'application/json',
      produces: 'application/json',
    });
    apiId = api.sys_id;
  }

  for (const op of OPERATIONS) {
    const found = await snGet(
      'sys_ws_operation',
      `sysparm_query=web_service_definition=${apiId}^name=${op.name}&sysparm_fields=sys_id`
    );
    const payload = {
      web_service_definition: apiId,
      name: op.name,
      http_method: op.http_method,
      relative_path: op.relative_path,
      active: true,
      operation_script: op.script,
      requires_authentication: true,
    };
    if (found.length) {
      await snPatch('sys_ws_operation', found[0].sys_id, payload);
    } else {
      await snPost('sys_ws_operation', payload);
    }
    console.log(`REST operation: ${op.http_method} ${op.relative_path}`);
  }
}

async function fixUiPage() {
  // UI page is deployed by build-ui-page-simple.js
}

async function main() {
  await ensureRestApi();
  await fixUiPage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
