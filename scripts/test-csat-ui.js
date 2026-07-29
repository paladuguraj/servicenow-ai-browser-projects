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

  await page.goto(`${base}/login.do`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="user_name"], #user_name', process.env.SN_USERNAME);
  await page.fill('input[name="user_password"], #user_password', process.env.SN_PASSWORD);
  await page.click('button[type="submit"], #sysverb_login, .btn-primary');
  await page.waitForURL((url) => !url.pathname.includes('login.do'), { timeout: 30000 });

  await page.goto(`${base}/csat_survey_request.do`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const title = await page.title();
  const companyOptions = await page.locator('#company option').count();
  const templateOptions = await page.locator('#metric_type option').count();
  const heading = await page.locator('h1').textContent();

  console.log(`Title: ${title}`);
  console.log(`Heading: ${heading}`);
  console.log(`Company options: ${companyOptions}`);
  console.log(`Template options: ${templateOptions}`);

  if (companyOptions > 1) {
    await page.selectOption('#company', { index: 1 });
    await page.waitForTimeout(1500);
    const userRows = await page.locator('.user-row').count();
    console.log(`User rows after company select: ${userRows}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
