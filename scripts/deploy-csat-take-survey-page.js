#!/usr/bin/env node
/**
 * Deploy only the CSAT take-survey page and logo header widget.
 *
 * This is a focused counterpart to deploy-csat-portal.js: it does not touch
 * the existing portal pages, so it produces a clean logo-only update set.
 */
const { base, headers, snGet, snPost, snPatch, readArtifact, announceTarget } = require('./lib/sn-client');

const LOGO_HEADER_WIDGET_ID = 'csat-survey-logo-header';
const TAKE_SURVEY_PAGE_ID = 'csat_take_survey';
const STOCK_SURVEY_WIDGET_ID = 'take_assessment';

function readWidgetFile(widgetId, name) {
  return readArtifact(`portal/widgets/${widgetId}/${name}`);
}

async function ensureWidget(widgetId, name, description) {
  const existing = await snGet('sp_widget', `sysparm_query=id=${widgetId}&sysparm_fields=sys_id`);
  const payload = {
    name,
    id: widgetId,
    template: readWidgetFile(widgetId, 'template.html'),
    client_script: readWidgetFile(widgetId, 'client.js'),
    script: readWidgetFile(widgetId, 'server.js'),
    css: readWidgetFile(widgetId, 'style.css'),
    public: false,
    roles: 'snc_internal',
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

async function main() {
  announceTarget('Deploy CSAT take-survey page (logo only)');

  const logoHeaderWidgetSysId = await ensureWidget(
    LOGO_HEADER_WIDGET_ID,
    'CSAT Survey Logo Header',
    'Shows the CSAT logo above surveys raised from the CSAT portal'
  );
  const stockSurveyWidgetSysId = await resolveStockWidget(STOCK_SURVEY_WIDGET_ID);
  const pageSysId = await ensurePage(TAKE_SURVEY_PAGE_ID, 'CSAT Take Survey');

  await placeWidgetsOnPage(
    pageSysId,
    [
      { sysId: logoHeaderWidgetSysId, title: 'CSAT Survey Logo Header' },
      { sysId: stockSurveyWidgetSysId, title: 'Survey' },
    ],
    'CSAT Take Survey'
  );

  console.log(`\nTake-survey page deployed: ${base}/csat?id=${TAKE_SURVEY_PAGE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
