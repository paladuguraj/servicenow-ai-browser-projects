#!/usr/bin/env node
/**
 * Escalation Customer Justification + external case notes.
 *
 * 1. Renames "Escalation Justification" label to "Customer Justification"
 * 2. Appends customer justification to case Additional Comments on escalate
 * 3. Appends de-escalation justification to case Additional Comments on de-escalate
 * 4. Captures everything in an update set and exports XML when possible
 *
 * Usage:
 *   node scripts/deploy-escalation-customer-notes.js
 */
const fs = require('fs');
const path = require('path');
const { base, headers, snGet, snPost, snPatch, announceTarget } = require('./lib/sn-client');

const SET_NAME = 'Escalation Customer Notes v1.0';
const PREFERENCE = 'sys_update_set';
const TABLE = 'sn_customerservice_escalation';
const JUSTIFICATION_ELEMENT = 'escalation_justification';
const BR_NAME = 'Append escalation justifications to case comments';

const BR_SCRIPT = `/**
 * Append Customer Justification / De-escalation Justification to the source
 * case Additional Comments (customer-visible external notes).
 */
(function executeRule(current, previous /*null when async*/) {
	var sourceTable = current.getValue('source_table');
	var sourceId = current.getValue('source_record');
	if (!sourceTable || !sourceId) return;
	if (sourceTable != 'sn_customerservice_case' && sourceTable != 'csm_order_case') return;

	var caseGr = new GlideRecord(sourceTable);
	if (!caseGr.get(sourceId)) return;
	if (!caseGr.isValidField('comments')) return;

	var notes = [];

	// Escalate: surface Customer Justification when the escalation is first created
	// (or when justification is first filled). Avoid re-posting on later state changes.
	var postCustomerJustification =
		!current.escalation_justification.nil() &&
		(current.operation() == 'insert' ||
			(current.escalation_justification.changes() && previous.escalation_justification.nil()));
	if (postCustomerJustification) {
		notes.push(gs.getMessage('Customer Justification: {0}', [current.getValue('escalation_justification')]));
	}

	// De-escalate (Closed Escalated): surface De-escalation Justification
	if (current.state.changes() && current.state == 103 && !current.de_escalation_justification.nil()) {
		notes.push(gs.getMessage('De-escalation Justification: {0}', [current.getValue('de_escalation_justification')]));
	}

	if (!notes.length) return;

	caseGr.comments = notes.join('\\n');
	caseGr.update();
})(current, previous);
`;

async function currentUser() {
  const user = (
    await snGet(
      'sys_user',
      `sysparm_query=user_name=${encodeURIComponent(process.env.SN_USERNAME)}&sysparm_fields=sys_id,user_name,name`,
    )
  )[0];
  if (!user) throw new Error(`Could not resolve user ${process.env.SN_USERNAME}`);
  return user;
}

async function getCurrentSet(userSysId) {
  const pref = (
    await snGet(
      'sys_user_preference',
      `sysparm_query=user=${userSysId}^name=${PREFERENCE}&sysparm_fields=sys_id,value`,
    )
  )[0];
  if (!pref || !pref.value) return { pref: pref || null, set: null };
  const set = (
    await snGet(
      'sys_update_set',
      `sysparm_query=sys_id=${pref.value}&sysparm_fields=sys_id,name,state`,
    )
  )[0];
  return { pref, set };
}

async function setCurrent(userSysId, updateSetSysId) {
  const { pref } = await getCurrentSet(userSysId);
  if (pref) {
    await snPatch('sys_user_preference', pref.sys_id, { value: updateSetSysId });
    return;
  }
  await snPost('sys_user_preference', {
    user: userSysId,
    name: PREFERENCE,
    value: updateSetSysId,
    type: 'string',
  });
}

async function ensureUpdateSet(name) {
  const existing = await snGet(
    'sys_update_set',
    `sysparm_query=name=${encodeURIComponent(name)}^state=in progress&sysparm_fields=sys_id,name,state`,
  );
  if (existing.length) {
    console.log(`Reusing in-progress update set: ${existing[0].name} (${existing[0].sys_id})`);
    return existing[0];
  }

  // Also reopen a completed set with the same name if empty reuse is preferred? Prefer new version.
  const set = await snPost('sys_update_set', {
    name,
    description:
      'Rename Escalation Justification to Customer Justification; append customer and de-escalation justifications to case Additional Comments (external notes).',
    state: 'in progress',
    application: 'global',
  });
  console.log(`Created update set: ${name} (${set.sys_id})`);
  return set;
}

async function renameJustificationLabel() {
  console.log('\n1) Renaming Escalation Justification -> Customer Justification');

  const docs = await snGet(
    'sys_documentation',
    `sysparm_query=name=${TABLE}^element=${JUSTIFICATION_ELEMENT}^language=en&sysparm_fields=sys_id,label,plural`,
  );
  if (!docs.length) throw new Error('sys_documentation for escalation_justification not found');
  await snPatch('sys_documentation', docs[0].sys_id, {
    label: 'Customer Justification',
    plural: 'Customer Justifications',
  });
  console.log(`  updated sys_documentation ${docs[0].sys_id}`);

  const dict = await snGet(
    'sys_dictionary',
    `sysparm_query=name=${TABLE}^element=${JUSTIFICATION_ELEMENT}&sysparm_fields=sys_id,column_label`,
  );
  if (dict.length) {
    await snPatch('sys_dictionary', dict[0].sys_id, { column_label: 'Customer Justification' });
    console.log(`  updated sys_dictionary ${dict[0].sys_id}`);
  }
}

