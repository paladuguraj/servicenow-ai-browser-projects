#!/usr/bin/env node
const { chromium } = require('playwright');

function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
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

async function login(page) {
  await page.goto(`${base}/login.do`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="user_name"], #user_name', process.env.SN_USERNAME);
  await page.fill('input[name="user_password"], #user_password', process.env.SN_PASSWORD);
  await page.click('button[type="submit"], #sysverb_login, .btn-primary');
  await page.waitForURL((url) => !url.pathname.includes('login.do'), { timeout: 30000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await login(page);

  await page.goto(`${base}/csat?id=csat_home`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.csat-survey-request', { timeout: 30000 });

  const title = await page.locator('.panel-title').first().textContent();
  const companyCount = await page.locator('#csat-company option').count();
  const templateCount = await page.locator('#csat-template option').count();

  console.log(`Title: ${title}`);
  console.log(`Companies loaded: ${companyCount - 1}`);
  console.log(`Templates loaded: ${templateCount - 1}`);

  // Pick a company that actually has users so the submit path is exercised.
  await page.selectOption('#csat-company', { label: 'ACME North America' });
  await page.waitForTimeout(3000);
  const userRows = await page.locator('.csat-users-panel .checkbox').count();
  console.log(`Users loaded: ${userRows}`);

  await page.selectOption('#csat-template', { label: 'Customer Satisfaction Survey' });
  await page.selectOption('#csat-schedule', 'immediate');
  await page.fill('#csat-notes', 'Service Portal end-to-end test');
  const startedAt = Date.now();
  await page.click('button:has-text("Create Survey Request")');
  await page.waitForSelector('.alert-success, .alert-danger, .alert-warning', { timeout: 180000 });

  const alertText = await page.locator('.alert-success, .alert-danger, .alert-warning').first().textContent();
  console.log(`Submit took: ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(`Result: ${alertText.trim()}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
