#!/usr/bin/env node
/**
 * Checks a CSAT install and says what is wrong with it.
 *
 * Written after a migration left the request form with an empty survey
 * dropdown: the update set carried the renamed csat.portal.survey_names
 * property, but the survey definitions kept their old names on the target, so
 * the name-based allow-list matched nothing.
 *
 * Point it at any instance and it reports what the portal can see and, where
 * something is broken, the command or change that fixes it.
 *
 *   ENV_FILE=.env.target node scripts/diagnose-csat.js
 */
const { snGet, announceTarget } = require('./lib/sn-client');

const PROPERTY = 'csat.portal.survey_names';
const problems = [];

function report(ok, label, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label);
}

async function main() {
  announceTarget('Diagnose CSAT install');

  console.log('\nSurvey definitions');
  const surveys = await snGet(
    'asmt_metric_type',
    'sysparm_query=active=true^evaluation_method=survey&sysparm_fields=sys_id,name,publish_state&sysparm_orderby=name'
  );
  report(surveys.length > 0, 'active survey definitions exist', `${surveys.length} found`);
  surveys.forEach((s) => console.log(`          ${s.name} [${s.publish_state}]`));

  console.log('\nPortal allow-list');
  const property = (
    await snGet('sys_properties', `sysparm_query=name=${PROPERTY}&sysparm_fields=sys_id,value`)
  )[0];

  if (!property) {
    report(true, `${PROPERTY} not set`, 'the portal falls back to its built-in list');
  } else {
    const configured = (property.value || '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    console.log(`          property = "${property.value}"`);

    if (!configured.length) {
      report(true, 'allow-list is empty', 'every active survey is offered');
    } else {
      const names = surveys.map((s) => s.name);
      const matched = configured.filter((n) => names.indexOf(n) !== -1);
      const missing = configured.filter((n) => names.indexOf(n) === -1);

      report(
        matched.length > 0,
        'allow-list matches surveys on this instance',
        `${matched.length} of ${configured.length} matched`
      );

      if (missing.length) {
        console.log(`          not found here: ${missing.join(', ')}`);
        console.log('\n          The survey dropdown is driven by this match. Either rename the');
        console.log(`          surveys to the configured names, or set ${PROPERTY} to the`);
        console.log('          ones this instance should offer, chosen from:');
        names.forEach((n) => console.log(`             ${n}`));
        console.log('\n          Until then the form offers every active survey rather than none,');
        console.log('          and shows a warning saying why.');
      }
    }
  }

  console.log('\nPublished state');
  const unpublished = surveys.filter((s) => s.publish_state !== 'published');
  report(
    unpublished.length === 0,
    'every active survey is published',
    unpublished.length ? `${unpublished.map((s) => s.name).join(', ')} cannot generate surveys` : 'nothing in draft'
  );

  console.log('\nCore artifacts');
  for (const [table, query, label] of [
    ['sys_script_include', 'name=CSATSurveyService', 'CSATSurveyService'],
    ['sys_script_include', 'name=CSATSurveyReport', 'CSATSurveyReport'],
    ['sp_widget', 'id=csat-survey-request', 'request widget'],
    ['sp_portal', 'url_suffix=csat', 'portal'],
    ['sysauto_script', 'nameSTARTSWITHCSAT Survey Request', 'scheduled runner'],
  ]) {
    const found = await snGet(table, `sysparm_query=${encodeURIComponent(query)}&sysparm_fields=sys_id`);
    report(found.length > 0, `${label} present`);
  }

  const tables = await snGet(
    'sys_db_object',
    'sysparm_query=nameSTARTSWITHu_x_csat&sysparm_fields=name&sysparm_limit=20'
  );
  report(tables.length === 3, 'the three CSAT tables exist', `${tables.length} found`);

  console.log(
    problems.length
      ? `\n${problems.length} problem(s): ${problems.join('; ')}`
      : '\nNothing wrong found.'
  );
  if (problems.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
