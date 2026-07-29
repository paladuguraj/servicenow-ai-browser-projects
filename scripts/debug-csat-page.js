#!/usr/bin/env node
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

const base = process.env.SN_INSTANCE_URL.replace(/\/$/, '');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${base}/login.do`);
  await page.fill('#user_name', process.env.SN_USERNAME);
  await page.fill('#user_password', process.env.SN_PASSWORD);
  await page.click('#sysverb_login');
  await page.waitForTimeout(3000);

  const response = await page.goto(`${base}/csat_survey_request.do`, { waitUntil: 'domcontentloaded' });
  console.log('Status:', response.status());
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  const bodyText = await page.locator('body').innerText();
  console.log('Body preview:', bodyText.slice(0, 1000));
  const html = await page.content();
  fs.writeFileSync('/workspace/csat-page-debug.html', html);
  console.log('Saved csat-page-debug.html');
  await browser.close();
}

main();
