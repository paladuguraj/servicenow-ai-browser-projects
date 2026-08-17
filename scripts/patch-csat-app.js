#!/usr/bin/env node
/**
 * Patch deployed CSAT artifacts with corrected table/field names.
 */

const { base, headers, snGet, snPatch, readArtifact } = require('./lib/sn-client');

async function main() {
  const scriptInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyService&sysparm_fields=sys_id'))[0];
  await snPatch('sys_script_include', scriptInclude.sys_id, {
    script: readArtifact('script-includes/CSATSurveyService.js'),
    active: true,
  });
  console.log('Updated CSATSurveyService');

  const businessRule = (await snGet('sys_script', 'sysparm_query=name=CSAT Survey Request - Process on Submit&sysparm_fields=sys_id'))[0];
  await snPatch('sys_script', businessRule.sys_id, {
    collection: 'u_x_csat_survey_request',
    script: readArtifact('business-rules/process-on-submit.js'),
    active: true,
    when: 'after',
    action_insert: true,
    action_update: true,
  });
  console.log('Updated business rule');

  const scheduledJob = (await snGet('sysauto_script', 'sysparm_query=name=CSAT Survey Request - Scheduled Runner&sysparm_fields=sys_id'))[0];
  await snPatch('sysauto_script', scheduledJob.sys_id, {
    script: readArtifact('scheduled-jobs/runner.js'),
    active: true,
  });
  console.log('Updated scheduled job');

  const reportInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyReport&sysparm_fields=sys_id'))[0];
  if (reportInclude) {
    await snPatch('sys_script_include', reportInclude.sys_id, {
      script: readArtifact('script-includes/CSATSurveyReport.js'),
      active: true,
    });
    console.log('Updated CSATSurveyReport');
  }

  const notificationInclude = (await snGet('sys_script_include', 'sysparm_query=name=CSATSurveyNotification&sysparm_fields=sys_id'))[0];
  if (notificationInclude) {
    await snPatch('sys_script_include', notificationInclude.sys_id, {
      script: readArtifact('script-includes/CSATSurveyNotification.js'),
      active: true,
    });
    console.log('Updated CSATSurveyNotification');
  }

  const submitBr = (await snGet('sys_script', 'sysparm_query=name=CSAT Survey - Notify on Submission&sysparm_fields=sys_id'))[0];
  if (submitBr) {
    await snPatch('sys_script', submitBr.sys_id, {
      script: readArtifact('business-rules/notify-on-survey-submitted.js'),
      active: true,
    });
    console.log('Updated submission notification business rule');
  }

  for (const mod of await snGet('sys_app_module', 'sysparm_query=titleLIKECSAT Survey&sysparm_fields=sys_id,title,name')) {
    const table = mod.title.includes('Executions') ? 'u_x_csat_survey_execution' : 'u_x_csat_survey_request';
    await snPatch('sys_app_module', mod.sys_id, { name: table, link_type: 'LIST' });
    console.log(`Updated module ${mod.title} -> ${table}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
