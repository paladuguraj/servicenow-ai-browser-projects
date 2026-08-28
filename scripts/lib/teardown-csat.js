#!/usr/bin/env node
/**
 * Remove CSAT artifacts created by this tooling so the deployment can be
 * rebuilt cleanly in the global scope.
 *
 * Only deletes records matching the exact names this tooling creates, and
 * (unless --force) only those created by the current user. Pre-existing CSAT
 * work on the instance is left untouched.
 */
const { snGet, snDelete, announceTarget } = require('./sn-client');

const force = process.argv.includes('--force');
const apply = process.argv.includes('--apply');

// Ordered so dependents go before the things they reference.
const TARGETS = [
  ['sp_instance', 'sp_widget.id=csat-survey-request', 'Portal widget instances'],
  ['sp_rectangle_menu_item', 'sp_rectangle_menu.title=CSAT Portal Menu', 'Portal menu items'],
  ['sp_instance_menu', 'title=CSAT Portal Menu', 'Portal menu'],
  ['sp_portal', 'url_suffix=csat', 'Portal'],
  ['sp_column', 'sp_row.sp_container.sp_page.id=csat_home', 'Portal columns'],
  ['sp_row', 'sp_container.sp_page.id=csat_home', 'Portal rows'],
  ['sp_container', 'sp_page.id=csat_home', 'Portal containers'],
  ['sp_page', 'id=csat_home', 'Portal page'],
  ['sp_widget', 'id=csat-survey-request', 'Widget'],
  ['sysevent_email_action', 'nameSTARTSWITHCSAT Survey Submitted', 'Notifications'],
  ['sysevent_register', 'event_name=csat.survey.submitted', 'Event registration'],
  ['sys_ws_operation', 'web_service_definition.name=CSAT Survey API', 'REST operations'],
  ['sys_ws_definition', 'name=CSAT Survey API', 'REST API'],
  ['sys_script', 'name=CSAT Survey - Notify on Submission^ORname=CSAT Survey Request - Process on Submit', 'Business rules'],
  ['sysauto_script', 'name=CSAT Survey Request - Scheduled Runner', 'Scheduled job'],
  ['sys_script_include', 'nameSTARTSWITHCSATSurvey', 'Script includes'],
  ['sys_app_module', 'titleSTARTSWITHCSAT Survey', 'Modules'],
  ['sys_app_application', 'title=CSAT Survey', 'Application menu'],
  ['sys_ui_page', 'name=csat_survey_request', 'UI page'],
  ['sys_db_object', 'nameSTARTSWITHx_csat_survey_u_x_csat^ORnameSTARTSWITHu_x_csat', 'Tables'],
  ['sys_app', 'scope=x_csat_survey', 'Application record'],
  ['sys_scope', 'scope=x_csat_survey', 'Scope'],
];

async function main() {
  announceTarget(apply ? 'Tear down CSAT artifacts' : 'Tear down CSAT artifacts (DRY RUN)');
  if (!apply) console.log('Dry run: pass --apply to delete.\n');

  const user = process.env.SN_USERNAME;
  let total = 0;

  for (const [table, query, label] of TARGETS) {
    const scoped = force ? query : `${query}^sys_created_by=${user}`;
    let records = [];
    try {
      records = await snGet(table, `sysparm_query=${scoped}&sysparm_fields=sys_id,name,title,id,label,sys_created_by&sysparm_limit=200`);
    } catch (e) {
      console.log(`${label}: query failed (${e.message.slice(0, 80)})`);
      continue;
    }
    if (!records.length) continue;

    console.log(`${label} (${table}): ${records.length}`);
    for (const r of records) {
      const name = r.name || r.title || r.id || r.label || r.sys_id;
      if (!apply) {
        console.log(`    would delete ${name}`);
        total++;
        continue;
      }
      try {
        await snDelete(table, r.sys_id);
        console.log(`    deleted ${name}`);
        total++;
      } catch (e) {
        console.log(`    FAILED ${name}: ${e.message.slice(0, 120)}`);
      }
    }
  }

  console.log(`\n${apply ? 'Deleted' : 'Would delete'} ${total} record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
