#!/usr/bin/env node
/**
 * Deploy the Network Operations CSAT Survey logo.
 *
 * Stores the logo as a db_image record so ServiceNow can serve it from a
 * stable URL, then wires it into:
 *   - the CSAT Survey Invitation email
 *   - the CSAT Survey Submitted - Thank You email
 *
 * The survey page shows the logo through the csat-survey-logo-header widget
 * on the csat_take_survey page, so the logo appears above the question form
 * without bringing back the Get Started landing page.
 *
 * The image is referenced by name (csat_logo.png). ServiceNow resolves that
 * name to the db_image when rendering emails and portal pages.
 */
const fs = require('fs');
const path = require('path');
const { base, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const IMAGE_NAME = 'csat_logo.png';
const IMAGE_FILE = path.join(__dirname, '..', 'servicenow', 'assets', 'csat-logo.png');

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

async function main() {
  announceTarget('Deploy CSAT logo');

  await ensureDbImage();
  await updateEmailNotification('CSAT Survey Invitation');
  await updateEmailNotification('CSAT Survey Submitted - Thank You');

  console.log('\nLogo deployment complete.');
  console.log(`Image record: ${base}/${IMAGE_NAME}.iix`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
