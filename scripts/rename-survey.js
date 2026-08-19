#!/usr/bin/env node
/**
 * Renames a survey definition and everything that refers to it by name.
 *
 * The name is not just a label: the portal decides which surveys to offer by
 * matching names in the csat.portal.survey_names property, and the report
 * reads the same list. Renaming the definition alone would drop the survey out
 * of both, so this moves the property and the category together.
 *
 * Usage:
 *   node scripts/rename-survey.js "Old Name" "New Name" [--apply]
 */
const { snGet, snPatch, announceTarget } = require('./lib/sn-client');

const SURVEY_LIST_PROPERTY = 'csat.portal.survey_names';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const apply = process.argv.includes('--apply');
const [oldName, newName] = args;

if (!oldName || !newName) {
  console.error('Usage: node scripts/rename-survey.js "Old Name" "New Name" [--apply]');
  process.exit(1);
}

async function main() {
  announceTarget(apply ? `Rename survey to "${newName}"` : `Rename survey to "${newName}" (DRY RUN)`);
  if (!apply) console.log('Dry run: pass --apply to write.\n');

  const survey = (await snGet(
    'asmt_metric_type',
    `sysparm_query=${encodeURIComponent(`name=${oldName}`)}&sysparm_fields=sys_id,name,description,publish_state`
  ))[0];

  if (!survey) {
    console.log(`No survey named "${oldName}".`);
    return;
  }

  const patch = { name: newName };
  // The description is often just the name repeated; only move it when it is.
  if ((survey.description || '').trim() === oldName) patch.description = newName;

  if (apply) await snPatch('asmt_metric_type', survey.sys_id, patch);
  console.log(`${apply ? 'Renamed' : 'Would rename'} survey [${survey.publish_state}]: "${oldName}" -> "${newName}"`);
  if (patch.description) console.log('   description followed the name');

  // Categories carry the survey name on the question page heading.
  const categories = await snGet(
    'asmt_metric_category',
    `sysparm_query=metric_type=${survey.sys_id}^${encodeURIComponent(`name=${oldName}`)}&sysparm_fields=sys_id,name`
  );
  for (const category of categories) {
    if (apply) await snPatch('asmt_metric_category', category.sys_id, { name: newName });
    console.log(`${apply ? 'Renamed' : 'Would rename'} category: "${category.name}" -> "${newName}"`);
  }

  const property = (await snGet(
    'sys_properties',
    `sysparm_query=name=${SURVEY_LIST_PROPERTY}&sysparm_fields=sys_id,value`
  ))[0];

  if (!property) {
    console.log(`\n${SURVEY_LIST_PROPERTY} is not set; the portal falls back to its built-in list.`);
    return;
  }

  const names = property.value.split(',').map((n) => n.trim());
  if (names.indexOf(oldName) === -1) {
    console.log(`\n${SURVEY_LIST_PROPERTY} does not mention "${oldName}"; left alone.`);
    return;
  }

  const updated = names.map((n) => (n === oldName ? newName : n)).join(',');
  if (apply) await snPatch('sys_properties', property.sys_id, { value: updated });
  console.log(`\n${apply ? 'Updated' : 'Would update'} ${SURVEY_LIST_PROPERTY}:`);
  console.log(`   ${property.value}`);
  console.log(`   ${updated}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
