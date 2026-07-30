#!/usr/bin/env node
/**
 * Deploy CSAT Survey Request Service Portal (sp_portal, widget, pages, menu).
 * Reuses backend tables and CSATSurveyService from deploy-csat-app.js.
 */

const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const PORTAL_SUFFIX = 'csat';
const PORTAL_TITLE = 'CSAT Survey Portal';
const WIDGET_ID = 'csat-survey-request';
const HOME_PAGE_ID = 'csat_home';

// Theme and login page are inherited from the stock Service Portal ('/sp').
// Resolved at deploy time because these sys_ids differ between instances.
let spTheme = '';
let spLoginPage = '';

function readWidgetFile(name) {
  return readArtifact(`portal/widgets/csat-survey-request/${name}`);
}

async function ensureWidget() {
  const existing = await snGet('sp_widget', `sysparm_query=id=${WIDGET_ID}&sysparm_fields=sys_id`);
  const payload = {
    name: 'CSAT Survey Request',
    id: WIDGET_ID,
    template: readWidgetFile('template.html'),
    client_script: readWidgetFile('client.js'),
    script: readWidgetFile('server.js'),
    css: readWidgetFile('style.css'),
    public: false,
    roles: 'snc_internal',
    controller_as: 'c',
    category: 'custom',
    active: true,
    description: 'Create and schedule native ServiceNow CSAT survey requests by company',
  };

  if (existing.length) {
    await snPatch('sp_widget', existing[0].sys_id, payload);
    console.log(`Updated widget: ${WIDGET_ID}`);
    return existing[0].sys_id;
  }

  const created = await snPost('sp_widget', payload);
  console.log(`Created widget: ${WIDGET_ID}`);
  return created.sys_id;
}

async function ensurePage(pageId, title) {
  const existing = await snGet('sp_page', `sysparm_query=id=${pageId}&sysparm_fields=sys_id`);
  const payload = {
    id: pageId,
    title,
    public: false,
    draft: false,
    use_seo_url: false,
  };

  if (existing.length) {
    await snPatch('sp_page', existing[0].sys_id, payload);
    console.log(`Updated page: ${pageId}`);
    return existing[0].sys_id;
  }

  const created = await snPost('sp_page', payload);
  console.log(`Created page: ${pageId}`);
  return created.sys_id;
}

async function clearPageLayout(pageSysId) {
  const containers = await snGet('sp_container', `sysparm_query=sp_page=${pageSysId}&sysparm_fields=sys_id`);
  for (const container of containers) {
    const rows = await snGet('sp_row', `sysparm_query=sp_container=${container.sys_id}&sysparm_fields=sys_id`);
    for (const row of rows) {
      const cols = await snGet('sp_column', `sysparm_query=sp_row=${row.sys_id}&sysparm_fields=sys_id`);
      for (const col of cols) {
        const instances = await snGet('sp_instance', `sysparm_query=sp_column=${col.sys_id}&sysparm_fields=sys_id`);
        for (const inst of instances) {
          await fetch(`${base}/api/now/table/sp_instance/${inst.sys_id}`, { method: 'DELETE', headers });
        }
        await fetch(`${base}/api/now/table/sp_column/${col.sys_id}`, { method: 'DELETE', headers });
      }
      await fetch(`${base}/api/now/table/sp_row/${row.sys_id}`, { method: 'DELETE', headers });
    }
    await fetch(`${base}/api/now/table/sp_container/${container.sys_id}`, { method: 'DELETE', headers });
  }
}

async function placeWidgetOnPage(pageSysId, widgetSysId, title) {
  await clearPageLayout(pageSysId);

  const container = await snPost('sp_container', {
    sp_page: pageSysId,
    name: `${title} Container`,
    width: 'container',
    order: 1,
  });

  const row = await snPost('sp_row', {
    sp_container: container.sys_id,
    order: 1,
  });

  const column = await snPost('sp_column', {
    sp_row: row.sys_id,
    size: 12,
    order: 1,
  });

  await snPost('sp_instance', {
    sp_column: column.sys_id,
    sp_widget: widgetSysId,
    order: 1,
    title,
    active: true,
  });

  console.log(`Placed widget on page ${pageSysId}`);
}

