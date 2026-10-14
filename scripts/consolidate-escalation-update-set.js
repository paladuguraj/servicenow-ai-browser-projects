#!/usr/bin/env node
/**
 * Builds one portable XML update set with the final state of all escalation
 * enhancements. Reads completed source sets via REST and writes a single
 * importable XML (does not require insert ACL on sys_update_xml).
 *
 * Sources (latest payload wins when the same artifact appears more than once):
 *   1. Escalation Form Fields v1.0
 *   2. Escalation Customer Notes v1.0
 *   3. Escalation Customer Notes Dedup v1.1
 *
 * Usage:
 *   node scripts/consolidate-escalation-update-set.js
 *   node scripts/consolidate-escalation-update-set.js --include-require-update
 */
const fs = require('fs');
const path = require('path');
const { base, snGet, snPost, snPatch, announceTarget } = require('./lib/sn-client');

const TARGET_NAME = 'Escalation Enhancements - ALL CHANGES v1.0';
const SOURCE_SETS = [
  { sys_id: '01fd79d82ba34350efa0f95ed891bfb5', label: 'Escalation Form Fields v1.0' },
  { sys_id: '1c492a822b730b50efa0f95ed891bfc9', label: 'Escalation Customer Notes v1.0' },
  { sys_id: '9f4db39f3bbf0310c4e908ac24e45a2e', label: 'Escalation Customer Notes Dedup v1.1' },
];
const REQUIRE_UPDATE_SET = {
  sys_id: 'b1a466ff3b278b10c4e908ac24e45a19',
  label: 'Exclude Escalation from Require Update BR',
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'object') return value.value || value.display_value || '';
  return value;
}

function chronological(a, b) {
  const at = a.sys_recorded_at || a.sys_created_on || '';
  const bt = b.sys_recorded_at || b.sys_created_on || '';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.sys_created_on || '') < (b.sys_created_on || '') ? -1 : 1;
}

/** Stable synthetic sys_id for the consolidated remote set (32 hex). */
function consolidatedRemoteSysId() {
  // Deterministic id so re-exports don't invent a new remote set identity each run.
  return 'e5ca11a710000000e5ca11a7e5ca1101';
}

async function loadSourceUpdates(includeRequireUpdate) {
  const sources = [...SOURCE_SETS];
  if (includeRequireUpdate) sources.push(REQUIRE_UPDATE_SET);

  const byName = new Map();
  for (const source of sources) {
    const rows = await snGet(
      'sys_update_xml',
      `sysparm_query=update_set=${source.sys_id}^ORDERBYsys_recorded_at` +
        '&sysparm_fields=sys_id,name,type,target_name,action,payload,payload_hash,category,table,application,replace_on_upgrade,view,comments,update_domain,sys_created_on,sys_created_by,sys_mod_count,sys_recorded_at&sysparm_limit=1000',
    );
    console.log(`  ${source.label}: ${rows.length} change(s)`);
    for (const row of rows) {
      const prev = byName.get(row.name);
      if (!prev || chronological(prev, row) < 0) byName.set(row.name, { ...row, _source: source.label });
    }
  }
  return [...byName.values()].sort(chronological);
}

