#!/usr/bin/env node
/**
 * Deploy the inline (cid:) CSAT email logo: the csat_partner_logo_image mail
 * script and the sys_email business rule that attaches the referenced logo to
 * each outgoing email.
 */
const { snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const RULE_NAME = 'CSAT Email - Attach Inline Logo';

async function ensureBusinessRule() {
  const existing = await snGet('sys_script', `sysparm_query=${encodeURIComponent(`name=${RULE_NAME}`)}&sysparm_fields=sys_id`);
  const payload = {
    name: RULE_NAME,
    collection: 'sys_email',
    when: 'after',
    action_insert: true,
    action_update: false,
    filter_condition: 'typeINsend-ready,send-ignored^bodyLIKEcid:csat-logo-^EQ',
    advanced: true,
    active: true,
    order: 100,
    description: 'Attaches the CSAT logo referenced as cid:csat-logo-<attachment>.<ext> by the csat_partner_logo_image mail script to the outgoing email as an inline image.',
    script: readArtifact('business-rules/attach-inline-logo.js'),
  };
  if (existing.length) {
    await snPatch('sys_script', existing[0].sys_id, payload);
    console.log(`Updated business rule: ${RULE_NAME}`);
    return;
  }
  await snPost('sys_script', payload);
  console.log(`Created business rule: ${RULE_NAME}`);
}

async function main() {
  announceTarget('Deploy CSAT inline email logo');

  const mailScript = (await snGet('sys_script_email', 'sysparm_query=name=csat_partner_logo_image&sysparm_fields=sys_id'))[0];
  if (!mailScript) throw new Error('csat_partner_logo_image not found; run deploy-csat-email-template.js first');
  await snPatch('sys_script_email', mailScript.sys_id, { script: readArtifact('mail-scripts/csat_partner_logo_image.js') });
  console.log('Updated csat_partner_logo_image');

  await ensureBusinessRule();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
