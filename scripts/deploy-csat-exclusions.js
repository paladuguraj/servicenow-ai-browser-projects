#!/usr/bin/env node
/**
 * Deploy the CSAT account exclusion: accounts supported by the groups named in
 * csat.excluded_support_groups never receive a CSAT survey.
 *
 * Only CSATSurveyService and the property are touched, so this produces a
 * small update set on its own.
 */
const { snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const PROPERTY = 'csat.excluded_support_groups';
const DEFAULT_GROUPS = 'TAOPod';

// Only created when missing, so a list maintained on the instance is not reset
// by the next deploy.
async function ensureProperty() {
  const existing = await snGet('sys_properties', `sysparm_query=name=${PROPERTY}&sysparm_fields=sys_id,value`);
  if (existing.length) {
    console.log(`Property ${PROPERTY} already set: ${existing[0].value}`);
    return existing[0].value;
  }
  await snPost('sys_properties', {
    name: PROPERTY,
    value: DEFAULT_GROUPS,
    type: 'string',
    description:
      'Comma-separated support group names (sys_user_group). Accounts whose Support Group includes any of them never receive a CSAT survey: they are hidden from the CSAT portal company search, new requests are refused, and existing recurring requests are cancelled on their next run. Case surveys are not affected.',
  });
  console.log(`Created property ${PROPERTY} = ${DEFAULT_GROUPS}`);
  return DEFAULT_GROUPS;
}

async function main() {
  announceTarget('Deploy CSAT account exclusion');

  const value = await ensureProperty();
  const names = value.split(',').map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    const group = await snGet('sys_user_group', `sysparm_query=${encodeURIComponent(`name=${name}`)}&sysparm_fields=sys_id`);
    if (!group.length) console.warn(`Warning: support group "${name}" was not found, so it excludes nothing.`);
  }

  const scriptInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyService&sysparm_fields=sys_id'))[0];
  if (!scriptInclude) throw new Error('CSATSurveyService not found; run deploy-csat-app.js first');
  await snPatch('sys_script_include', scriptInclude.sys_id, {
    script: readArtifact('script-includes/CSATSurveyService.js'),
    active: true,
  });
  console.log('Updated CSATSurveyService');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
