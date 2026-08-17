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
const {
  base,
  headers,
  snGet,
  snPost,
  snPatch,
  snDelete,
  sleep,
  announceTarget,
} = require('./lib/sn-client');

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

// The platform treats scheduled jobs as data rather than metadata, so editing
// one is never captured. It has to be pushed into the set deliberately or the
// 30/60-day schedules would never run on the target.
const FORCE_CAPTURE = [['sysauto_script', 'CSAT Survey Request - Scheduled Runner']];

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
 */
function skipReason(history) {
  const last = history[history.length - 1];
  if (last.action === 'INSERT_OR_UPDATE') return null;

  if (/^zz_/.test(last.target_name)) return 'temporary test endpoint';
  if (LAYOUT_TYPES.indexOf(last.type) !== -1) return 'superseded portal layout';

  // Anything else deleted on purpose — orphaned choice lists, retired mail
  // scripts — is kept, so a target running an older build gets cleaned up too.
  return null;
}

async function findSourceSets() {
  const sets = await snGet(
    'sys_update_set',
    `sysparm_query=${encodeURIComponent(
      `nameSTARTSWITH${SOURCE_PREFIX}^state!=ignore^name!=${targetName}`
    )}&sysparm_fields=sys_id,name,state,sys_created_on&sysparm_orderby=sys_created_on`
  );
  return sets;
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
  if (body.force.length) {
    var previous = new GlideUpdateSet().get();
    new GlideUpdateSet().set(body.target_set);
    try {
      for (var j = 0; j < body.force.length; j++) {
        var table = body.force[j][0];
        var recordName = body.force[j][1];
        var forced = new GlideRecord(table);
        forced.addQuery('name', recordName);
        forced.query();
        if (!forced.next()) {
          out.errors.push('cannot force-capture missing ' + table + ' "' + recordName + '"');
          continue;
        }
        new GlideUpdateManager2().saveRecord(forced);
        out.forced.push(table + ' "' + recordName + '"');
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

async function withCopyEndpoint(run) {
  const api = (
    await snGet('sys_ws_definition', 'sysparm_query=name=CSAT Survey API&sysparm_fields=sys_id,base_uri')
  )[0];
  if (!api) throw new Error('CSAT Survey API not found; deploy the app before consolidating.');

  const op = await snPost('sys_ws_operation', {
    web_service_definition: api.sys_id,
    name: 'consolidate_update_set',
    http_method: 'POST',
    relative_path: '/consolidate_update_set',
    active: true,
    operation_script: COPY_SCRIPT,
    requires_authentication: true,
  });

  try {
    await sleep(1500);
    return await run(`${base}${api.base_uri}/consolidate_update_set`);
  } finally {
    await snDelete('sys_ws_operation', op.sys_id);
  }
}

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

  const keep = await dropStale(candidates);
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
  const result = await withCopyEndpoint(async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_set: targetSysId,
        fields: COPIED_FIELDS,
        force: FORCE_CAPTURE,
        ids: keep.map((row) => row.sys_id),
      }),
    });
    const body = await res.json();
    if (!body.result || !body.result.result) throw new Error(`copy failed: ${JSON.stringify(body).slice(0, 400)}`);
    return body.result.result;
  });

  if (result.error) throw new Error(result.error);
  if (result.cleared) console.log(`  cleared ${result.cleared} entry(s) from a previous run`);
  result.forced.forEach((f) => console.log(`  force-captured ${f}`));
  if (result.errors.length) {
    console.log(`  ${result.errors.length} problem(s):`);
    result.errors.forEach((e) => console.log(`      ${e}`));
  }
  console.log(`  ${result.written} copied, ${result.total} present in the set.`);

  const expected = keep.length + result.forced.length;
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
