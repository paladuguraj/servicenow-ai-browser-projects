#!/usr/bin/env node
/**
 * Deploy only the CSAT take-survey page, its logo header widget and the
 * portal login page used by survey links.
 *
 * This is a focused counterpart to deploy-csat-portal.js: it does not touch
 * the existing portal pages, so it produces a clean logo-only update set.
 *
 * Survey recipients are customer contacts (snc_external) who sign in through
 * the customer identity provider, the same one the case survey on /service
 * uses. The login page sends survey links there; staff visiting any other
 * CSAT page still get the standard login form.
 */
const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const LOGO_HEADER_WIDGET_ID = 'csat-survey-logo-header';
const TAKE_SURVEY_PAGE_ID = 'csat_take_survey';
const STOCK_SURVEY_WIDGET_ID = 'take_assessment';
const LOGIN_WIDGET_ID = 'csat-survey-login';
const LOGIN_PAGE_ID = 'csat_login';
const PORTAL_SUFFIX = 'csat';
const IDP_PROPERTY = 'csat.survey.login.idp_name';
const DEFAULT_IDP_NAME = 'auth0';
const SURVEY_VIEWERS_CRITERIA = 'Roles : snc_external,snc_internal';

function readWidgetFile(widgetId, name) {
  return readArtifact(`portal/widgets/${widgetId}/${name}`);
}

async function ensureWidget(widgetId, name, description, access) {
  const existing = await snGet('sp_widget', `sysparm_query=id=${widgetId}&sysparm_fields=sys_id`);
  const payload = {
    name,
    id: widgetId,
    template: readWidgetFile(widgetId, 'template.html'),
    client_script: readWidgetFile(widgetId, 'client.js'),
    script: readWidgetFile(widgetId, 'server.js'),
    css: readWidgetFile(widgetId, 'style.css'),
    public: access.public,
    roles: access.roles,
    controller_as: 'c',
    category: 'custom',
    active: true,
    description,
  };

  if (existing.length) {
    await snPatch('sp_widget', existing[0].sys_id, payload);
    console.log(`Updated widget: ${widgetId}`);
    return existing[0].sys_id;
  }

  const created = await snPost('sp_widget', payload);
  console.log(`Created widget: ${widgetId}`);
  return created.sys_id;
}

async function ensurePage(pageId, title, isPublic = false, roles) {
  const existing = await snGet('sp_page', `sysparm_query=id=${pageId}&sysparm_fields=sys_id`);
  const payload = {
    id: pageId,
    title,
    public: isPublic,
    draft: false,
    use_seo_url: false,
  };
  if (roles !== undefined) payload.roles = roles;

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

async function placeWidgetsOnPage(pageSysId, widgets, title) {
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

  for (let i = 0; i < widgets.length; i++) {
    await snPost('sp_instance', {
      sp_column: column.sys_id,
      sp_widget: widgets[i].sysId,
      order: i + 1,
      title: widgets[i].title,
      active: true,
    });
  }

  console.log(`Placed ${widgets.length} widget(s) on page ${pageSysId}`);
}

async function resolveStockWidget(widgetId) {
  const existing = await snGet('sp_widget', `sysparm_query=id=${widgetId}&sysparm_fields=sys_id`);
  if (!existing.length) throw new Error(`Stock widget not found: ${widgetId}`);
  return existing[0].sys_id;
}

// Only created when missing, so an instance can point survey links at a
// different identity provider without the next deploy resetting it.
async function ensureIdpProperty() {
  const existing = await snGet('sys_properties', `sysparm_query=name=${IDP_PROPERTY}&sysparm_fields=sys_id,value`);
  if (existing.length) {
    console.log(`Property ${IDP_PROPERTY} already set: ${existing[0].value}`);
    return;
  }
  await snPost('sys_properties', {
    name: IDP_PROPERTY,
    value: DEFAULT_IDP_NAME,
    type: 'string',
    description:
      'Name of the identity provider (sso_properties) that CSAT survey links sign customers in with. If it is empty, missing or inactive, survey links show the standard login form.',
  });
  console.log(`Created property ${IDP_PROPERTY} = ${DEFAULT_IDP_NAME}`);
}

// With glide.service_portal.user_criteria_enabled on, a page or non-public
// widget that has no "Who can view" criteria is internal-only and its roles
// field is ignored: customers get "Not Found" or the widget is left out. The
// stock take_survey page uses the same criteria.
async function ensureCanView(table, field, recordSysId, criteriaName) {
  const criteria = (
    await snGet('user_criteria', `sysparm_query=${encodeURIComponent(`name=${criteriaName}^active=true`)}&sysparm_fields=sys_id`)
  )[0];
  if (!criteria) throw new Error(`User criteria not found: ${criteriaName}`);
  const linked = await snGet(table, `sysparm_query=${field}=${recordSysId}^user_criteria=${criteria.sys_id}&sysparm_fields=sys_id`);
  if (!linked.length) await snPost(table, { [field]: recordSysId, user_criteria: criteria.sys_id });
  console.log(`${field} ${recordSysId} can be viewed by: ${criteriaName}`);
}

async function setPortalLoginPage(loginPageSysId) {
  const portal = (await snGet('sp_portal', `sysparm_query=url_suffix=${PORTAL_SUFFIX}&sysparm_fields=sys_id`))[0];
  if (!portal) throw new Error(`Portal not found: /${PORTAL_SUFFIX}`);
  await snPatch('sp_portal', portal.sys_id, { login_page: loginPageSysId });
  console.log(`Portal /${PORTAL_SUFFIX} login page: ${LOGIN_PAGE_ID}`);
}

async function main() {
  announceTarget('Deploy CSAT take-survey page (logo + survey login)');

  const logoHeaderWidgetSysId = await ensureWidget(
    LOGO_HEADER_WIDGET_ID,
    'CSAT Survey Logo Header',
    'Shows the CSAT logo above surveys raised from the CSAT portal',
    { public: false, roles: 'snc_internal,snc_external' }
  );
  const stockSurveyWidgetSysId = await resolveStockWidget(STOCK_SURVEY_WIDGET_ID);
  const pageSysId = await ensurePage(TAKE_SURVEY_PAGE_ID, 'CSAT Take Survey', false, 'snc_internal,snc_external');

  await placeWidgetsOnPage(
    pageSysId,
    [
      { sysId: logoHeaderWidgetSysId, title: 'CSAT Survey Logo Header' },
      { sysId: stockSurveyWidgetSysId, title: 'Survey' },
    ],
    'CSAT Take Survey'
  );
  await ensureCanView('m2m_sp_page_uc_can_view', 'sp_page', pageSysId, SURVEY_VIEWERS_CRITERIA);
  await ensureCanView('m2m_sp_widget_uc_can_view', 'sp_widget', logoHeaderWidgetSysId, SURVEY_VIEWERS_CRITERIA);

  await ensureIdpProperty();
  const loginWidgetSysId = await ensureWidget(
    LOGIN_WIDGET_ID,
    'CSAT Survey Login',
    'Signs survey recipients in through the customer identity provider; shows the standard login form on other CSAT pages',
    { public: true, roles: '' }
  );
  const loginPageSysId = await ensurePage(LOGIN_PAGE_ID, 'CSAT Login', true);
  await placeWidgetsOnPage(loginPageSysId, [{ sysId: loginWidgetSysId, title: 'CSAT Survey Login' }], 'CSAT Login');
  await setPortalLoginPage(loginPageSysId);

  console.log(`\nTake-survey page deployed: ${base}/csat?id=${TAKE_SURVEY_PAGE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
