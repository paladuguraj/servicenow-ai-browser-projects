#!/usr/bin/env node
/**
 * Deploy the Network Operations CSAT Survey logo assets.
 *
 * - Stores the default AppDirect logo as a db_image and as a sys_attachment.
 * - Stores the default logo attachment sys_id in csat.logo.default_attachment_sys_id.
 * - Seeds csat.logo.whitelabel as an empty JSON map. The mail script and widget
 *   read partner logos from core_company.banner_image by default; this property
 *   is only used when you need to override a specific partner logo.
 */
const fs = require('fs');
const path = require('path');
const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const IMAGE_NAME = 'csat_logo.png';
const DEFAULT_LOGO_FILE_NAME = 'appdirect-logo.png';
const DEFAULT_LOGO_FILE = path.join(__dirname, '..', 'servicenow', 'assets', DEFAULT_LOGO_FILE_NAME);
const DEFAULT_PROPERTY = 'csat.logo.default_attachment_sys_id';
const PARTNER_PROPERTY = 'csat.logo.whitelabel';
const LEGACY_PROPERTY = 'csat.logo.attachment_sys_id';

async function ensureDbImage() {
  const image = fs.readFileSync(DEFAULT_LOGO_FILE);
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

async function uploadAttachment(parentTable, parentSysId, filePath, fileName) {
  const image = fs.readFileSync(filePath);

  const existing = await snGet(
    'sys_attachment',
    `sysparm_query=${encodeURIComponent(`table_name=${parentTable}^table_sys_id=${parentSysId}^file_name=${fileName}`)}&sysparm_fields=sys_id`
  );

  for (const att of existing) {
    await fetch(`${base}/api/now/attachment/${att.sys_id}`, {
      method: 'DELETE',
      headers: { Authorization: headers.Authorization },
    });
  }

  const res = await fetch(
    `${base}/api/now/attachment/file?table_name=${parentTable}&table_sys_id=${parentSysId}&file_name=${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      headers: {
        Authorization: headers.Authorization,
        'Content-Type': 'image/png',
        Accept: 'application/json',
      },
      body: image,
    }
  );

  const text = await res.text();
  if (!res.ok) throw new Error(`Attachment upload failed (${res.status}): ${text}`);

  const body = JSON.parse(text);
  const sysId = body.result.sys_id;
  console.log(`Uploaded attachment: ${fileName} (${(image.length / 1024).toFixed(1)} KB) -> ${sysId}`);
  return sysId;
}

async function ensureProperty(name, value, description) {
  const existing = await snGet('sys_properties', `sysparm_query=name=${name}&sysparm_fields=sys_id,value`);
  const payload = { name, value, type: 'string', description };

  if (existing.length) {
    await snPatch('sys_properties', existing[0].sys_id, payload);
    console.log(`Updated property: ${name}`);
    return;
  }

  await snPost('sys_properties', payload);
  console.log(`Created property: ${name}`);
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

  const dbImageSysId = await ensureDbImage();
  const defaultAttachmentSysId = await uploadAttachment('db_image', dbImageSysId, DEFAULT_LOGO_FILE, DEFAULT_LOGO_FILE_NAME);

  await ensureProperty(
    DEFAULT_PROPERTY,
    defaultAttachmentSysId,
    'sys_id of the default CSAT/AppDirect logo attachment in sys_attachment.'
  );

  await ensureProperty(
    PARTNER_PROPERTY,
    '{}',
    'Optional JSON map of white-label partner name -> sys_attachment sys_id. If empty, partner logos are read from core_company.banner_image.'
  );

  await ensureProperty(
    LEGACY_PROPERTY,
    defaultAttachmentSysId,
    'Legacy sys_id of the CSAT logo attachment. Kept for backward compatibility.'
  );

  await updateEmailNotification('CSAT Survey Invitation');
  await updateEmailNotification('CSAT Survey Submitted - Thank You');

  console.log('\nLogo deployment complete.');
  console.log(`Default attachment: ${base}/sys_attachment.do?sys_id=${defaultAttachmentSysId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
