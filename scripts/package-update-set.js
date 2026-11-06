#!/usr/bin/env node
/**
 * Builds a self-contained update set for one feature from the records as they
 * stand now, so the feature can be moved to another instance on its own,
 * without replaying the sets it was built across.
 *
 * Each record is written into the set with GlideUpdateManager2.saveRecord, the
 * same way the platform captures a change, so the set holds the full current
 * record whether or not it changed recently. The set is marked Complete and the
 * deploying user's current update set is put back as it was.
 *
 * Usage:
 *   node scripts/package-update-set.js <bundle> [--name "Set name"] [--dry-run]
 *
 * Bundles: company-list, dashboard, survey-schedule-rename
 */
const { base, snGet, snPost, snPatch, snDelete, announceTarget } = require('./lib/sn-client');
const { withProbe } = require('./lib/probe');

const SCHEDULE_SURVEY = 'Managed Network Services Survey - Schedule';

const BUNDLES = {
  'company-list': {
    name: 'CSAT Survey Portal - Company list shows all companies',
    description:
      'Request form company list pages through every account (50 at a time, loaded on scroll) instead of stopping at 50. ' +
      'Carries CSATSurveyService, the CSAT Survey Request widget and the csat.excluded_partners property it reads.',
    records: [
      { table: 'sys_script_include', query: 'name=CSATSurveyService' },
      { table: 'sp_widget', query: 'id=csat-survey-request' },
      { table: 'sys_properties', query: 'name=csat.excluded_partners' },
    ],
  },
  dashboard: {
    name: 'CSAT Survey Portal - Survey Management Dashboard',
    description:
      'Survey Management Dashboard on the CSAT portal (?id=csat_dashboard): Case Auto CSAT and CSAT Manual Tool tabs, ' +
      'charts, and PDF, Excel and CSV exports. Replaces the three earlier dashboard sets.',
    records: [
      { table: 'sys_properties', query: 'name=csat.dashboard.case_surveys' },
      { table: 'sys_script_include', query: 'name=CSATDashboard' },
      { table: 'sp_widget', query: 'id=csat-dashboard' },
      { table: 'sp_page', query: 'id=csat_dashboard' },
      { layout: 'csat_dashboard' },
      { table: 'sp_rectangle_menu_item', query: 'sp_page.id=csat_dashboard' },
    ],
    // "Who can view" is left out on purpose: the "CSAT Survey Admins" user
    // criteria was created by hand on each instance, so its sys_id differs and
    // a captured link would point at nothing on the target.
    manualSteps: [
      'Service Portal > Pages > csat_dashboard > "Who can view" (Can View): add "CSAT Survey Admins"',
      'Service Portal > Widgets > Survey Management Dashboard > "Who can view" (Can View): add "CSAT Survey Admins"',
    ],
  },
  'survey-schedule-rename': {
    name: 'CSAT Survey Portal - Rename Automatic survey to Schedule',
    description:
      `Renames "Managed Network Services Survey - Automatic" to "${SCHEDULE_SURVEY}" and every reference to it: ` +
      'the survey and its category, the csat.portal.survey_names property, CSATSurveyService and the survey logo header widget.',
    records: [
      { table: 'asmt_metric_type', query: `name=${SCHEDULE_SURVEY}` },
      { table: 'asmt_metric_category', query: `metric_type.name=${SCHEDULE_SURVEY}` },
      { table: 'sys_properties', query: 'name=csat.portal.survey_names' },
      { table: 'sys_script_include', query: 'name=CSATSurveyService' },
      { table: 'sp_widget', query: 'id=csat-survey-logo-header' },
    ],
  },
};

const args = process.argv.slice(2);
const bundleId = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--name');
const nameFlag = args.indexOf('--name');
const dryRun = args.includes('--dry-run');

