#!/usr/bin/env node
/**
 * Load survey questions into asmt_metric from a definition file.
 *
 * Usage:
 *   node scripts/load-survey-questions.js survey-questions.json          (dry run)
 *   node scripts/load-survey-questions.js survey-questions.json --apply
 *
 * The definition is keyed by survey name so it can be re-run safely: a question
 * is matched on its text within the category and updated rather than duplicated.
 * Placeholder questions left over from creating the survey are deactivated
 * unless they appear in the definition.
 */
const fs = require('fs');
const path = require('path');
const { snGet, snPost, snPatch, announceTarget } = require('./lib/sn-client');

const apply = process.argv.includes('--apply');
const sourceArg = process.argv.find((a) => a.endsWith('.json') && !a.startsWith('--'));

const VALID_DATATYPES = [
  'attachment', 'checkbox', 'choice', 'custom', 'date', 'datetime', 'duration',
  'imagescale', 'scale', 'multiplecheckbox', 'long', 'numericscale', 'percentage',
  'ranking', 'rating', 'reference', 'string', 'template', 'boolean',
];

function loadDefinition() {
  if (!sourceArg) {
    console.error('Provide a definition file, e.g. node scripts/load-survey-questions.js survey-questions.json');
    process.exit(1);
  }
  const file = path.resolve(process.cwd(), sourceArg);
  if (!fs.existsSync(file)) {
    console.error(`Not found: ${file}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validate(definition) {
  const problems = [];
  definition.forEach((survey, si) => {
    if (!survey.survey) problems.push(`survey[${si}] has no "survey" name`);
    (survey.questions || []).forEach((q, qi) => {
      const where = `${survey.survey} q${qi + 1}`;
      if (!q.question) problems.push(`${where}: missing "question" text`);
      if (!q.datatype) problems.push(`${where}: missing "datatype"`);
      else if (VALID_DATATYPES.indexOf(q.datatype) === -1)
        problems.push(`${where}: datatype "${q.datatype}" is not one of ${VALID_DATATYPES.join(', ')}`);
      if (q.datatype === 'numericscale' && (q.min === undefined || q.max === undefined))
        problems.push(`${where}: numericscale needs min and max`);
      if (q.datatype === 'choice' && !(q.choices || []).length)
        problems.push(`${where}: choice needs a "choices" array`);
      if (q.datatype === 'scale' && !(q.choices || []).length)
        problems.push(`${where}: a Likert scale needs a "choices" array of labelled points`);
    });
  });
  return problems;
}

async function resolveSurvey(name) {
  const survey = (await snGet(
    'asmt_metric_type',
    `sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id,name,publish_state`
  ))[0];
  if (!survey) throw new Error(`Survey "${name}" not found`);
  return survey;
}

async function resolveCategory(survey, categoryName) {
  const name = categoryName || survey.name;
  const existing = await snGet(
    'asmt_metric_category',
    `sysparm_query=metric_type=${survey.sys_id}^name=${encodeURIComponent(name)}&sysparm_fields=sys_id,name`
  );
  if (existing.length) return existing[0];

  if (!apply) return { sys_id: '(new)', name };
  const created = await snPost('asmt_metric_category', {
    metric_type: survey.sys_id,
    name,
    order: 100,
  });
  console.log(`    + category "${name}"`);
  return created;
}

async function upsertQuestion(survey, category, q, order) {
  const existing = await snGet(
    'asmt_metric',
    `sysparm_query=category=${category.sys_id}^question=${encodeURIComponent(q.question)}&sysparm_fields=sys_id,question`
  );

  const payload = {
    metric_type: survey.sys_id,
    category: category.sys_id,
    name: q.name || q.question.slice(0, 80),
    question: q.question,
    description: q.explanation || q.description || '',
    datatype: q.datatype,
    order: q.order || order,
    mandatory: q.mandatory === true,
    active: true,
    method: 'assessment',
    cond_question: 'always',
  };

  if (q.min !== undefined) payload.min = q.min;
  if (q.max !== undefined) payload.max = q.max;
  if (q.scale) payload.scale = q.scale;
  if (q.datatype === 'scale' && (q.choices || []).length) {
    payload.min = q.min !== undefined ? q.min : 1;
    payload.max = q.max !== undefined ? q.max : q.choices.length;
  }

  if (!apply) {
    console.log(`    ${existing.length ? 'update' : 'create'}  [${q.datatype}] ${q.question}`);
    if (payload.description) console.log(`             explanation: ${payload.description}`);
    return existing[0] ? existing[0].sys_id : null;
  }

  let sysId;
  if (existing.length) {
    await snPatch('asmt_metric', existing[0].sys_id, payload);
    sysId = existing[0].sys_id;
    console.log(`    updated  [${q.datatype}] ${q.question}`);
  } else {
    const created = await snPost('asmt_metric', payload);
    sysId = created.sys_id;
    console.log(`    created  [${q.datatype}] ${q.question}`);
  }

  if ((q.choices || []).length) await syncChoices(sysId, q.choices);
  return sysId;
}

/**
 * Scale points and choice options are both asmt_metric_definition rows. The
 * visible label lives in "display"; "value" is what gets scored.
 */
async function syncChoices(metricSysId, choices) {
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    const display = typeof choice === 'string' ? choice : choice.display || choice.text;
    const value = typeof choice === 'string' ? i + 1 : choice.value !== undefined ? choice.value : i + 1;

    const existing = await snGet(
      'asmt_metric_definition',
      `sysparm_query=metric=${metricSysId}^value=${encodeURIComponent(value)}&sysparm_fields=sys_id`
    );
    const payload = { metric: metricSysId, display, value, order: (i + 1) * 100 };
    if (existing.length) await snPatch('asmt_metric_definition', existing[0].sys_id, payload);
    else await snPost('asmt_metric_definition', payload);
  }
  console.log(`             ${choices.length} option(s): ${choices.map((c) => (typeof c === 'string' ? c : c.display || c.text)).join(' / ')}`);
}

/**
 * Surveys are created with a "New String" placeholder. Leaving it active would
 * put an unanswerable field in front of the recipient.
 */
async function retirePlaceholders(category, keptQuestions) {
  const all = await snGet(
    'asmt_metric',
    `sysparm_query=category=${category.sys_id}^active=true&sysparm_fields=sys_id,question,name`
  );
  const stale = all.filter((m) => keptQuestions.indexOf(m.question) === -1);

  for (const m of stale) {
    if (!apply) {
      console.log(`    deactivate placeholder: "${m.question}"`);
      continue;
    }
    await snPatch('asmt_metric', m.sys_id, { active: false });
    console.log(`    deactivated placeholder: "${m.question}"`);
  }
}

async function main() {
  const definition = loadDefinition();

  const problems = validate(definition);
  if (problems.length) {
    console.error('Definition problems:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  announceTarget(apply ? 'Load survey questions' : 'Load survey questions (DRY RUN)');
  if (!apply) console.log('Dry run: pass --apply to write.\n');

  for (const entry of definition) {
    const survey = await resolveSurvey(entry.survey);
    console.log(`${survey.name}  [${survey.publish_state}]`);

    const category = await resolveCategory(survey, entry.category);
    const questions = entry.questions || [];

    for (let i = 0; i < questions.length; i++)
      await upsertQuestion(survey, category, questions[i], (i + 1) * 100);

    await retirePlaceholders(category, questions.map((q) => q.question));
    console.log();
  }

  if (apply) {
    console.log('Done. Re-publish each survey in Survey Designer so the changes take effect.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