async function ensureMenu(portalSysId, homePageSysId) {
  const portal = (await snGet('sp_portal', `sysparm_query=sys_id=${portalSysId}&sysparm_fields=sp_rectangle_menu`))[0];
  let menuId = portal.sp_rectangle_menu && portal.sp_rectangle_menu.value;

  if (!menuId) {
    const menu = await snPost('sp_instance_menu', {
      title: 'CSAT Portal Menu',
      active: true,
    });
    menuId = menu.sys_id;
    await snPatch('sp_portal', portalSysId, { sp_rectangle_menu: menuId });
    console.log('Created portal menu');
  }

  const items = [
    { label: 'New Request', type: 'page', order: 100, sp_page: homePageSysId },
    { label: 'Survey Requests', type: 'url', order: 200, url: '?id=list&table=u_x_csat_survey_request' },
    { label: 'Executions', type: 'url', order: 300, url: '?id=list&table=u_x_csat_survey_execution' },
    { label: 'My Surveys', type: 'url', order: 400, url: '?id=my_surveys' },
  ];

  for (const item of items) {
    const query = item.sp_page
      ? `sysparm_query=sp_rectangle_menu=${menuId}^label=${encodeURIComponent(item.label)}&sysparm_fields=sys_id`
      : `sysparm_query=sp_rectangle_menu=${menuId}^label=${encodeURIComponent(item.label)}&sysparm_fields=sys_id`;
    const existing = await snGet('sp_rectangle_menu_item', query);
    const payload = {
      sp_rectangle_menu: menuId,
      label: item.label,
      type: item.type,
      order: item.order,
      active: true,
    };
    if (item.sp_page) payload.sp_page = item.sp_page;
    if (item.url) payload.url = item.url;

    if (existing.length) {
      await snPatch('sp_rectangle_menu_item', existing[0].sys_id, payload);
    } else {
      await snPost('sp_rectangle_menu_item', payload);
    }
    console.log(`Menu item: ${item.label}`);
  }
}

async function resolvePortalDefaults() {
  const stock = (await snGet('sp_portal', 'sysparm_query=url_suffix=sp&sysparm_fields=theme,login_page'))[0];
  if (stock) {
    spTheme = stock.theme ? stock.theme.value : '';
    spLoginPage = stock.login_page ? stock.login_page.value : '';
  }

  if (!spTheme) {
    const theme = (await snGet('sp_theme', 'sysparm_query=name=Coral^ORnameSTARTSWITHStock&sysparm_limit=1&sysparm_fields=sys_id'))[0];
    spTheme = theme ? theme.sys_id : '';
  }

  if (!spTheme)
    throw new Error('No Service Portal theme found on this instance; is the Service Portal plugin active?');

  console.log(`Theme: ${spTheme}${spLoginPage ? `, login page: ${spLoginPage}` : ' (no login page inherited)'}`);
}

async function ensurePortal(homePageSysId) {
  const existing = await snGet('sp_portal', `sysparm_query=url_suffix=${PORTAL_SUFFIX}&sysparm_fields=sys_id`);
  const payload = {
    title: PORTAL_TITLE,
    url_suffix: PORTAL_SUFFIX,
    homepage: homePageSysId,
    theme: spTheme,
    login_page: spLoginPage,
    active: true,
    enable_favorites: false,
    default: false,
  };

  if (existing.length) {
    await snPatch('sp_portal', existing[0].sys_id, payload);
    console.log(`Updated portal: ${PORTAL_SUFFIX}`);
    return existing[0].sys_id;
  }

  const created = await snPost('sp_portal', payload);
  console.log(`Created portal: ${PORTAL_SUFFIX}`);
  return created.sys_id;
}

async function main() {
  announceTarget('Deploy CSAT Service Portal');

  await resolvePortalDefaults();
  const widgetSysId = await ensureWidget();
  const homePageSysId = await ensurePage(HOME_PAGE_ID, 'CSAT Survey Request');
  await placeWidgetOnPage(homePageSysId, widgetSysId, 'CSAT Survey Request');

  const portalSysId = await ensurePortal(homePageSysId);
  await ensureMenu(portalSysId, homePageSysId);

  console.log('\nDeployment complete.');
  console.log(`Portal URL: ${base}/${PORTAL_SUFFIX}`);
  console.log(`Request form: ${base}/${PORTAL_SUFFIX}?id=${HOME_PAGE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