async function ensureBusinessRule() {
  console.log('\n2) Ensuring business rule that appends justifications to case comments');

  const existing = await snGet(
    'sys_script',
    `sysparm_query=name=${encodeURIComponent(BR_NAME)}^collection=${TABLE}&sysparm_fields=sys_id,name,active`,
  );

  const payload = {
    name: BR_NAME,
    collection: TABLE,
    active: true,
    when: 'after',
    order: 200,
    action_insert: true,
    action_update: true,
    action_delete: false,
    action_query: false,
    filter_condition: '',
    script: BR_SCRIPT,
    description:
      'Appends Customer Justification on escalate and De-escalation Justification on de-escalate to the source case Additional Comments so customers can see them.',
    sys_domain: 'global',
  };

  if (existing.length) {
    await snPatch('sys_script', existing[0].sys_id, payload);
    console.log(`  updated business rule ${existing[0].sys_id}`);
    return existing[0];
  }

  const created = await snPost('sys_script', payload);
  console.log(`  created business rule ${created.sys_id}`);
  return created;
}

/**
 * Also try to enhance EscalationUtils.appendNote for environments where the
 * scoped script can be customized. Failures are non-fatal; the BR covers it.
 */
async function tryPatchEscalationUtils() {
  console.log('\n3) Attempting EscalationUtils customization (optional)');
  const utils = (
    await snGet(
      'sys_script_include',
      `sysparm_query=api_name=sn_customerservice.EscalationUtils&sysparm_fields=sys_id,script,sys_policy`,
    )
  )[0];
  if (!utils) {
    console.log('  EscalationUtils not found; skipping');
    return;
  }

  let script = utils.script;
  if (script.includes('Customer Justification:') && script.includes('De-escalation Justification:')) {
    console.log('  EscalationUtils already contains customer-notes append logic');
    return;
  }

  // Inject helper + call sites for comments (external notes)
  if (!script.includes('appendCustomerVisibleNote')) {
    const helper = `
	/**
	 * Write to Additional Comments on the source case (customer-visible).
	 */
	appendCustomerVisibleNote: function(gr_source, message) {
		if (!gr_source || !message) return;
		if (!gr_source.isValidField('comments')) return;
		gr_source.comments = message;
	},
`;
    script = script.replace(
      /\n\ttype: 'EscalationUtils'/,
      `${helper}\n\ttype: 'EscalationUtils'`,
    );
  }

  // On escalate requested (state 100): append customer justification
  if (!script.includes("Customer Justification:")) {
    script = script.replace(
      `if(gr_source.isValidField('work_notes')){
					gr_source.work_notes = gs.getMessage('{0} has requested to escalate this {1}. {2} created.', [gs.getUserDisplayName(), gr_source.getClassDisplayValue(), escalation.getDisplayValue('number')]);
					gr_source.update();
				}`,
      `if(gr_source.isValidField('work_notes')){
					gr_source.work_notes = gs.getMessage('{0} has requested to escalate this {1}. {2} created.', [gs.getUserDisplayName(), gr_source.getClassDisplayValue(), escalation.getDisplayValue('number')]);
				}
				if(!escalation.escalation_justification.nil()) {
					this.appendCustomerVisibleNote(gr_source, gs.getMessage('Customer Justification: {0}', [escalation.getValue('escalation_justification')]));
				}
				gr_source.update();`,
    );
  }

  // On closed/de-escalated (state 103)
  if (!script.includes('De-escalation Justification:')) {
    script = script.replace(
      `} else if(escalation.state == 103) { // Closed Escalated
				if(gr_source.isValidField('work_notes')){
					gr_source.work_notes = gs.getMessage("Escalation {0} has been closed.", [escalation.getDisplayValue('number')]);
					gr_source.update();
				}`,
      `} else if(escalation.state == 103) { // Closed Escalated
				if(gr_source.isValidField('work_notes')){
					gr_source.work_notes = gs.getMessage("Escalation {0} has been closed.", [escalation.getDisplayValue('number')]);
				}
				if(!escalation.de_escalation_justification.nil()) {
					this.appendCustomerVisibleNote(gr_source, gs.getMessage('De-escalation Justification: {0}', [escalation.getValue('de_escalation_justification')]));
				}
				gr_source.update();`,
    );
  }

  try {
    await snPatch('sys_script_include', utils.sys_id, { script });
    console.log('  patched EscalationUtils');
  } catch (err) {
    console.log(`  could not patch EscalationUtils (${err.message}); business rule remains the source of truth`);
  }
}

