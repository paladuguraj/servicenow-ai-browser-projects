#!/usr/bin/env node
/**
 * Logs into the ServiceNow PDI and verifies the workspace loads.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const instanceUrl = (process.env.SN_INSTANCE_URL || 'https://dev413733.service-now.com').replace(/\/$/, '');
const username = process.env.SN_USERNAME;
const password = process.env.SN_PASSWORD;

async function main() {
  if (!username || !password) {
    console.error('Missing SN_USERNAME or SN_PASSWORD in .env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${instanceUrl}/login.do`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="user_name"], #user_name', username);
  await page.fill('input[name="user_password"], #user_password', password);
  await page.click('button[type="submit"], #sysverb_login, .btn-primary');

  await page.waitForURL((url) => !url.pathname.includes('login.do'), { timeout: 30000 });
  const title = await page.title();
  const url = page.url();

  console.log(`Logged in successfully`);
  console.log(`Page title: ${title}`);
  console.log(`URL: ${url}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
