#!/usr/bin/env node
/**
 * Collapses every CSAT Survey Portal update set into a single set that can be
 * exported and committed on another instance.
 *
 * The work was captured across a dozen sets as it was built. Committing those
 * in order would work, but it is error-prone by hand and carries a lot of
 * churn, so this rebuilds them as one set holding the final state.
 *
 * Source sets are left untouched, so the history stays readable.
 *
 * Usage:
 *   node scripts/consolidate-update-set.js [--name "..."] [--dry-run] [--retire-sources]
 *
 * --retire-sources marks the sets it consolidated as Ignore, so only one set
 * is offered for export. It is reversible: set them back to Complete to use
 * them again.
 */
const { base, snGet, snPost, snPatch, announceTarget } = require('./lib/sn-client');
const { withProbe, PROBE_API_NAME } = require('./lib/probe');

// Only sets this project created. The instance also carries older CSAT work
// from the customer ("SE-740_CSAT Survey edits_CC" and similar) which must not
// be swept in.
const SOURCE_PREFIX = 'CSAT Survey Portal';
const DEFAULT_TARGET = 'CSAT Survey Portal - ALL CHANGES v2.0';

// Placing a widget on a page deletes and recreates the page layout, so every
// re-deploy left behind a delete for the previous generation. Those records
// only ever existed on this instance, so replaying the deletes on a target
// achieves nothing.
const LAYOUT_TYPES = ['Container', 'Row', 'Column', 'Instance'];

