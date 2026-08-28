#!/usr/bin/env node
/**
 * Sends respondents straight to the questions instead of a landing page.
 *
 * The stock survey widget opens on an introduction screen with a Get Started
 * button. That screen is not the widget's only mode: it is skipped when the
 * survey's own "Do not show survey introduction notes" flag is set, which the
 * widget reads per survey. Setting the flag here therefore changes only these
 * surveys and leaves every other survey on the instance untouched, so there is
 * no need to clone the widget.
 *
 * The introduction text is kept up to date even though it is not currently
 * rendered, so clearing the flag restores a correct landing page rather than a
 * stale one.
 */
const { snGet, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const SURVEYS = ['Complex Resolution Survey', 'Generic Schedule Survey'];
const apply = process.argv.includes('--apply');

async function main() {
  announceTarget(apply ? 'Configure survey landing page' : 'Configure survey landing page (DRY RUN)');
  if (!apply) console.log('Dry run: pass --apply to write.\n');

  const introduction = readArtifact('surveys/csat-introduction.html');

  for (const name of SURVEYS) {
    const survey = (await snGet(
      'asmt_metric_type',
      `sysparm_query=${encodeURIComponent(`name=${name}`)}&sysparm_fields=sys_id,name,publish_state,not_show_intro_note,introduction`
    ))[0];

    if (!survey) {
      console.log(`${name}: not found`);
      continue;
    }

    const patch = {};
    if (survey.not_show_intro_note !== 'true') patch.not_show_intro_note = true;
    if ((survey.introduction || '').trim() !== introduction.trim()) patch.introduction = introduction;

    if (!Object.keys(patch).length) {
      console.log(`${name} [${survey.publish_state}]: already opens on the first question`);
      continue;
    }

    const summary = [
      patch.not_show_intro_note ? 'skip the Get Started page' : null,
      patch.introduction ? 'refresh the stored introduction' : null,
    ]
      .filter(Boolean)
      .join(' and ');

    if (!apply) {
      console.log(`${name} [${survey.publish_state}]: would ${summary}`);
      continue;
    }

    await snPatch('asmt_metric_type', survey.sys_id, patch);
    console.log(`${name} [${survey.publish_state}]: ${summary}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
