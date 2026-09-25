#!/usr/bin/env node
/**
 * Deep dive: customer portal pages, widgets, menu, header, CSS, catalogs.
 */
const fs = require('fs');
const path = require('path');
const { snGet, announceTarget } = require('./lib/sn-client');

const OUT = '/tmp/sn-portal';
fs.mkdirSync(OUT, { recursive: true });

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
  console.log(`Wrote ${name} (${Array.isArray(data) ? data.length : 1})`);
}

const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const d = (x) => (x && typeof x === 'object' && 'display_value' in x ? x.display_value : x);

async function getPageFull(pageIdOrSysId) {
  // Try by id then sys_id
  let rows = await snGet(
    'sp_page',
    `sysparm_query=id=${pageIdOrSysId}^ORsys_id=${pageIdOrSysId}&sysparm_display_value=all`
  );
  return rows[0];
}

async function getContainers(pageSysId) {
  return snGet(
    'sp_container',
    `sysparm_query=sp_page=${pageSysId}&sysparm_display_value=all&sysparm_orderby=order`
  );
}

async function getRows(containerSysId) {
  return snGet(
    'sp_row',
    `sysparm_query=sp_container=${containerSysId}&sysparm_display_value=all&sysparm_orderby=order`
  );
}

async function getColumns(rowSysId) {
  return snGet(
    'sp_column',
    `sysparm_query=sp_row=${rowSysId}&sysparm_display_value=all&sysparm_orderby=order`
  );
}

async function getInstances(columnSysId) {
  return snGet(
    'sp_instance',
    `sysparm_query=sp_column=${columnSysId}&sysparm_display_value=all&sysparm_orderby=order`
  );
}

async function getWidget(widgetSysId) {
  const rows = await snGet(
    'sp_widget',
    `sysparm_query=sys_id=${widgetSysId}&sysparm_display_value=all&sysparm_exclude_reference_link=true`
  );
  return rows[0];
}

async function walkPage(pageSysId, pageId) {
  const structure = { pageSysId, pageId, containers: [] };
  const containers = await getContainers(pageSysId);
  for (const c of containers) {
    const cObj = {
      sys_id: v(c.sys_id),
      name: d(c.name),
      order: d(c.order),
      bootstrap_alt: d(c.bootstrap_alt),
      class_name: d(c.class_name),
      background: d(c.background),
      rows: [],
    };
    const rows = await getRows(v(c.sys_id));
    for (const r of rows) {
      const rObj = { sys_id: v(r.sys_id), order: d(r.order), class_name: d(r.class_name), columns: [] };
      const cols = await getColumns(v(r.sys_id));
      for (const col of cols) {
        const colObj = {
          sys_id: v(col.sys_id),
          order: d(col.order),
          size: d(col.size),
          class_name: d(col.class_name),
          instances: [],
        };
        const instances = await getInstances(v(col.sys_id));
        for (const inst of instances) {
          const widgetId = v(inst.sp_widget);
          let widgetMeta = null;
          if (widgetId) {
            try {
              const w = await getWidget(widgetId);
              widgetMeta = {
                sys_id: v(w.sys_id),
                id: d(w.id),
                name: d(w.name),
                description: d(w.description),
                data_table: d(w.data_table),
                public: d(w.public),
                roles: d(w.roles),
                has_client_script: !!(v(w.client_script) && String(v(w.client_script)).trim()),
                has_server_script: !!(v(w.script) && String(v(w.script)).trim()),
                has_template: !!(v(w.template) && String(v(w.template)).trim()),
                has_css: !!(v(w.css) && String(v(w.css)).trim()),
                has_link: !!(v(w.link) && String(v(w.link)).trim()),
                option_schema: v(w.option_schema),
                demo_data: v(w.demo_data),
                // Keep scripts for technical doc (truncated later if huge)
                client_script: v(w.client_script),
                script: v(w.script),
                template: v(w.template),
                css: v(w.css),
                link: v(w.link),
                sys_scope: d(w.sys_scope),
                sys_package: d(w.sys_package),
                sys_updated_on: d(w.sys_updated_on),
                sys_created_by: d(w.sys_created_by),
              };
            } catch (e) {
              widgetMeta = { error: e.message, sys_id: widgetId };
            }
          }
          colObj.instances.push({
            sys_id: v(inst.sys_id),
            title: d(inst.title),
            short_description: d(inst.short_description),
            order: d(inst.order),
            active: d(inst.active),
            class_name: d(inst.class_name),
            color: d(inst.color),
            glyph: d(inst.glyph),
            url: d(inst.url),
            size: d(inst.size),
            options: v(inst.widget_parameters) || v(inst.options),
            widget: widgetMeta,
          });
        }
        rObj.columns.push(colObj);
      }
      cObj.rows.push(rObj);
    }
    structure.containers.push(cObj);
  }
  return structure;
}