// Records that have to be pushed into the set deliberately.
//
// The platform treats scheduled jobs as data rather than metadata, so editing
// one is never captured, and the 30/60-day schedules would never run on the
// target without this.
//
// The portal layout is here for a different reason: placing a widget deletes
// and recreates the containers, rows, columns and instances, so their sys_ids
// change on every deploy and any previously captured entry goes stale. Taking
// the live layout straight from the pages keeps the set correct however many
// times the portal has been redeployed.
const FORCE_CAPTURE = [
  { table: 'sysauto_script', query: 'name=CSAT Survey Request - Scheduled Runner', label: 'scheduled job' },
  { layout: true, pages: ['csat_home', 'csat_requests', 'csat_report'], label: 'portal layout' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const retireSources = args.includes('--retire-sources');
const nameFlag = args.indexOf('--name');
const targetName = nameFlag !== -1 ? args[nameFlag + 1] : DEFAULT_TARGET;

// Fields that define an update, as opposed to bookkeeping the platform sets
// itself. sys_recorded_at is deliberately omitted: it is regenerated on insert,
// and inserting in chronological order preserves the original sequence.
const COPIED_FIELDS = [
  'name',
  'type',
  'target_name',
  'action',
  'payload',
  'payload_hash',
  'category',
  'table',
  'application',
  'update_domain',
  'replace_on_upgrade',
  'view',
  'update_guid',
  'update_guid_history',
  'comments',
];

function chronological(a, b) {
  if (a.sys_created_on !== b.sys_created_on) return a.sys_created_on < b.sys_created_on ? -1 : 1;
  return a.sys_recorded_at < b.sys_recorded_at ? -1 : 1;
}

/**
 * Why an entry is not carried across. Returns null to keep it.
 *
 * The set should describe the solution as it stands, so anything whose final
 * state is a deletion is left out: the record does not exist here, and on a
 * fresh target there is nothing to delete.
 */
function skipReason(history) {
  const last = history[history.length - 1];
  if (last.action === 'INSERT_OR_UPDATE') return null;

  if (/^zz_/.test(last.target_name)) return 'temporary test endpoint';
  if (LAYOUT_TYPES.indexOf(last.type) !== -1) return 'superseded portal layout';
  return 'record was deleted during the build';
}

/**
 * The surveys went through two rounds of question changes. The superseded
 * questions were deactivated rather than deleted, because answers recorded
 * against them during testing would have gone with them, but a target has no
 * such history and should receive only the questions in use.
 */
async function dropRetiredQuestions(entries) {
  const metricIds = [];
  const definitionIds = [];
  entries.forEach((row) => {
    const match = /^(asmt_metric|asmt_metric_definition)_([0-9a-f]{32})$/.exec(row.name);
    if (!match) return;
    (match[1] === 'asmt_metric' ? metricIds : definitionIds).push(match[2]);
  });
  if (!metricIds.length) return entries;

  const metrics = await snGet(
    'asmt_metric',
    `sysparm_query=sys_idIN${metricIds.join(',')}&sysparm_fields=sys_id,name,active&sysparm_limit=1000`
  );
  const retired = new Set(metrics.filter((m) => m.active !== 'true').map((m) => m.sys_id));

  // A choice belongs to one question, so it goes wherever that question goes.
  const definitions = definitionIds.length
    ? await snGet(
        'asmt_metric_definition',
        `sysparm_query=sys_idIN${definitionIds.join(',')}&sysparm_fields=sys_id,metric&sysparm_limit=1000`
      )
    : [];
  const retiredDefinitions = new Set(
    definitions.filter((d) => retired.has(d.metric && d.metric.value ? d.metric.value : d.metric)).map((d) => d.sys_id)
  );

  const dropped = [];
  const kept = entries.filter((row) => {
    const match = /^(asmt_metric|asmt_metric_definition)_([0-9a-f]{32})$/.exec(row.name);
    if (!match) return true;
    const isRetired = match[1] === 'asmt_metric' ? retired.has(match[2]) : retiredDefinitions.has(match[2]);
    if (isRetired) dropped.push(row);
    return !isRetired;
  });

  if (dropped.length) {
    const questions = dropped.filter((d) => d.type === 'Assessment Metric');
    console.log(
      `  skipping ${dropped.length} — superseded survey question(s) and their answer choices: ` +
        `${[...new Set(questions.map((q) => q.target_name))].sort().join(', ')}`
    );
  }
  return kept;
}

/**
 * Every set this project created, whatever its state. Retired sources are
 * marked Ignore rather than emptied, so a re-run has to keep reading them.
 */
async function findSourceSets() {
  return snGet(
    'sys_update_set',
    `sysparm_query=${encodeURIComponent(
      `nameSTARTSWITH${SOURCE_PREFIX}^name!=${targetName}`
    )}&sysparm_fields=sys_id,name,state,sys_created_on&sysparm_orderby=sys_created_on`
  );
}

async function loadEntries(sets) {
  const entries = [];
  for (const set of sets) {
    const rows = await snGet(
      'sys_update_xml',
      `sysparm_query=update_set=${set.sys_id}&sysparm_fields=sys_id,name,type,target_name,action,sys_created_on,sys_recorded_at&sysparm_limit=5000`
    );
    rows.forEach((row) => entries.push(row));
  }
  return entries.sort(chronological);
}

/**
 * Repeated deploys left a few records captured as inserts that were later
 * removed while a different set was current, so the removal was never
 * recorded. Committing those would recreate records this instance no longer
 * has. Entries keyed by table and element rather than sys_id (dictionary,
 * field labels, choice lists) cannot be looked up this way and are kept.
 */
async function dropStale(entries) {
  const byTable = {};
  const unchecked = [];

  entries.forEach((row) => {
    const match = /^(.*)_([0-9a-f]{32})$/.exec(row.name);
    if (!match || row.action !== 'INSERT_OR_UPDATE') {
      unchecked.push(row);
      return;
    }
    byTable[match[1]] = byTable[match[1]] || [];
    byTable[match[1]].push({ sysId: match[2], row });
  });

  const live = [];
  const stale = [];
  for (const table of Object.keys(byTable)) {
    const ids = byTable[table].map((x) => x.sysId);
    const found = new Set(
      (await snGet(table, `sysparm_query=sys_idIN${ids.join(',')}&sysparm_fields=sys_id&sysparm_limit=5000`)).map(
        (x) => x.sys_id
      )
    );
    byTable[table].forEach((x) => (found.has(x.sysId) ? live : stale).push(x.row));
  }

  if (stale.length) {
    console.log(`  skipping ${stale.length} — record no longer exists on this instance`);
    stale.forEach((row) => console.log(`      ${row.type} "${row.target_name}"`));
  }

  return unchecked.concat(live).sort(chronological);
}

// sys_update_xml rejects inserts over the Table API ("Insert Failed due to
// security constraints"), so the copy runs server-side through a temporary
// endpoint that is removed again afterwards.
const COPY_SCRIPT = `(function process(request, response) {
  var body = request.body.data;
  var out = { cleared: 0, written: 0, errors: [] };

  var target = new GlideRecord('sys_update_set');
  if (!target.get(body.target_set))
    return { result: { error: 'target update set not found' } };

  var existing = new GlideRecord('sys_update_xml');
  existing.addQuery('update_set', body.target_set);
  existing.query();
  while (existing.next()) {
    existing.deleteRecord();
    out.cleared++;
  }

  var fields = body.fields;

  for (var i = 0; i < body.ids.length; i++) {
    var source = new GlideRecord('sys_update_xml');
    if (!source.get(body.ids[i])) {
      out.errors.push('missing source ' + body.ids[i]);
      continue;
    }
    var copy = new GlideRecord('sys_update_xml');
    copy.initialize();
    for (var f = 0; f < fields.length; f++)
      copy.setValue(fields[f], source.getValue(fields[f]));
    copy.setValue('update_set', body.target_set);
    if (copy.insert()) out.written++;
    else out.errors.push('insert failed for ' + source.getValue('name'));
  }

  // Records the platform will not capture on its own are pushed in through the
  // same API the "Add to Update Set" action uses.
  out.forced = [];
  out.forcedCount = 0;
  if (body.force.length) {
    var manager = new GlideUpdateManager2();
    var previous = new GlideUpdateSet().get();
    new GlideUpdateSet().set(body.target_set);

    function save(gr) {
      manager.saveRecord(gr);
      return 1;
    }

    // Walks page -> container -> row -> column -> instance, capturing each.
    function captureLayout(pageIds) {
      var saved = 0;
      var page = new GlideRecord('sp_page');
      page.addQuery('id', 'IN', pageIds.join(','));
      page.query();
      while (page.next()) {
        var container = new GlideRecord('sp_container');
        container.addQuery('sp_page', page.getUniqueValue());
        container.query();
        while (container.next()) {
          saved += save(container);
          var row = new GlideRecord('sp_row');
          row.addQuery('sp_container', container.getUniqueValue());
          row.query();
          while (row.next()) {
            saved += save(row);
            var column = new GlideRecord('sp_column');
            column.addQuery('sp_row', row.getUniqueValue());
            column.query();
            while (column.next()) {
              saved += save(column);
              var instance = new GlideRecord('sp_instance');
              instance.addQuery('sp_column', column.getUniqueValue());
              instance.query();
              while (instance.next()) saved += save(instance);
            }
          }
        }
      }
      return saved;
    }

    try {
      for (var j = 0; j < body.force.length; j++) {
        var spec = body.force[j];
        if (spec.layout) {
          var count = captureLayout(spec.pages);
          if (!count) out.errors.push('no portal layout found for ' + spec.pages.join(', '));
          else {
            out.forced.push(count + ' ' + spec.label + ' record(s)');
            out.forcedCount += count;
          }
          continue;
        }
        var forced = new GlideRecord(spec.table);
        forced.addEncodedQuery(spec.query);
        forced.query();
        if (!forced.hasNext()) {
          out.errors.push('cannot force-capture ' + spec.table + ' matching ' + spec.query);
          continue;
        }
        var n = 0;
        while (forced.next()) n += save(forced);
        out.forced.push(n + ' ' + spec.label + ' record(s)');
        out.forcedCount += n;
      }
    } finally {
      new GlideUpdateSet().set(previous);
    }
  }

  target.setValue('state', 'complete');
  target.update();

  var check = new GlideAggregate('sys_update_xml');
  check.addQuery('update_set', body.target_set);
  check.addAggregate('COUNT');
  check.query();
  out.total = check.next() ? parseInt(check.getAggregate('COUNT'), 10) : 0;

  return { result: out };
})(request, response);`;

async function ensureTargetSet() {
  const existing = await snGet(
    'sys_update_set',
    `sysparm_query=${encodeURIComponent(`name=${targetName}`)}&sysparm_fields=sys_id,state`
  );

  if (existing.length) {
    const set = existing[0];
    if (set.state === 'complete') await snPatch('sys_update_set', set.sys_id, { state: 'in progress' });
    return set.sys_id;
  }

  const created = await snPost('sys_update_set', {
    name: targetName,
    description:
      'Every CSAT Survey Portal change as a single set: portal, widgets, pages, tables, ' +
      'script includes, notifications, mail scripts and survey definitions. Rebuilt by ' +
      'scripts/consolidate-update-set.js from the sets captured during the build.',
    state: 'in progress',
  });
  console.log(`Created update set: ${targetName}`);
  return created.sys_id;
}

async function main() {
  announceTarget('Consolidate CSAT update sets');

  const sources = await findSourceSets();
  if (!sources.length) {
    console.log(`No update sets found starting with "${SOURCE_PREFIX}".`);
    return;
  }

  console.log(`\nSource sets (${sources.length}):`);
  sources.forEach((s) => console.log(`  ${String(s.state).padEnd(12)}${s.name}`));

  const entries = await loadEntries(sources);
  console.log(`\n${entries.length} captured change(s) across those sets.`);

  const history = new Map();
  entries.forEach((row) => {
    if (!history.has(row.name)) history.set(row.name, []);
    history.get(row.name).push(row);
  });

  const candidates = [];
  const skipped = {};
  for (const rows of history.values()) {
    const reason = skipReason(rows);
    if (reason) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      continue;
    }
    candidates.push(rows[rows.length - 1]);
  }

  console.log(`${history.size} distinct record(s) after collapsing repeats.`);
  Object.keys(skipped).forEach((reason) => console.log(`  skipping ${skipped[reason]} — ${reason}`));

  const live = await dropStale(candidates);
  const keep = await dropRetiredQuestions(live);
  console.log(`${keep.length} entry(s) to carry across.\n`);

  const byType = {};
  keep.forEach((row) => {
    byType[row.type] = byType[row.type] || { insert: 0, remove: 0 };
    if (row.action === 'INSERT_OR_UPDATE') byType[row.type].insert++;
    else byType[row.type].remove++;
  });
  Object.keys(byType)
    .sort()
    .forEach((type) => {
      const c = byType[type];
      console.log(`  ${String(c.insert).padStart(4)}${c.remove ? ` (+${c.remove} removal)` : ''}  ${type}`);
    });

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }

  const targetSysId = await ensureTargetSet();

  console.log(`\nCopying ${keep.length} entry(s)...`);
  const result = await withProbe(
    'consolidate_update_set',
    COPY_SCRIPT,
    (call) =>
      call({
        body: {
          target_set: targetSysId,
          fields: COPIED_FIELDS,
          force: FORCE_CAPTURE,
          ids: keep.map((row) => row.sys_id),
        },
      }),
    'POST'
  );

  if (result.error) throw new Error(result.error);
  if (result.cleared) console.log(`  cleared ${result.cleared} entry(s) from a previous run`);
  result.forced.forEach((f) => console.log(`  force-captured ${f}`));
  if (result.errors.length) {
    console.log(`  ${result.errors.length} problem(s):`);
    result.errors.forEach((e) => console.log(`      ${e}`));
  }
  console.log(`  ${result.written} copied, ${result.total} present in the set.`);

  const expected = keep.length + result.forcedCount;
  if (result.total !== expected)
    throw new Error(`expected ${expected} entries in the set but found ${result.total}`);

  if (retireSources) {
    for (const set of sources) await snPatch('sys_update_set', set.sys_id, { state: 'ignore' });
    console.log(`\nMarked ${sources.length} superseded set(s) as Ignore so only one is offered for export.`);
  }

  console.log(`\n"${targetName}" is complete with ${result.total} change(s).`);
  console.log('\nExport XML:');
  console.log(`  ${base}/export_update_set.do?sysparm_sys_id=${targetSysId}&sysparm_delete_when_done=false`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
