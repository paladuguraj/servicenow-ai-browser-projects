#!/usr/bin/env node
/**
 * Drive the CSAT portal widget in a browser: company typeahead, recipient
 * modes, schedule restriction for immediate-only surveys, confirmation step
 * and the post-submit dialog.
 *
 * Always targets a single named recipient. Never switch this to a whole
 * company: that emails every active employee on each run.
 */
const { chromium } = require('playwright');
const { base, headers, snGet } = require('./lib/sn-client');

/**
 * Finds a company that still has at least one recipient outside the cooldown,
 * so the run actually exercises the submit path.
 */
async function findCompanyWithEligibleUsers() {
  const api = (await snGet('sys_ws_definition', 'sysparm_query=name=CSAT Survey API&sysparm_fields=base_uri'))[0];
  const companies = await snGet(
    'core_company',
    'sysparm_query=name!=N/A^ORDERBYname&sysparm_fields=sys_id,name&sysparm_limit=40'
  );

  for (const company of companies) {
    const res = await fetch(`${base}${api.base_uri}/users?company_id=${company.sys_id}`, { headers });
    const users = (await res.json()).result || [];
    if (users.some((u) => u.eligible)) return company;
  }
  return null;
}

async function login(page) {
  await page.goto(`${base}/login.do`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="user_name"], #user_name', process.env.SN_USERNAME);
  await page.fill('input[name="user_password"], #user_password', process.env.SN_PASSWORD);
  await page.click('button[type="submit"], #sysverb_login, .btn-primary');
  await page.waitForTimeout(5000);

  const body = await page.locator('body').innerText();
  if (/Only interactive users are allowed/i.test(body))
    throw new Error('This account is an integration user and cannot sign in to the UI. Use an interactive account for browser tests.');
}

async function pickCompany(page, term) {
  await page.fill('#csat-company', term);
  await page.waitForSelector('.csat-typeahead li', { timeout: 20000 });

  // The search is debounced, so wait until the list reflects the term rather
  // than clicking whatever was still on screen from the initial load.
  await page
    .locator('.csat-typeahead li', { hasText: term })
    .first()
    .waitFor({ timeout: 20000 });

  const match = page.locator('.csat-typeahead li', { hasText: term }).first();
  const picked = (await match.textContent()).trim();
  const count = await page.locator('.csat-typeahead li').count();
  await match.click();
  await page.waitForTimeout(3000);
  return { picked, count };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page);
    await page.goto(`${base}/csat?id=csat_home`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForSelector('.csat-survey-request', { timeout: 30000 });
    console.log(`Widget: ${(await page.locator('.panel-title').first().textContent()).trim()}`);

    // Requirement 6: the asmt_metric_type note must be gone.
    const bodyText = await page.locator('.csat-survey-request').innerText();
    console.log(`asmt_metric_type note removed: ${!/asmt_metric_type/i.test(bodyText)}`);

    const target = await findCompanyWithEligibleUsers();
    if (!target) {
      console.log('No company on this instance has an eligible recipient; cannot exercise submit.');
      return;
    }

    const search = await pickCompany(page, target.name);
    console.log(`Company typeahead: ${search.count} result(s), selected "${search.picked}"`);

    const allTemplates = await page.locator('#csat-template option').allTextContents();
    const drafts = allTemplates.filter((t) => /Draft/.test(t));
    // Drafts render disabled, so only published surveys can be exercised.
    const sendable = allTemplates.slice(1).filter((t) => !/Draft/.test(t));
    console.log(`Templates: ${sendable.length} sendable, ${drafts.length} draft`);
    if (drafts.length) console.log(`  drafts blocked: ${drafts.join(', ')}`);

    // Requirement 4: immediate-only surveys collapse the schedule to one option.
    for (const name of sendable) {
      await page.selectOption('#csat-template', { label: name });
      await page.waitForTimeout(400);
      const schedules = await page.locator('#csat-schedule option').allTextContents();
      const restricted = /Closed Case Survey|Complex Resolution Survey/.test(name);
      const ok = restricted ? schedules.length === 1 : schedules.length === 3;
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: ${schedules.length} schedule option(s)${restricted ? ' (expected 1)' : ' (expected 3)'}`);
    }

    // Requirement 3: recipient modes.
    const modes = await page.locator('input[name][type=radio], .radio input[type=radio]').count();
    console.log(`Recipient modes offered: ${modes}`);
    const recipientText = await page.locator('.form-group:has(.radio)').first().innerText();
    console.log(`  Primary User note: ${/active portal account/i.test(recipientText)}`);
    console.log(`  Selected Users note: ${/more than one user/i.test(recipientText)}`);

    await page.check('input[type="radio"][value="selected_users"]');
    await page.waitForTimeout(1500);

    const eligible = await page.locator('.csat-users-panel .checkbox').count();
    console.log(`Eligible users listed: ${eligible}`);
    if (!eligible) {
      console.log('No eligible recipients for this company; stopping before submit.');
      return;
    }

    await page.locator('.csat-users-panel input[type="checkbox"]').first().check();
    await page.selectOption('#csat-template', { label: sendable[0] });
    await page.fill('#csat-notes', 'Portal end-to-end test');

    await page.click('button:has-text("Create Survey Request")');
    await page.waitForSelector('.csat-confirm', { timeout: 20000 });
    console.log(`Confirmation: ${(await page.locator('.csat-confirm p').textContent()).replace(/\s+/g, ' ').trim()}`);

    await page.click('.csat-confirm button.btn-primary');

    // Requirement 7: a dialog confirms submission before returning to a blank form.
    await page.waitForSelector('.modal-dialog, .modal-content', { timeout: 60000 });
    const modalText = (await page.locator('.modal-content').innerText()).replace(/\s+/g, ' ').trim();
    console.log(`Dialog: ${modalText}`);

    await page.locator('.modal-content button').first().click();
    await page.waitForTimeout(2500);

    const companyValue = await page.inputValue('#csat-company');
    console.log(`Form reset after dialog: ${companyValue === '' ? 'yes' : `no ("${companyValue}")`}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
