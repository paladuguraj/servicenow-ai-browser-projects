#!/usr/bin/env node
/**
 * Discover the Market Place customer portal: portal record, pages, widgets,
 * theme, and related configuration. Writes JSON artifacts under /tmp/sn-portal.
 */
const fs = require('fs');
const path = require('path');
const { base, headers, snGet, announceTarget } = require('./lib/sn-client');

const OUT = '/tmp/sn-portal';
fs.mkdirSync(OUT, { recursive: true });

function write(name, data) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`Wrote ${p} (${Array.isArray(data) ? data.length + ' rows' : typeof data})`);
  return data;
}

async function snGetAll(table, params) {
  // Paginate if needed
  const limit = 100;
  let offset = 0;
  const all = [];
  for (;;) {
    const pageParams = `${params}${params ? '&' : ''}sysparm_limit=${limit}&sysparm_offset=${offset}`;
    const rows = await snGet(table, pageParams);
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

async function main() {
  announceTarget('Exploring customer portal');

  // 1) Find portals matching customer / marketplace
  const portals = await snGet(
    'sp_portal',
    'sysparm_query=url_suffixLIKEcustomer^ORtitleLIKEcustomer^ORtitleLIKEmarket^ORurl_suffixLIKEmarket&sysparm_fields=sys_id,title,url_suffix,homepage,login_page,logo,icon,theme,sp_chat_queue,quick_start_config,knowledge_base,kb_knowledge_page,search_application,search_results_configuration,enable_ais,default,active&sysparm_display_value=all'
  );
  write('portals-search.json', portals);

  let allPortals = await snGet(
    'sp_portal',
    'sysparm_fields=sys_id,title,url_suffix,homepage,theme,active,sys_created_on,sys_updated_on&sysparm_display_value=true&sysparm_limit=50'
  );
  write('portals-all.json', allPortals);

  // Prefer exact url_suffix=customer
  let portal =
    portals.find((p) => (p.url_suffix?.value || p.url_suffix) === 'customer') ||
    portals[0];

  if (!portal) {
    console.log('No portal matched customer/market — dumping all and searching pages');
  } else {
    const portalId = portal.sys_id?.value || portal.sys_id;
    console.log('Primary portal:', portalId, portal.title?.display_value || portal.title);

    const portalFull = await snGet(
      'sp_portal',
      `sysparm_query=sys_id=${portalId}&sysparm_display_value=all`
    );
    write('portal-full.json', portalFull[0] || portalFull);

    // Portal → pages via sp_page_route or m2m? Actually pages reference portal via
    // sp_rectangle_menu / or pages are linked through sp_instance on containers.
    // In ServiceNow, pages belong to a portal via the portal's page list or
    // sp_page has no portal field — routes are on sp_portal or via URL.
    // Common: query sp_page by id matching portal homepage etc, and
    // sp_rel_widget_clone / browse via sp_page where public and recent.

    // Theme
    const themeId =
      portalFull[0]?.theme?.value || portal.theme?.value || portal.theme;
    if (themeId) {
      const themes = await snGet('sp_theme', `sysparm_query=sys_id=${themeId}&sysparm_display_value=all`);
      write('theme.json', themes[0] || themes);

      // Theme CSS includes
      const themeCss = await snGet(
        'm2m_sp_theme_css',
        `sysparm_query=sp_theme=${themeId}&sysparm_display_value=all`
      );
      write('theme-css-m2m.json', themeCss);

      // Header / footer from theme
      const headerId = themes[0]?.header?.value;
      const footerId = themes[0]?.footer?.value;
      if (headerId) {
        const header = await snGet('sp_header_footer', `sysparm_query=sys_id=${headerId}&sysparm_display_value=all`);
        write('header.json', header[0] || header);
        // Header is often a widget
        const headerWidget = await snGet(
          'sp_widget',
          `sysparm_query=sys_id=${headerId}^ORid=${encodeURIComponent(header[0]?.id || '')}&sysparm_display_value=all`
        );
        write('header-as-widget-try.json', headerWidget);
      }
      if (footerId) {
        const footer = await snGet('sp_header_footer', `sysparm_query=sys_id=${footerId}&sysparm_display_value=all`);
        write('footer.json', footer[0] || footer);
      }
    }
  }

  // 2) Pages — look for marketplace / customer related
  const pagesSearch = await snGetAll(
    'sp_page',
    'sysparm_query=idLIKEcustomer^ORidLIKEmarket^ORshort_descriptionLIKEmarket^ORshort_descriptionLIKEcustomer^ORtitleLIKEmarket^ORtitleLIKEcustomer&sysparm_display_value=all&sysparm_fields=sys_id,id,title,short_description,draft,public,roles,category,sys_created_on,sys_updated_on,sys_created_by,sys_updated_by,sys_scope'
  );
  write('pages-search.json', pagesSearch);

  // Also get pages that might be on this portal via homepage + common patterns
  const recentPages = await snGet(
    'sp_page',
    'sysparm_query=sys_created_onONLast 90 days@javascript:gs.beginningOfLast90Days()@javascript:gs.endOfLast90Days()^ORsys_updated_onONLast 90 days@javascript:gs.beginningOfLast90Days()@javascript:gs.endOfLast90Days()&sysparm_display_value=all&sysparm_fields=sys_id,id,title,short_description,draft,public,roles,sys_created_on,sys_updated_on,sys_created_by&sysparm_limit=100&sysparm_orderby_desc=sys_updated_on'
  );
  write('pages-recent.json', recentPages);

  // 3) Widgets related to marketplace / customer / catalog
  const widgetsSearch = await snGetAll(
    'sp_widget',
    'sysparm_query=idLIKEmarket^ORidLIKEcustomer^ORnameLIKEmarket^ORnameLIKEcustomer^ORdescriptionLIKEmarket^ORdescriptionLIKEcustomer^ORidLIKEcatalog^ORnameLIKEheader^ORidLIKEheader&sysparm_display_value=all&sysparm_fields=sys_id,id,name,description,data_table,has_preview,public,roles,sys_created_on,sys_updated_on,sys_scope,sys_package'
  );
  write('widgets-search.json', widgetsSearch);

  // Global header specifically
  const headersWidgets = await snGetAll(
    'sp_widget',
    'sysparm_query=idLIKEglobal_header^ORnameLIKEglobal header^ORidLIKEheader^ORnameLIKEheader&sysparm_display_value=all&sysparm_fields=sys_id,id,name,description,sys_scope,sys_created_on,sys_updated_on'
  );
  write('widgets-headers.json', headersWidgets);

  // 4) sp_instance — widget instances on pages (need page sys_ids)
  // 5) Menu / navigation
  const menus = await snGetAll(
    'sp_rectangle_menu',
    'sysparm_query=nameLIKEcustomer^ORnameLIKEmarket^ORhintLIKEcustomer&sysparm_display_value=all'
  );
  write('menus-search.json', menus);

  // Search application / catalog related
  const catalogs = await snGet(
    'sc_catalog',
    'sysparm_query=titleLIKEmarket^ORtitleLIKEcustomer^ORdescriptionLIKEmarket&sysparm_display_value=all&sysparm_limit=20'
  );
  write('catalogs-search.json', catalogs);

  // sp_angular_provider / CSS includes mentioning customer
  const cssIncludes = await snGet(
    'sp_css',
    'sysparm_query=nameLIKEcustomer^ORnameLIKEmarket^ORnameLIKEheader^ORnameLIKEglobal&sysparm_display_value=all&sysparm_fields=sys_id,name,sys_updated_on&sysparm_limit=50'
  );
  write('css-search.json', cssIncludes);

  console.log('\nDone. Artifacts in', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
