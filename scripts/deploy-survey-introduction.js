#!/usr/bin/env node
/**
 * Sets the introduction shown on the survey landing page, before the
 * respondent presses Get Started.
 *
 * The portal centre-aligns this block, so the markup deliberately avoids
 * <ul>: list markers end up orphaned on the far left while the text stays
 * centred. Line breaks keep the pillar list aligned with everything else.
 */
const { snGet, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const SURVEYS = ['Complex Resolution Survey', 'Generic Quarterly Survey'];
const apply = process.argv.includes('--apply');

async function main() {
  announceTarget(apply ? 'Set survey introduction' : 'Set survey introduction (DRY RUN)');
  if (!apply) console.log('Dry run: pass --apply to write.\n');

  const introduction = readArtifact('surveys/csat-introduction.html');

  for (const name of SURVEYS) {
    const survey = (await snGet(
      'asmt_metric_type',
      `sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id,name,publish_state,not_show_intro_note`
    ))[0];

    if (!survey) {
      console.log(`${name}: not found`);
      continue;
    }

    if (!apply) {
      console.log(`${name} [${survey.publish_state}]: would set introduction (${introduction.length} chars)`);
      if (survey.not_show_intro_note === 'true')
        console.log('   note: "Do not show survey introduction notes" is ticked and would be cleared');
      continue;
    }

    await snPatch('asmt_metric_type', survey.sys_id, {
      introduction,
      // Otherwise the introduction is stored but never rendered.
      not_show_intro_note: false,
    });
    console.log(`${name} [${survey.publish_state}]: introduction set`);
  }

  if (apply) console.log('\nRe-publish each survey in Survey Designer so the change reaches new instances.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
