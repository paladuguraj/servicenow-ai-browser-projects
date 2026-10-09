#!/usr/bin/env node
/**
 * Reverse the display order of the 1-5 scale answer choices on both CSAT
 * surveys so "Very Satisfied" appears at the top and "Very Dissatisfied" at
 * the bottom. The score values are preserved.
 */
const { snGet, snPatch, announceTarget } = require('./lib/sn-client');

const SURVEYS = ['Managed Network Services Survey - Manual', 'Managed Network Services Survey - Automatic'];
const apply = process.argv.includes('--apply');

async function main() {
  announceTarget(apply ? 'Reverse CSAT answer order' : 'Reverse CSAT answer order (DRY RUN)');
  if (!apply) console.log('Dry run: pass --apply to write.\n');

  for (const surveyName of SURVEYS) {
    const survey = (await snGet(
      'asmt_metric_type',
      `sysparm_query=${encodeURIComponent(`name=${surveyName}`)}&sysparm_fields=sys_id,name`
    ))[0];

    if (!survey) {
      console.log(`${surveyName}: not found`);
      continue;
    }

    const metrics = await snGet(
      'asmt_metric',
      `sysparm_query=metric_type=${survey.sys_id}^datatype=scale&sysparm_fields=sys_id,name`
    );

    for (const metric of metrics) {
      const defs = await snGet(
        'asmt_metric_definition',
        `sysparm_query=metric=${metric.sys_id}^active=true&sysparm_fields=sys_id,display,value,order&sysparm_orderby=order&sysparm_limit=20`
      );

      if (defs.length < 2) {
        console.log(`${surveyName} > ${metric.name}: ${defs.length} answer(s), skipping`);
        continue;
      }

      // Sort by current order ascending
      const sorted = defs.slice().sort((a, b) => parseInt(a.order, 10) - parseInt(b.order, 10));
      const originalOrder = sorted.map((d) => `${d.display}=${d.value}`).join(', ');

      // Reverse the order values while keeping the definitions in the same display order
      const reversed = sorted.slice().reverse();
      const newOrder = reversed.map((d) => `${d.display}=${d.value}`).join(', ');

      if (originalOrder === newOrder) {
        console.log(`${surveyName} > ${metric.name}: already reversed`);
        continue;
      }

      console.log(`${surveyName} > ${metric.name}:`);
      console.log(`  before: ${originalOrder}`);
      console.log(`  after:  ${newOrder}`);

      if (!apply) continue;

      for (let i = 0; i < reversed.length; i++) {
        const def = reversed[i];
        const newOrderValue = (i + 1) * 100;
        await snPatch('asmt_metric_definition', def.sys_id, { order: newOrderValue });
      }
    }
  }

  if (!apply) console.log('\nPass --apply to commit these changes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