async function main() {
  announceTarget('Deep dive customer portal');

  const PORTAL_ID = '1098d4a23bae7a14d91af97a25e45a54';
  const THEME_ID = '9623b07f3bea3a54d91af97a25e45a6c';
  const HEADER_ID = 'c5f2703f3bea3a54d91af97a25e45af0';
  const MENU_ID = '1024e0b33b6a3a54d91af97a25e45a73';
  const HOME_PAGE_ID = '79c582043b7e3e54d91af97a25e45a9e';
  const LOGIN_PAGE_ID = 'f4125b623bc9c7109f13571864e45a11';

  // Header footer record + as widget
  const headerHf = await snGet('sp_header_footer', `sysparm_query=sys_id=${HEADER_ID}&sysparm_display_value=all`);
  write('header-hf.json', headerHf[0] || {});

  // Header is often stored as sp_widget with same id or linked
  const headerWidget = await snGet(
    'sp_widget',
    `sysparm_query=sys_id=${HEADER_ID}^ORidLIKEappdirect^ORnameLIKEappdirect header&sysparm_display_value=all&sysparm_fields=sys_id,id,name,description,sys_updated_on,sys_created_by,sys_scope`
  );
  write('header-widgets.json', headerWidget);

  // Theme CSS includes — correct table is often sp_theme has css_include or m2m
  for (const table of ['sp_css_include', 'm2m_sp_theme_css_include', 'sp_theme_css', 'css_include']) {
    try {
      const rows = await snGet(table, `sysparm_query=sp_theme=${THEME_ID}^ORtheme=${THEME_ID}&sysparm_limit=5`);
      console.log(`${table}: ${rows.length}`);
      write(`theme-css-${table}.json`, rows);
    } catch (e) {
      console.log(`${table}: ${e.message.slice(0, 120)}`);
    }
  }

  // JS includes on theme
  for (const table of ['m2m_sp_theme_js_include', 'sp_js_include']) {
    try {
      const rows = await snGet(table, `sysparm_query=sp_theme=${THEME_ID}^ORtheme=${THEME_ID}&sysparm_limit=20&sysparm_display_value=all`);
      console.log(`${table}: ${rows.length}`);
      write(`theme-js-${table}.json`, rows);
    } catch (e) {
      console.log(`${table}: ${e.message.slice(0, 120)}`);
    }
  }

  // Menu + items
  const menu = await snGet('sp_rectangle_menu', `sysparm_query=sys_id=${MENU_ID}&sysparm_display_value=all`);
  write('menu.json', menu[0] || {});

  const menuItems = await snGet(
    'sp_rectangle_menu_item',
    `sysparm_query=sp_rectangle_menu=${MENU_ID}^ORsp_rectangle_menu.sys_id=${MENU_ID}&sysparm_display_value=all&sysparm_orderby=order&sysparm_limit=100`
  );
  write('menu-items.json', menuItems);

  // Also try parent field
  const menuItems2 = await snGet(
    'sp_instance_menu',
    `sysparm_query=sp_rectangle_menu=${MENU_ID}&sysparm_display_value=all&sysparm_orderby=order&sysparm_limit=100`
  ).catch((e) => {
    console.log('sp_instance_menu:', e.message.slice(0, 100));
    return [];
  });
  write('menu-instance-items.json', menuItems2);

  // Discover all pages that look related — by creator, id pattern, Appdirect, customer_
  const pageQueries = [
    'idSTARTSWITHcustomer',
    'idLIKEappdirect',
    'idLIKEmarket',
    'sys_created_by=psharma^sys_created_onON2026-01-22@javascript:gs.dateGenerate("2026-01-22","start")@javascript:gs.dateGenerate("2026-01-22","end")',
    'sys_created_by=psharma^idLIKEcustomer^ORsys_created_by=psharma^idLIKEappdirect^ORsys_created_by=pankaj.sharma^idLIKEcustomer',
    'short_descriptionLIKEappdirect^ORtitleLIKEappdirect',
  ];

  const seen = new Set();
  const allPages = [];
  for (const q of pageQueries) {
    const rows = await snGet(
      'sp_page',
      `sysparm_query=${q}&sysparm_display_value=all&sysparm_fields=sys_id,id,title,short_description,draft,public,roles,category,sys_created_on,sys_updated_on,sys_created_by,sys_updated_by&sysparm_limit=100`
    );
    for (const r of rows) {
      const id = v(r.sys_id);
      if (!seen.has(id)) {
        seen.add(id);
        allPages.push(r);
      }
    }
  }
  // Always include homepage + login
  for (const sid of [HOME_PAGE_ID, LOGIN_PAGE_ID]) {
    if (!seen.has(sid)) {
      const p = await getPageFull(sid);
      if (p) {
        seen.add(sid);
        allPages.push(p);
      }
    }
  }
  write('pages-related.json', allPages);
  console.log('Related pages:', allPages.length);

  // Walk each related page structure
  const structures = [];
  const widgetIndex = {};
  for (const p of allPages) {
    const sid = v(p.sys_id);
    const pid = d(p.id);
    console.log('Walking page', pid);
    try {
      const structure = await walkPage(sid, pid);
      structure.title = d(p.title);
      structure.short_description = d(p.short_description);
      structure.public = d(p.public);
      structure.roles = d(p.roles);
      structure.draft = d(p.draft);
      structures.push(structure);

      // Index widgets
      for (const c of structure.containers) {
        for (const r of c.rows) {
          for (const col of r.columns) {
            for (const inst of col.instances) {
              if (inst.widget && inst.widget.id) {
                widgetIndex[inst.widget.id] = {
                  sys_id: inst.widget.sys_id,
                  id: inst.widget.id,
                  name: inst.widget.name,
                  description: inst.widget.description,
                  pages: [...(widgetIndex[inst.widget.id]?.pages || []), pid],
                  has_client_script: inst.widget.has_client_script,
                  has_server_script: inst.widget.has_server_script,
                  data_table: inst.widget.data_table,
                  sys_scope: inst.widget.sys_scope,
                };
              }
            }
          }
        }
      }
    } catch (e) {
      console.log('  walk failed:', e.message);
      structures.push({ pageSysId: sid, pageId: pid, error: e.message });
    }
  }
  write('page-structures.json', structures);
  write('widget-index.json', widgetIndex);

  // Also fetch header widget full if found
  if (headerWidget[0]) {
    const hw = await getWidget(v(headerWidget[0].sys_id) || HEADER_ID);
    // Save without huge duplication - save scripts separately
    write('header-widget-full-meta.json', {
      sys_id: v(hw.sys_id),
      id: d(hw.id),
      name: d(hw.name),
      description: d(hw.description),
      roles: d(hw.roles),
      public: d(hw.public),
      option_schema: v(hw.option_schema),
      sys_scope: d(hw.sys_scope),
      template_len: (v(hw.template) || '').length,
      script_len: (v(hw.script) || '').length,
      client_script_len: (v(hw.client_script) || '').length,
      css_len: (v(hw.css) || '').length,
      link_len: (v(hw.link) || '').length,
      template: v(hw.template),
      script: v(hw.script),
      client_script: v(hw.client_script),
      css: v(hw.css),
      link: v(hw.link),
    });
  }

  // Try fetching header as sp_header_footer which may embed widget fields
  if (headerHf[0]) {
    const h = headerHf[0];
    write('header-hf-scripts.json', {
      sys_id: v(h.sys_id),
      id: d(h.id),
      name: d(h.name),
      template: v(h.template),
      script: v(h.script),
      client_script: v(h.client_script),
      css: v(h.css),
      link: v(h.link),
      data_table: d(h.data_table),
      option_schema: v(h.option_schema),
    });
  }

  // Widgets named Appdirect / marketplace / customer created by psharma
  const customWidgets = await snGet(
    'sp_widget',
    'sysparm_query=nameLIKEappdirect^ORidLIKEappdirect^ORnameLIKEmarket^ORidLIKEcustomer_^ORsys_created_by=psharma^nameLIKEheader&sysparm_display_value=all&sysparm_fields=sys_id,id,name,description,sys_created_by,sys_created_on,sys_updated_on,sys_scope&sysparm_limit=100'
  );
  write('widgets-appdirect.json', customWidgets);

  // Catalogs
  const catalogs = await snGet(
    'sc_catalog',
    'sysparm_display_value=all&sysparm_fields=sys_id,title,description,active,sys_name&sysparm_limit=30'
  );
  write('catalogs-all.json', catalogs);

  // Categories that might be marketplace
  const cats = await snGet(
    'sc_category',
    'sysparm_query=titleLIKEmarket^ORtitleLIKEappdirect^ORtitleLIKEsoftware^ORtitleLIKEsas&sysparm_display_value=all&sysparm_limit=50'
  );
  write('catalog-categories.json', cats);

  // Login page walk
  console.log('Done deep dive');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
