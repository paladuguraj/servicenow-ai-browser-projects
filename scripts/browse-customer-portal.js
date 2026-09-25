#!/usr/bin/env node
/**
 * Browse the /customer portal with Playwright using basic auth session
 * via ServiceNow login form, capture page titles and screenshots.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv();

const BASE = process.env.SN_INSTANCE_URL.replace(/\/$/, '');
const USER = process.env.SN_USERNAME;
const PASS = process.env.SN_PASSWORD;
const OUT = '/tmp/sn-portal/screenshots';
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  // Try side_door / login.do local login
  await page.goto(`${BASE}/login.do`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  // Capture login page
  await page.screenshot({ path: path.join(OUT, '00-login.png'), fullPage: true });

  const userSel = 'input#user_name, input[name="user_name"]';
  const passSel = 'input#user_password, input[name="user_password"]';
  if (await page.locator(userSel).count()) {
    await page.fill(userSel, USER);
    await page.fill(passSel, PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      page.click('button#sysverb_login, input#sysverb_login, button[type="submit"]'),
    ]);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '01-after-login.png'), fullPage: true });
  return page.url();
}

async function capture(page, name, url) {
  console.log('Navigating', url);
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => ({ error: e.message }));
  await page.waitForTimeout(5000);
  // wait a bit more for SPA/header
  await page.waitForTimeout(3000);
  const title = await page.title();
  const finalUrl = page.url();
  const text = await page.locator('body').innerText().catch(() => '');
  const hasGlobalNav = (await page.locator('#global-nav').count()) > 0;
  const hasSidebar = (await page.locator('.appdirect-sidebar, [class*="sidebar"]').count()) > 0;
  const navText = await page.locator('#global-nav').innerText().catch(() => '');
  const info = {
    name,
    requested: url,
    finalUrl,
    title,
    status: resp && resp.status ? resp.status() : null,
    hasGlobalNav,
    hasSidebar,
    navText: navText.slice(0, 500),
    bodyPreview: text.replace(/\s+/g, ' ').slice(0, 800),
  };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const afterLogin = await login(page);
  console.log('After login URL:', afterLogin);

  const pages = [
    ['homepage', `${BASE}/customer`],
    ['homepage-id', `${BASE}/customer?id=customer_homepage`],
    ['locations', `${BASE}/customer?id=customer_locations`],
    ['sites', `${BASE}/customer?id=customer_sites`],
    ['circuits', `${BASE}/customer?id=customer_circuits`],
    ['hardware', `${BASE}/customer?id=customer_hardware`],
    ['kb', `${BASE}/customer?id=appdirect_kb_home`],
    ['sso_initiate', `${BASE}/customer?id=sso_initiate`],
    ['sso_redirect', `${BASE}/customer?id=sso_redirect`],
  ];

  const results = [];
  for (const [name, url] of pages) {
    try {
      results.push(await capture(page, name, url));
    } catch (e) {
      console.log('FAIL', name, e.message);
      results.push({ name, error: e.message });
    }
  }

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log('Done screenshots in', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