const CAPTURE_SCRIPT = `(function process(request, response) {
  var body = request.body.data;
  var manager = new GlideUpdateManager2();
  var previous = new GlideUpdateSet().get();
  new GlideUpdateSet().set(body.target_set);
  var saved = [];
  var missing = [];

  function save(gr) {
    manager.saveRecord(gr);
    saved.push(gr.getTableName() + ': ' + gr.getDisplayValue());
  }

  function captureLayout(pageId) {
    var page = new GlideRecord('sp_page');
    if (!page.get('id', pageId)) { missing.push('layout of ' + pageId); return; }
    var container = new GlideRecord('sp_container');
    container.addQuery('sp_page', page.getUniqueValue());
    container.query();
    while (container.next()) {
      save(container);
      var row = new GlideRecord('sp_row');
      row.addQuery('sp_container', container.getUniqueValue());
      row.query();
      while (row.next()) {
        save(row);
        var column = new GlideRecord('sp_column');
        column.addQuery('sp_row', row.getUniqueValue());
        column.query();
        while (column.next()) {
          save(column);
          var instance = new GlideRecord('sp_instance');
          instance.addQuery('sp_column', column.getUniqueValue());
          instance.query();
          while (instance.next()) save(instance);
        }
      }
    }
  }

  try {
    body.records.forEach(function(spec) {
      if (spec.layout) { captureLayout(spec.layout); return; }
      var gr = new GlideRecord(spec.table);
      gr.addEncodedQuery(spec.query);
      gr.query();
      var found = 0;
      while (gr.next()) { save(gr); found++; }
      if (!found) missing.push(spec.table + ' ' + spec.query);
    });
  } finally {
    new GlideUpdateSet().set(previous);
  }
  return { result: { saved: saved, missing: missing } };
})(request, response);`;

async function main() {
  const bundle = BUNDLES[bundleId];
  if (!bundle) {
    console.error(`Usage: node scripts/package-update-set.js <${Object.keys(BUNDLES).join('|')}> [--name "..."] [--dry-run]`);
    process.exit(1);
  }
  const setName = nameFlag !== -1 ? args[nameFlag + 1] : bundle.name;
  announceTarget(`Package update set "${setName}"${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    bundle.records.forEach((r) => console.log(r.layout ? `  layout of page ${r.layout}` : `  ${r.table}: ${r.query}`));
    return;
  }

  const existing = await snGet(
    'sys_update_set',
    `sysparm_query=${encodeURIComponent(`name=${setName}`)}&sysparm_fields=sys_id,state`
  );
  if (existing.some((s) => s.state === 'complete'))
    throw new Error(`An update set named "${setName}" is already complete; pass --name to build a new one.`);
  let set;
  if (existing.length) {
    set = existing[0];
    await snPatch('sys_update_set', set.sys_id, { description: bundle.description });
  } else {
    set = await snPost('sys_update_set', { name: setName, description: bundle.description, state: 'in progress', application: 'global' });
  }

  const result = await withProbe('csat_verify_package', CAPTURE_SCRIPT, (call) =>
    call({ body: { target_set: set.sys_id, records: bundle.records } }), 'POST');

  // The probe endpoint is tooling, not part of any feature, wherever the
  // platform recorded it.
  const probeEntries = await snGet(
    'sys_update_xml',
    `sysparm_query=nameSTARTSWITHsys_ws_operation^target_name=csat_verify_package&sysparm_fields=sys_id`
  );
  for (const entry of probeEntries) await snDelete('sys_update_xml', entry.sys_id);

  if (result.missing.length) {
    console.error(`Not found, set left In progress:\n  ${result.missing.join('\n  ')}`);
    process.exit(1);
  }

  const entries = await snGet(
    'sys_update_xml',
    `sysparm_query=update_set=${set.sys_id}^ORDERBYtype&sysparm_fields=type,target_name&sysparm_limit=1000`
  );
  await snPatch('sys_update_set', set.sys_id, { state: 'complete' });

  console.log(`\n"${setName}" (${set.sys_id}) is Complete with ${entries.length} record(s):`);
  entries.forEach((e) => console.log(`  ${e.type}: ${e.target_name}`));
  if (bundle.manualSteps) {
    console.log('\nAfter committing the set on the target, also:');
    bundle.manualSteps.forEach((step) => console.log(`  - ${step}`));
  }
  console.log(`\nExport XML:\n  ${base}/export_update_set.do?sysparm_sys_id=${set.sys_id}&sysparm_delete_when_done=false`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
