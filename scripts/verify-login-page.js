#!/usr/bin/env node
/**
 * Opens the ServiceNow PDI login page and verifies it loads.
 */

const { chromium } = require('playwright');

const instanceUrl = (process.env.SN_INSTANCE_URL || 'https://dev413733.service-now.com').replace(/\/$/, '');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const loginUrl = `${instanceUrl}/login.do`;
  console.log(`Navigating to ${loginUrl}...`);
  const response = await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const title = await page.title();
  const hasUserField = await page.locator('input[name="user_name"], #user_name').count();
  const hasPasswordField = await page.locator('input[name="user_password"], #user_password').count();

  console.log(`HTTP status: ${response?.status()}`);
  console.log(`Page title: ${title}`);
  console.log(`Login form present: ${hasUserField > 0 && hasPasswordField > 0 ? 'yes' : 'no'}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
