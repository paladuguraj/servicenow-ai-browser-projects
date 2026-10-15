#!/usr/bin/env node
/**
 * Manage the update set that captures CSAT deployment changes.
 *
 * ServiceNow records customizations against whichever update set is current
 * for the *session user*, including writes made through the REST API. So the
 * sequence is: create the set, make it current for the deploying user, run the
 * deploy scripts, then inspect or export.
 *
 * Creating a scoped application makes ServiceNow switch the current set to that
 * application's Default, so changes can still land elsewhere mid-deploy. Use
 * `adopt` afterwards to sweep them into the intended set.
 *
 * Usage:
 *   node scripts/update-set.js begin [name]   create + make current
 *   node scripts/update-set.js status         show current set and its contents
 *   node scripts/update-set.js adopt [name]   move this user's recent CSAT changes into the set
 *   node scripts/update-set.js complete       mark it Complete (ready to export)
 *   node scripts/update-set.js export         print the XML export URL
 */
const { base, headers, snGet, snPost, snPatch } = require('./lib/sn-client');

const DEFAULT_NAME = 'CSAT Survey Portal';
const PREFERENCE = 'sys_update_set';

async function currentUser() {
  const user = (await snGet(
    'sys_user',
    `sysparm_query=user_name=${encodeURIComponent(process.env.SN_USERNAME)}&sysparm_fields=sys_id,user_name,name`
  ))[0];
  if (!user) throw new Error(`Could not resolve user ${process.env.SN_USERNAME}`);
  return user;
}

