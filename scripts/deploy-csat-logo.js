#!/usr/bin/env node
/**
 * Deploy the Network Operations CSAT Survey logo.
 *
 * Stores the logo as both a db_image record and a sys_attachment record,
 * then stores the attachment sys_id in the csat.logo.attachment_sys_id
 * property so email and portal widgets can reference the attachment URL.
 *
 * Sys_attachment is used for rendering because it is accessible to portal
 * guests and email clients, whereas db_image can be restricted.
 */
const fs = require('fs');
const path = require('path');
const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const IMAGE_NAME = 'csat_logo.png';
const IMAGE_FILE_NAME = 'csat-logo.png';
const IMAGE_FILE = path.join(__dirname, '..', 'servicenow', 'assets', IMAGE_FILE_NAME);
const ATTACHMENT_PROPERTY = 'csat.logo.attachment_sys_id';

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

async function uploadAttachment(parentTable, parentSysId) {
  const image = fs.readFileSync(IMAGE_FILE);

  const existing = await snGet(
    'sys_attachment',
    `sysparm_query=${encodeURIComponent(`table_name=${parentTable}^table_sys_id=${parentSysId}^file_name=${IMAGE_FILE_NAME}`)}&sysparm_fields=sys_id`
  );

  for (const att of existing) {
    await fetch(`${base}/api/now/attachment/${att.sys_id}`, {
      method: 'DELETE',
      headers: { Authorization: headers.Authorization },
    });
  }

  const res = await fetch(
    `${base}/api/now/attachment/file?table_name=${parentTable}&table_sys_id=${parentSysId}&file_name=${encodeURIComponent(IMAGE_FILE_NAME)}`,
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
  console.log(`Uploaded attachment: ${IMAGE_FILE_NAME} (${(image.length / 1024).toFixed(1)} KB) -> ${sysId}`);
  return sysId;
}

async function ensureAttachmentProperty(sysId) {
  const existing = await snGet('sys_properties', `sysparm_query=name=${ATTACHMENT_PROPERTY}&sysparm_fields=sys_id,value`);
  const payload = {
    name: ATTACHMENT_PROPERTY,
    value: sysId,
    type: 'string',
    description: 'sys_id of the CSAT logo attachment in sys_attachment. Used by email and portal widgets.',
  };

  if (existing.length) {
    await snPatch('sys_properties', existing[0].sys_id, payload);
    console.log(`Updated property: ${ATTACHMENT_PROPERTY} = ${sysId}`);
    return;
  }

  await snPost('sys_properties', payload);
  console.log(`Created property: ${ATTACHMENT_PROPERTY} = ${sysId}`);
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
  const attachmentSysId = await uploadAttachment('db_image', dbImageSysId);
  await ensureAttachmentProperty(attachmentSysId);
  await updateEmailNotification('CSAT Survey Invitation');
  await updateEmailNotification('CSAT Survey Submitted - Thank You');

  console.log('\nLogo deployment complete.');
  console.log(`Attachment: ${base}/sys_attachment.do?sys_id=${attachmentSysId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
