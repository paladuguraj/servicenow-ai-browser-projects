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

  await page.goto(`${base}/csat_survey_request.do`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('h1', { timeout: 30000 });

  const heading = await page.locator('h1').textContent();
  const companyCount = await page.locator('#company option').count();
  const templateCount = await page.locator('#metric_type option').count();
  console.log(`Heading: ${heading}`);
  console.log(`Companies loaded: ${companyCount - 1}`);
  console.log(`Templates loaded: ${templateCount - 1}`);

  await page.selectOption('#company', { index: 1 });
  await page.waitForTimeout(3000);
  const userRows = await page.locator('.user-row').count();
  console.log(`Users loaded: ${userRows}`);

  const companyValue = await page.locator('#company').inputValue();
  await page.selectOption('#metric_type', { index: 1 });
  await page.selectOption('#schedule_frequency', 'immediate');
  await page.fill('#notes', 'Playwright end-to-end test');

  page.on('dialog', (d) => d.accept());
  await page.click('#submitBtn');
  await page.waitForTimeout(4000);

  const message = await page.locator('#message').textContent();
  console.log(`Result message: ${message}`);

  const auth = Buffer.from(`${process.env.SN_USERNAME}:${process.env.SN_PASSWORD}`).toString('base64');
  const requests = await fetch(
    `${base}/api/now/table/u_x_csat_survey_request?sysparm_query=u_company=${companyValue}^ORDERBYDESCsys_created_on&sysparm_limit=1&sysparm_fields=sys_id,u_state,u_company,u_metric_type`,
    { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` } }
  ).then((r) => r.json());

  const request = requests.result[0];
  console.log('Latest request:', JSON.stringify(request, null, 2));

  if (request) {
    const execs = await fetch(
      `${base}/api/now/table/u_x_csat_survey_execution?sysparm_query=u_survey_request=${request.sys_id}&sysparm_fields=u_status,u_message,u_user`,
      { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` } }
    ).then((r) => r.json());
    console.log(`Executions: ${execs.result.length}`);
    console.log(JSON.stringify(execs.result.slice(0, 3), null, 2));
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