function buildXml(rows, description) {
  const remoteSysId = consolidatedRemoteSysId();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<unload unload_date="${escapeXml(now)}">\n`;
  xml += `<sys_remote_update_set action="INSERT_OR_UPDATE">\n`;
  xml += `<application display_value="Global">global</application>\n`;
  xml += `<application_name>Global</application_name>\n`;
  xml += `<application_scope>global</application_scope>\n`;
  xml += `<application_version/>\n`;
  xml += `<collisions/>\n`;
  xml += `<commit_date/>\n`;
  xml += `<deleted/>\n`;
  xml += `<description>${escapeXml(description)}</description>\n`;
  xml += `<name>${escapeXml(TARGET_NAME)}</name>\n`;
  xml += `<origin_sys_id>${remoteSysId}</origin_sys_id>\n`;
  xml += `<remote_base_update_set/>\n`;
  xml += `<remote_parent_id/>\n`;
  xml += `<remote_sys_id>${remoteSysId}</remote_sys_id>\n`;
  xml += `<state>loaded</state>\n`;
  xml += `<sys_created_by>${escapeXml(process.env.SN_USERNAME)}</sys_created_by>\n`;
  xml += `<sys_created_on>${escapeXml(now)}</sys_created_on>\n`;
  xml += `<sys_id>${remoteSysId}</sys_id>\n`;
  xml += `<sys_mod_count>0</sys_mod_count>\n`;
  xml += `<sys_updated_by>${escapeXml(process.env.SN_USERNAME)}</sys_updated_by>\n`;
  xml += `<sys_updated_on>${escapeXml(now)}</sys_updated_on>\n`;
  xml += `<update_set hid="${remoteSysId}"/>\n`;
  xml += `<update_source/>\n`;
  xml += `</sys_remote_update_set>\n`;

  for (const u of rows) {
    // Keep original customer update sys_ids so commit is idempotent across re-imports.
    xml += `<sys_update_xml action="INSERT_OR_UPDATE">\n`;
    xml += `<action>${escapeXml(u.action || 'INSERT_OR_UPDATE')}</action>\n`;
    xml += `<application display_value="Global">global</application>\n`;
    xml += `<category>${escapeXml(u.category || 'customer')}</category>\n`;
    xml += `<comments/>\n`;
    xml += `<name>${escapeXml(u.name)}</name>\n`;
    xml += `<payload><![CDATA[${u.payload || ''}]]></payload>\n`;
    xml += `<payload_hash>${escapeXml(u.payload_hash || '')}</payload_hash>\n`;
    xml += `<remote_update_set display_value="${escapeXml(TARGET_NAME)}">${remoteSysId}</remote_update_set>\n`;
    xml += `<replace_on_upgrade>${escapeXml(u.replace_on_upgrade || 'false')}</replace_on_upgrade>\n`;
    xml += `<sys_created_by>${escapeXml(u.sys_created_by || process.env.SN_USERNAME)}</sys_created_by>\n`;
    xml += `<sys_created_on>${escapeXml(u.sys_created_on || now)}</sys_created_on>\n`;
    xml += `<sys_id>${escapeXml(u.sys_id)}</sys_id>\n`;
    xml += `<sys_mod_count>${escapeXml(u.sys_mod_count || '0')}</sys_mod_count>\n`;
    xml += `<sys_recorded_at>${escapeXml(u.sys_recorded_at || '')}</sys_recorded_at>\n`;
    xml += `<sys_updated_by>${escapeXml(process.env.SN_USERNAME)}</sys_updated_by>\n`;
    xml += `<sys_updated_on>${escapeXml(now)}</sys_updated_on>\n`;
    xml += `<table>${escapeXml(u.table || '')}</table>\n`;
    xml += `<target_name>${escapeXml(u.target_name || '')}</target_name>\n`;
    xml += `<type>${escapeXml(u.type || '')}</type>\n`;
    xml += `<update_domain>${escapeXml(scalar(u.update_domain) || 'global')}</update_domain>\n`;
    xml += `<update_guid/>\n`;
    xml += `<update_guid_history/>\n`;
    xml += `<update_set display_value="${escapeXml(TARGET_NAME)}">${remoteSysId}</update_set>\n`;
    xml += `<view>${escapeXml(scalar(u.view))}</view>\n`;
    xml += `</sys_update_xml>\n`;
  }

  xml += `</unload>\n`;
  return { xml, remoteSysId };
}

async function registerLocalCompleteSet(description, count) {
  // Best-effort bookkeeping on Dev so Local Update Sets shows the consolidated name.
  // If a prior incomplete consolidate left an empty in-progress set, complete/reuse it.
  let set = (
    await snGet(
      'sys_update_set',
      `sysparm_query=name=${encodeURIComponent(TARGET_NAME)}^state=in progress&sysparm_fields=sys_id,name,state`,
    )
  )[0];

  if (!set) {
    set = (
      await snGet(
        'sys_update_set',
        `sysparm_query=name=${encodeURIComponent(TARGET_NAME)}^state=complete&sysparm_fields=sys_id,name,state&sysparm_order_by_desc=sys_created_on&sysparm_limit=1`,
      )
    )[0];
  }

  if (!set) {
    try {
      set = await snPost('sys_update_set', {
        name: TARGET_NAME,
        description: `${description} (${count} changes; XML exported from repo).`,
        state: 'complete',
        application: 'global',
      });
    } catch (err) {
      console.log(`Note: could not register local update set (${err.message})`);
      return null;
    }
  } else if (set.state !== 'complete') {
    await snPatch('sys_update_set', set.sys_id, {
      state: 'complete',
      description: `${description} (${count} changes; XML exported from repo).`,
    });
  }

  return set;
}

async function main() {
  const includeRequireUpdate = process.argv.includes('--include-require-update');
  announceTarget('Consolidating escalation enhancement update sets');

  console.log('Loading source sets (latest payload wins per artifact)...');
  const rows = await loadSourceUpdates(includeRequireUpdate);
  console.log(`\nUnique artifacts in consolidated set: ${rows.length}\n`);

  const byType = {};
  for (const row of rows) {
    byType[row.type] = byType[row.type] || [];
    byType[row.type].push(`${row.target_name || row.name}  [${row._source}]`);
  }
  Object.keys(byType)
    .sort()
    .forEach((type) => {
      console.log(`${type} (${byType[type].length})`);
      byType[type].sort().forEach((line) => console.log(`  ${line}`));
    });

  const description =
    'Single migration set for escalation enhancements: 8 Request Escalation form fields (excl. Escalation Source), ' +
    'Customer Justification label rename, and append customer/de-escalation justifications to case Additional Comments ' +
    '(with duplicate-note guard).';

  const { xml, remoteSysId } = buildXml(rows, description);
  const outPath = path.join(__dirname, '..', 'updatesets', 'Escalation_Enhancements_ALL_CHANGES_v1.0.xml');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml);

  const local = await registerLocalCompleteSet(description, rows.length);

  console.log(`\nWrote consolidated XML (${rows.length} changes, ${Buffer.byteLength(xml)} bytes):`);
  console.log(`  ${outPath}`);
  if (local) console.log(`\nLocal Dev set: ${TARGET_NAME} (${local.sys_id}) — bookkeeping only; import the XML on the target.`);
  console.log(`\nRemote set id in XML: ${remoteSysId}`);
  console.log('\nOn target: Retrieved Update Sets > Import Update Set from XML > Preview > Commit');
  if (!includeRequireUpdate) {
    console.log(
      '\nNot included (separate): Exclude Escalation from Require Update BR. Pass --include-require-update to add it.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
