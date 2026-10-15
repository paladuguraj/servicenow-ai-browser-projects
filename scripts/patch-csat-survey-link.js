#!/usr/bin/env node
/**
 * Update only the CSATSurveyService script include.
 *
 * Used when a full patch-csat-app.js run would pull too many records into a
 * focused update set.
 */
const { snGet, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

async function main() {
  announceTarget('Patch CSATSurveyService script include');

  const scriptInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyService&sysparm_fields=sys_id'))[0];
  if (!scriptInclude) throw new Error('CSATSurveyService script include not found');

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
