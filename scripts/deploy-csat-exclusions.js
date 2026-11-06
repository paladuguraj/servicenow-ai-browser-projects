#!/usr/bin/env node
/**
 * Deploy the CSAT account exclusions: accounts supported by the groups named in
 * csat.excluded_support_groups, and the partners named in csat.excluded_partners
 * together with their customers, never receive a CSAT survey.
 *
 * Only CSATSurveyService and the properties are touched, so this produces a
 * small update set on its own.
 */
const { snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const EXCLUSIONS = [
  {
    property: 'csat.excluded_support_groups',
    defaultValue: 'TAOPod',
    table: 'sys_user_group',
    label: 'support group',
    description:
      'Comma-separated support group names (sys_user_group). Accounts whose Support Group includes any of them never receive a CSAT survey: they are hidden from the CSAT portal company search, new requests are refused, and existing recurring requests are cancelled on their next run. Case surveys are not affected.',
  },
  {
    property: 'csat.excluded_partners',
    defaultValue: 'ATT TAO Partner',
    table: 'customer_account',
    label: 'partner account',
    description:
      'Comma-separated partner account names (customer_account). These partners and every account whose Parent (WLP Account) is one of them never receive a CSAT survey, whatever their Support Group: they are hidden from the CSAT portal company search, new requests are refused, and existing recurring requests are cancelled on their next run. Case surveys are not affected.',
  },
];

// Only created when missing, so a list maintained on the instance is not reset
// by the next deploy.
async function ensureProperty({ property, defaultValue, description }) {
  const existing = await snGet('sys_properties', `sysparm_query=name=${property}&sysparm_fields=sys_id,value`);
  if (existing.length) {
    console.log(`Property ${property} already set: ${existing[0].value}`);
    return existing[0].value;
  }
  await snPost('sys_properties', { name: property, value: defaultValue, type: 'string', description });
  console.log(`Created property ${property} = ${defaultValue}`);
  return defaultValue;
}

async function main() {
  announceTarget('Deploy CSAT account exclusions');

  for (const exclusion of EXCLUSIONS) {
    const value = await ensureProperty(exclusion);
    const names = value.split(',').map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      const found = await snGet(exclusion.table, `sysparm_query=${encodeURIComponent(`name=${name}`)}&sysparm_fields=sys_id`);
      if (!found.length) console.warn(`Warning: ${exclusion.label} "${name}" was not found, so it excludes nothing.`);
    }
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