async function getCurrentSet(userSysId) {
  const pref = (await snGet(
    'sys_user_preference',
    `sysparm_query=user=${userSysId}^name=${PREFERENCE}&sysparm_fields=sys_id,value`
  ))[0];
  if (!pref || !pref.value) return { pref: pref || null, set: null };

  const set = (await snGet(
    'sys_update_set',
    `sysparm_query=sys_id=${pref.value}&sysparm_fields=sys_id,name,state,application`
  ))[0];
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

async function begin(name) {
  const user = await currentUser();
  const setName = name || DEFAULT_NAME;

  const existing = await snGet(
    'sys_update_set',
    `sysparm_query=name=${encodeURIComponent(setName)}^state=in progress&sysparm_fields=sys_id,name,state`
  );

  let set;
  if (existing.length) {
    set = existing[0];
    console.log(`Reusing in-progress update set: ${set.name} (${set.sys_id})`);
  } else {
    set = await snPost('sys_update_set', {
      name: setName,
      description:
        'CSAT Survey Portal: tables, script includes, business rules, scheduled job, Service Portal (portal/page/widget/menu), notifications and REST API.',
      state: 'in progress',
      application: 'global',
    });
    console.log(`Created update set: ${setName} (${set.sys_id})`);
  }

  await setCurrent(user.sys_id, set.sys_id);
  console.log(`Set as current for ${user.user_name}`);
  console.log('\nRun the deploy now so its changes are captured:');
  console.log('  npm run deploy:csat');
  return set;
}

async function status() {
  const user = await currentUser();
  const { set } = await getCurrentSet(user.sys_id);

  if (!set) {
    console.log(`No current update set for ${user.user_name}. Run: node scripts/update-set.js begin`);
    return;
  }

  console.log(`Current update set: ${set.name} (${set.state})`);
  console.log(`  sys_id: ${set.sys_id}\n`);

  const updates = await snGet(
    'sys_update_xml',
    `sysparm_query=update_set=${set.sys_id}^ORDERBYtype&sysparm_fields=type,target_name&sysparm_limit=1000`
  );

  if (!updates.length) {
    console.log('  No captured changes yet.');
    return;
  }

  const byType = {};
  updates.forEach((u) => {
    byType[u.type] = byType[u.type] || [];
    byType[u.type].push(u.target_name);
  });

  console.log(`  ${updates.length} captured change(s):\n`);
  Object.keys(byType)
    .sort()
    .forEach((type) => {
      console.log(`  ${type} (${byType[type].length})`);
      byType[type].sort().forEach((n) => console.log(`      ${n}`));
    });
}

/**
 * Move update records this user created recently into the target set. Scoped to
 * CSAT artifacts so it cannot pull unrelated work out of a shared Default set.
 */
async function adopt(name) {
  const setName = name || DEFAULT_NAME;
  const hours = Number(process.env.ADOPT_HOURS || 6);

  const target = (await snGet(
    'sys_update_set',
    `sysparm_query=name=${encodeURIComponent(setName)}^state=in progress&sysparm_fields=sys_id,name`
  ))[0];
  if (!target) throw new Error(`No in-progress update set named "${setName}". Run "begin" first.`);

  const candidates = await snGet(
    'sys_update_xml',
    `sysparm_query=sys_created_by=${encodeURIComponent(process.env.SN_USERNAME)}` +
      `^sys_created_on>=javascript:gs.hoursAgoStart(${hours})` +
      `^update_set!=${target.sys_id}` +
      '&sysparm_fields=sys_id,type,target_name,name,update_set&sysparm_limit=1000'
  );

  const isCsat = (u) => {
    const haystack = `${u.target_name || ''} ${u.name || ''}`.toLowerCase();
    return (
      haystack.includes('csat') ||
      haystack.includes('u_x_csat') ||
      haystack.includes('csat_home') ||
      haystack.includes('csat.survey') ||
      haystack.includes('.csat.')
    );
  };

  const mine = candidates.filter(isCsat);
  const skipped = candidates.length - mine.length;

  if (!mine.length) {
    console.log(`Nothing to adopt (checked ${candidates.length} record(s) from the last ${hours}h).`);
    return;
  }

  console.log(`Moving ${mine.length} change(s) into "${target.name}"${skipped ? `; leaving ${skipped} unrelated record(s) alone` : ''}\n`);

  let moved = 0;
  const blocked = [];
  for (const u of mine) {
    try {
      await snPatch('sys_update_xml', u.sys_id, { update_set: target.sys_id });
      moved++;
    } catch (e) {
      // Scoped updates cannot be moved into a set owned by another application.
      blocked.push(`${u.type}: ${u.target_name}`);
    }
  }

  console.log(`Adopted ${moved}/${mine.length} change(s) into "${target.name}".`);

  if (blocked.length) {
    console.log(`\n${blocked.length} could not be moved (different application scope):`);
    blocked.forEach((b) => console.log(`  ${b}`));
    console.log('These stay in their own application update set and must be exported separately.');
  }

  const user = await currentUser();
  await setCurrent(user.sys_id, target.sys_id);
  console.log(`\n"${target.name}" is current again.`);
}

async function complete() {
  const user = await currentUser();
  const { set } = await getCurrentSet(user.sys_id);
  if (!set) throw new Error('No current update set to complete.');

  const count = (await snGet('sys_update_xml', `sysparm_query=update_set=${set.sys_id}&sysparm_fields=sys_id&sysparm_limit=1000`)).length;
  await snPatch('sys_update_set', set.sys_id, { state: 'complete' });

  console.log(`Marked "${set.name}" complete with ${count} change(s).`);
  console.log(`\nExport XML:\n  ${exportUrl(set.sys_id)}`);
  console.log(`\nOr in the UI: System Update Sets > Local Update Sets > ${set.name} > Export to XML`);
}

function exportUrl(sysId) {
  return `${base}/export_update_set.do?sysparm_sys_id=${sysId}&sysparm_delete_when_done=false`;
}

async function exportSet() {
  const user = await currentUser();
  const { set } = await getCurrentSet(user.sys_id);
  if (!set) throw new Error('No current update set.');
  console.log(`Update set: ${set.name} (${set.state})`);
  console.log(exportUrl(set.sys_id));
}

async function main() {
  const command = process.argv[2] || 'status';
  const handlers = {
    begin: () => begin(process.argv[3]),
    status,
    adopt: () => adopt(process.argv[3]),
    complete,
    export: exportSet,
  };
  const handler = handlers[command];
  if (!handler) {
    console.error(`Unknown command "${command}". Use: begin | status | complete | export`);
    process.exit(1);
  }
  console.log(`Instance: ${base}\n`);
  await handler();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
