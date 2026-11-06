#!/usr/bin/env node
/**
 * Deploy the CSAT email logo: the public "CSAT Email Logo" Scripted REST API
 * that serves approved logo images, and the csat_partner_logo_image mail script
 * that links to it.
 *
 * Also removes the "CSAT Email - Attach Inline Logo" business rule left by the
 * earlier inline (cid:) attempt, if present.
 */
const { snGet, snPost, snPatch, snDelete, readArtifact, announceTarget } = require('./lib/sn-client');

const API_NAME = 'CSAT Email Logo';
const SERVICE_ID = 'csat_email_logo';
const RETIRED_RULE = 'CSAT Email - Attach Inline Logo';

async function ensureApi() {
  const existing = await snGet('sys_ws_definition', `sysparm_query=service_id=${SERVICE_ID}&sysparm_fields=sys_id,base_uri`);
  if (existing.length) return existing[0];
  const created = await snPost('sys_ws_definition', {
    name: API_NAME,
    service_id: SERVICE_ID,
    active: true,
    short_description:
      'Public image endpoint for the CSAT email logo. Serves only the default CSAT logo and white-label partner banner images; anything else returns 404.',
    produces: 'image/png,image/jpeg,image/gif',
  });
  console.log(`Created Scripted REST API: ${API_NAME}`);
  return (await snGet('sys_ws_definition', `sysparm_query=sys_id=${created.sys_id}&sysparm_fields=sys_id,base_uri`))[0];
}

async function ensureOperation(api) {
  const payload = {
    web_service_definition: api.sys_id,
    name: 'logo',
    http_method: 'GET',
    relative_path: '/{file}',
    active: true,
    requires_authentication: false,
    requires_acl_authorization: false,
    requires_snc_internal_role: false,
    produces: 'image/png,image/jpeg,image/gif',
    operation_script: readArtifact('rest/csat-email-logo.js'),
  };
  const existing = await snGet('sys_ws_operation', `sysparm_query=web_service_definition=${api.sys_id}^name=logo&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch('sys_ws_operation', existing[0].sys_id, payload);
    console.log('Updated resource: GET /{file}');
    return;
  }
  await snPost('sys_ws_operation', payload);
  console.log('Created resource: GET /{file}');
}

async function main() {
  announceTarget('Deploy CSAT email logo API');

  const api = await ensureApi();
  await ensureOperation(api);
  console.log(`Logo URL base: ${api.base_uri}/<attachment sys_id>`);

  const mailScript = (await snGet('sys_script_email', 'sysparm_query=name=csat_partner_logo_image&sysparm_fields=sys_id'))[0];
  if (!mailScript) throw new Error('csat_partner_logo_image not found; run deploy-csat-email-template.js first');
  await snPatch('sys_script_email', mailScript.sys_id, { script: readArtifact('mail-scripts/csat_partner_logo_image.js') });
  console.log('Updated csat_partner_logo_image');

  for (const rule of await snGet('sys_script', `sysparm_query=${encodeURIComponent(`name=${RETIRED_RULE}`)}&sysparm_fields=sys_id`)) {
    await snDelete('sys_script', rule.sys_id);
    console.log(`Deleted business rule: ${RETIRED_RULE}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
