#!/usr/bin/env node
/**
 * Deploy the Survey Management Dashboard on the CSAT portal: the CSATDashboard
 * script include, the csat-dashboard widget, the csat_dashboard page and its
 * "Dashboard" menu item. Run after deploy-csat-portal.js.
 *
 * Only the dashboard's own records are touched, so other portal pages keep
 * their layout and stay out of the update set.
 */

const fs = require('fs');
const path = require('path');
const { base, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const PORTAL_SUFFIX = 'csat';
const SCRIPT_INCLUDE = 'CSATDashboard';
const WIDGET_ID = 'csat-dashboard';
const PAGE_ID = 'csat_dashboard';
const TITLE = 'Survey Management Dashboard';
const MENU_LABEL = 'Dashboard';
const MENU_ORDER = 260;
// The same audience as the Results page.
const VIEWERS_CRITERIA = 'CSAT Survey Admins';
const CASE_SURVEYS_PROPERTY = 'csat.dashboard.case_surveys';

async function upsert(table, query, payload, label) {
  const existing = await snGet(table, `sysparm_query=${encodeURIComponent(query)}&sysparm_fields=sys_id`);
  if (existing.length) {
    await snPatch(table, existing[0].sys_id, payload);
    console.log(`Updated ${label}`);
    return existing[0].sys_id;
  }
  const created = await snPost(table, payload);
  console.log(`Created ${label}`);
  return created.sys_id;
}

function ensureScriptInclude() {
  return upsert(
    'sys_script_include',
    `name=${SCRIPT_INCLUDE}`,
    {
      name: SCRIPT_INCLUDE,
      api_name: `global.${SCRIPT_INCLUDE}`,
      script: readArtifact(`script-includes/${SCRIPT_INCLUDE}.js`),
      access: 'public',
      client_callable: false,
      active: true,
      description: 'Aggregates for the Survey Management Dashboard on the CSAT portal',
    },
    `script include ${SCRIPT_INCLUDE}`
  );
}

function ensureWidget() {
  const file = (name) => readArtifact(`portal/widgets/${WIDGET_ID}/${name}`);
  const payload = {
    name: TITLE,
    id: WIDGET_ID,
    template: file('template.html'),
    client_script: file('client.js'),
    script: file('server.js'),
    css: file('style.css'),
    public: false,
    roles: 'snc_internal',
    controller_as: 'c',
    category: 'custom',
    active: true,
    description: 'Case Auto CSAT and CSAT Manual Tool surveys sent, responses and answers with charts',
  };
  const linkPath = path.join(__dirname, '..', 'servicenow', 'portal', 'widgets', WIDGET_ID, 'link.js');
  if (fs.existsSync(linkPath)) payload.link = fs.readFileSync(linkPath, 'utf8');
  return upsert('sp_widget', `id=${WIDGET_ID}`, payload, `widget ${WIDGET_ID}`);
}

function ensurePage() {
  return upsert(
    'sp_page',
    `id=${PAGE_ID}`,
    { id: PAGE_ID, title: TITLE, public: false, draft: false, use_seo_url: false },
    `page ${PAGE_ID}`
  );
}

// Reuses the page's existing layout so redeploys don't churn sp_container,
// sp_row and sp_column records.
async function ensureLayout(pageSysId, widgetSysId) {
  const containers = await snGet('sp_container', `sysparm_query=sp_page=${pageSysId}^ORDERBYorder&sysparm_fields=sys_id`);
  const containerId = containers.length
    ? containers[0].sys_id
    : (await snPost('sp_container', { sp_page: pageSysId, name: `${TITLE} Container`, width: 'container-fluid', order: 1 })).sys_id;

  const rows = await snGet('sp_row', `sysparm_query=sp_container=${containerId}^ORDERBYorder&sysparm_fields=sys_id`);
  const rowId = rows.length ? rows[0].sys_id : (await snPost('sp_row', { sp_container: containerId, order: 1 })).sys_id;

  const cols = await snGet('sp_column', `sysparm_query=sp_row=${rowId}^ORDERBYorder&sysparm_fields=sys_id`);
  const colId = cols.length ? cols[0].sys_id : (await snPost('sp_column', { sp_row: rowId, size: 12, order: 1 })).sys_id;

  await upsert(
    'sp_instance',
    `sp_column=${colId}^sp_widget=${widgetSysId}`,
    { sp_column: colId, sp_widget: widgetSysId, order: 1, title: TITLE, active: true },
    'dashboard widget placement'
  );
}

// With glide.service_portal.user_criteria_enabled on, a page or widget with no
// "Who can view" criteria is not shown to anyone outside the platform UI.
async function ensureCanView(table, field, recordSysId) {
  const criteria = (
    await snGet('user_criteria', `sysparm_query=${encodeURIComponent(`name=${VIEWERS_CRITERIA}^active=true`)}&sysparm_fields=sys_id`)
  )[0];
  if (!criteria) {
    console.warn(`User criteria "${VIEWERS_CRITERIA}" not found; set "Who can view" on ${field} ${recordSysId} by hand`);
    return;
  }
  const linked = await snGet(table, `sysparm_query=${field}=${recordSysId}^user_criteria=${criteria.sys_id}&sysparm_fields=sys_id`);
  if (!linked.length) await snPost(table, { [field]: recordSysId, user_criteria: criteria.sys_id });
  console.log(`${field} ${recordSysId} can be viewed by: ${VIEWERS_CRITERIA}`);
}

async function ensureMenuItem(pageSysId) {
  const portal = (await snGet('sp_portal', `sysparm_query=url_suffix=${PORTAL_SUFFIX}&sysparm_fields=sp_rectangle_menu`))[0];
  const menuId = portal && portal.sp_rectangle_menu && portal.sp_rectangle_menu.value;
  if (!menuId) {
    console.warn('CSAT portal menu not found; run deploy-csat-portal.js first');
    return;
  }
  await upsert(
    'sp_rectangle_menu_item',
    `sp_rectangle_menu=${menuId}^label=${MENU_LABEL}`,
    { sp_rectangle_menu: menuId, label: MENU_LABEL, type: 'page', order: MENU_ORDER, active: true, sp_page: pageSysId, url: '' },
    `menu item ${MENU_LABEL}`
  );
}

// Created only if missing so a value changed on the instance is kept.
async function ensureCaseSurveysProperty() {
  const existing = await snGet('sys_properties', `sysparm_query=name=${CASE_SURVEYS_PROPERTY}&sysparm_fields=sys_id,value`);
  if (existing.length) {
    console.log(`Property ${CASE_SURVEYS_PROPERTY} already set: ${existing[0].value}`);
    return;
  }
  await snPost('sys_properties', {
    name: CASE_SURVEYS_PROPERTY,
    value: 'Closed Case Survey',
    type: 'string',
    description: 'Comma-separated survey names offered in the Survey filter of the Case Auto CSAT tab on the CSAT Survey Management Dashboard',
  });
  console.log(`Created property ${CASE_SURVEYS_PROPERTY}`);
}

async function main() {
  announceTarget('Deploy CSAT Survey Management Dashboard');

  await ensureCaseSurveysProperty();
  await ensureScriptInclude();
  const widgetSysId = await ensureWidget();
  const pageSysId = await ensurePage();
  await ensureLayout(pageSysId, widgetSysId);
  await ensureCanView('m2m_sp_page_uc_can_view', 'sp_page', pageSysId);
  await ensureCanView('m2m_sp_widget_uc_can_view', 'sp_widget', widgetSysId);
  await ensureMenuItem(pageSysId);

  console.log(`\nDashboard: ${base}/${PORTAL_SUFFIX}?id=${PAGE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
