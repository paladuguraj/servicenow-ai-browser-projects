#!/usr/bin/env node

const { base, headers, snGet, snPost, snPatch } = require('./lib/sn-client');

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
