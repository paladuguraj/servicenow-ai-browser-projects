#!/usr/bin/env node
/**
 * Deploy the Network Operations CSAT Survey logo.
 *
 * Stores the logo as a db_image record so ServiceNow can serve it from a
 * stable URL, then wires it into:
 *   - the CSAT Survey Invitation email
 *   - the CSAT Survey Submitted - Thank You email
 *   - the header of both CSAT survey definitions
 *
 * The image is referenced by name (csat_logo.png). ServiceNow resolves that
 * name to the db_image when rendering emails and survey pages.
 */
const fs = require('fs');
const path = require('path');
const { base, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const IMAGE_NAME = 'csat_logo.png';
const IMAGE_FILE = path.join(__dirname, '..', 'servicenow', 'assets', 'csat-logo.png');
const IMAGE_MIME = 'image/png';

const SURVEYS = ['Managed Network Services Survey - Manual', 'Managed Network Services Survey - Automatic'];

async function ensureDbImage() {
  const image = fs.readFileSync(IMAGE_FILE);
  const base64 = image.toString('base64');

  const existing = await snGet(
    'db_image',
    `sysparm_query=name=${encodeURIComponent(IMAGE_NAME)}&sysparm_fields=sys_id,name`
  );

  const payload = {
    name: IMAGE_NAME,
    active: true,
    image: base64,
    category: 'csat',
  };

  if (existing.length) {
    await snPatch('db_image', existing[0].sys_id, payload);
    console.log(`Updated db_image: ${IMAGE_NAME} (${(image.length / 1024).toFixed(1)} KB)`);
    return existing[0].sys_id;
  }

  const created = await snPost('db_image', payload);
  console.log(`Created db_image: ${IMAGE_NAME} (${(image.length / 1024).toFixed(1)} KB)`);
  return created.sys_id;
}

async function updateEmailNotification(name) {
  const existing = await snGet(
    'sysevent_email_action',
    `sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id,name`
  );

  if (!existing.length) {
    console.log(`Notification not found: ${name}`);
    return;
  }

  const templateFile =
    name === 'CSAT Survey Invitation'
      ? 'notifications/csat-survey-invitation.html'
      : 'notifications/csat-survey-thank-you.html';

  await snPatch('sysevent_email_action', existing[0].sys_id, {
    message_html: readArtifact(templateFile),
  });
  console.log(`Updated notification: ${name}`);
}

async function updateSurveyHeaders() {
  const header = readArtifact('surveys/csat-header.html');

  for (const name of SURVEYS) {
    const survey = (await snGet(
      'asmt_metric_type',
      `sysparm_query=${encodeURIComponent(`name=${name}`)}&sysparm_fields=sys_id,name,publish_state,header`
    ))[0];

    if (!survey) {
      console.log(`${name}: not found`);
      continue;
    }

    const current = (survey.header || '').trim();
    if (current === header.trim()) {
      console.log(`${name}: header already up to date`);
      continue;
    }

    await snPatch('asmt_metric_type', survey.sys_id, { header });
    console.log(`${name} [${survey.publish_state}]: updated header with logo`);
  }
}

async function main() {
  announceTarget('Deploy CSAT logo');

  await ensureDbImage();
  await updateEmailNotification('CSAT Survey Invitation');
  await updateEmailNotification('CSAT Survey Submitted - Thank You');
  await updateSurveyHeaders();

  console.log('\nLogo deployment complete.');
  console.log(`Image record: ${base}/${IMAGE_NAME}.iix`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