async function listSetContents(setSysId) {
  return snGet(
    'sys_update_xml',
    `sysparm_query=update_set=${setSysId}^ORDERBYtype^ORDERBYname&sysparm_fields=sys_id,type,name,target_name,action&sysparm_limit=1000`,
  );
}

function exportUrl(sysId) {
  return `${base}/export_update_set.do?sysparm_sys_id=${sysId}&sysparm_delete_when_done=false`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Flatten ServiceNow reference objects from Table API responses. */
function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'object') return value.value || value.display_value || '';
  return value;
}

async function buildXmlFromRecords(set) {
  const updates = await snGet(
    'sys_update_xml',
    `sysparm_query=update_set=${set.sys_id}^ORDERBYsys_recorded_at&sysparm_fields=sys_id,name,type,target_name,action,payload,application,category,table,view,payload_hash,replace_on_upgrade,sys_created_on,sys_created_by,sys_mod_count,update_domain,sys_recorded_at&sysparm_limit=1000`,
  );

  const remoteSysId = set.sys_id;
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
  xml += `<description>${escapeXml(set.description || '')}</description>\n`;
  xml += `<name>${escapeXml(set.name)}</name>\n`;
  xml += `<origin_sys_id>${remoteSysId}</origin_sys_id>\n`;
  xml += `<remote_base_update_set/>\n`;
  xml += `<remote_parent_id/>\n`;
  xml += `<remote_sys_id>${remoteSysId}</remote_sys_id>\n`;
  xml += `<state>loaded</state>\n`;
  xml += `<sys_created_by>${escapeXml(process.env.SN_USERNAME)}</sys_created_by>\n`;
  xml += `<sys_created_on>${escapeXml(set.sys_created_on || now)}</sys_created_on>\n`;
  xml += `<sys_id>${remoteSysId}</sys_id>\n`;
  xml += `<sys_mod_count>0</sys_mod_count>\n`;
  xml += `<sys_updated_by>${escapeXml(process.env.SN_USERNAME)}</sys_updated_by>\n`;
  xml += `<sys_updated_on>${escapeXml(now)}</sys_updated_on>\n`;
  xml += `<update_set hid="${remoteSysId}"/>\n`;
  xml += `<update_source/>\n`;
  xml += `</sys_remote_update_set>\n`;

  for (const u of updates) {
    const domain = scalar(u.update_domain) || 'global';
    xml += `<sys_update_xml action="INSERT_OR_UPDATE">\n`;
    xml += `<action>${escapeXml(u.action || 'INSERT_OR_UPDATE')}</action>\n`;
    xml += `<application display_value="Global">global</application>\n`;
    xml += `<category>${escapeXml(u.category || 'customer')}</category>\n`;
    xml += `<comments/>\n`;
    xml += `<name>${escapeXml(u.name)}</name>\n`;
    xml += `<payload><![CDATA[${u.payload || ''}]]></payload>\n`;
    xml += `<payload_hash>${escapeXml(u.payload_hash || '')}</payload_hash>\n`;
    xml += `<remote_update_set display_value="${escapeXml(set.name)}">${remoteSysId}</remote_update_set>\n`;
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
    xml += `<update_domain>${escapeXml(domain)}</update_domain>\n`;
    xml += `<update_guid/>\n`;
    xml += `<update_guid_history/>\n`;
    xml += `<update_set display_value="${escapeXml(set.name)}">${remoteSysId}</update_set>\n`;
    xml += `<view>${escapeXml(scalar(u.view))}</view>\n`;
    xml += `</sys_update_xml>\n`;
  }

  xml += `</unload>\n`;
  return { xml, count: updates.length };
}

async function main() {
  announceTarget('Deploying escalation customer-notes changes');

  const user = await currentUser();
  const set = await ensureUpdateSet(SET_NAME);
  await setCurrent(user.sys_id, set.sys_id);
  console.log(`Update set current for ${user.user_name}: ${set.name} (${set.sys_id})`);

  await renameJustificationLabel();
  await ensureBusinessRule();
  await tryPatchEscalationUtils();

  const contents = await listSetContents(set.sys_id);
  console.log(`\nUpdate set contents (${contents.length}):`);
  contents.forEach((u) => console.log(`  ${u.type}: ${u.target_name || u.name}`));

  await snPatch('sys_update_set', set.sys_id, { state: 'complete' });
  const completed = (
    await snGet(
      'sys_update_set',
      `sysparm_query=sys_id=${set.sys_id}&sysparm_fields=sys_id,name,state,description,sys_created_on`,
    )
  )[0];
  console.log(`\nMarked "${completed.name}" complete.`);

  const { xml, count } = await buildXmlFromRecords(completed);
  const outPath = path.join(__dirname, '..', 'updatesets', 'Escalation_Customer_Notes_v1.0.xml');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml);
  console.log(`\nWrote update set XML (${count} customer updates, ${Buffer.byteLength(xml)} bytes):\n  ${outPath}`);
  console.log(`\nUI export URL:\n  ${exportUrl(set.sys_id)}`);
  console.log('\nOn target: Retrieved Update Sets > Import Update Set from XML > Preview > Commit');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
