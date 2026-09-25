#!/usr/bin/env node
/**
 * Walk every customer-portal page layout and dump widget sources.
 */
const fs = require('fs');
const path = require('path');
const { snGet, announceTarget } = require('./lib/sn-client');

const OUT = '/tmp/sn-portal';
const WIDGETS_DIR = path.join(OUT, 'widgets');
fs.mkdirSync(WIDGETS_DIR, { recursive: true });

const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const d = (x) => (x && typeof x === 'object' && 'display_value' in x ? x.display_value : x);

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
  console.log('Wrote', name);
}

async function getWidget(sysId) {
  const rows = await snGet('sp_widget', `sysparm_query=sys_id=${sysId}&sysparm_display_value=all`);
  return rows[0];
}

async function walkPage(pageSysId, pageId) {
  const structure = { pageSysId, pageId, containers: [] };
  const containers = await snGet(
    'sp_container',
    `sysparm_query=sp_page=${pageSysId}&sysparm_display_value=all&sysparm_orderby=order`
  );
  for (const c of containers) {
    const cObj = {
      sys_id: v(c.sys_id),
      name: d(c.name),
      order: Number(d(c.order) || 0),
      class_name: d(c.class_name),
      bootstrap_alt: d(c.bootstrap_alt),
      rows: [],
    };
    const rows = await snGet(
      'sp_row',
      `sysparm_query=sp_container=${v(c.sys_id)}&sysparm_display_value=all&sysparm_orderby=order`
    );
    for (const r of rows) {
      const rObj = { sys_id: v(r.sys_id), order: Number(d(r.order) || 0), class_name: d(r.class_name), columns: [] };
      const cols = await snGet(
        'sp_column',
        `sysparm_query=sp_row=${v(r.sys_id)}&sysparm_display_value=all&sysparm_orderby=order`
      );
      for (const col of cols) {
        const colObj = {
          sys_id: v(col.sys_id),
          order: Number(d(col.order) || 0),
          size: d(col.size),
          class_name: d(col.class_name),
          instances: [],
        };
        const instances = await snGet(
          'sp_instance',
          `sysparm_query=sp_column=${v(col.sys_id)}&sysparm_display_value=all&sysparm_orderby=order`
        );
        for (const inst of instances) {
          const widgetId = v(inst.sp_widget);
          let summary = null;
          if (widgetId) {
            const w = await getWidget(widgetId);
            const wid = d(w.id) || v(w.sys_id);
            summary = {
              sys_id: v(w.sys_id),
              id: d(w.id),
              name: d(w.name),
              description: d(w.description),
              data_table: d(w.data_table),
              public: d(w.public),
              roles: d(w.roles),
              category: d(w.category),
              sys_scope: d(w.sys_scope),
              sys_created_by: d(w.sys_created_by),
              sys_updated_on: d(w.sys_updated_on),
              option_schema: v(w.option_schema),
              lengths: {
                template: (v(w.template) || '').length,
                script: (v(w.script) || '').length,
                client_script: (v(w.client_script) || '').length,
                css: (v(w.css) || '').length,
                link: (v(w.link) || '').length,
              },
            };
            // Persist sources once
            const dir = path.join(WIDGETS_DIR, (wid || widgetId).replace(/[^a-zA-Z0-9_-]/g, '_'));
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(summary, null, 2));
              fs.writeFileSync(path.join(dir, 'template.html'), v(w.template) || '');
              fs.writeFileSync(path.join(dir, 'server.js'), v(w.script) || '');
              fs.writeFileSync(path.join(dir, 'client.js'), v(w.client_script) || '');
              fs.writeFileSync(path.join(dir, 'css.css'), v(w.css) || '');
              fs.writeFileSync(path.join(dir, 'link.js'), v(w.link) || '');
              fs.writeFileSync(path.join(dir, 'option_schema.json'), v(w.option_schema) || '[]');
              fs.writeFileSync(path.join(dir, 'demo_data.json'), v(w.demo_data) || '');
            }
          }
          colObj.instances.push({
            sys_id: v(inst.sys_id),
            title: d(inst.title),
            order: Number(d(inst.order) || 0),
            active: d(inst.active),
            class_name: d(inst.class_name),
            color: d(inst.color),
            glyph: d(inst.glyph),
            url: d(inst.url),
            size: d(inst.size),
            short_description: d(inst.short_description),
            options: v(inst.widget_parameters) || v(inst.options) || '',
            widget: summary,
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
  announceTarget('Walk customer portal pages');

  const MENU = '1024e0b33b6a3a54d91af97a25e45a73';
  const menuItems = await snGet(
    'sp_rectangle_menu_item',
    `sysparm_query=sp_rectangle_menu=${MENU}&sysparm_display_value=all&sysparm_limit=100`
  );
  // Sort by order numerically
  menuItems.sort((a, b) => Number(d(a.order) || 0) - Number(d(b.order) || 0));
  const menuTree = menuItems.map((i) => ({
    sys_id: v(i.sys_id),
    label: d(i.label) || d(i.name),
    order: Number(d(i.order) || 0),
    type: d(i.type),
    url: d(i.url),
    page: d(i.sp_page) || v(i.sp_page),
    page_sys_id: v(i.sp_page),
    parent: d(i.sp_rectangle_menu_item) || v(i.sp_rectangle_menu_item),
    parent_sys_id: v(i.sp_rectangle_menu_item),
    glyph: d(i.glyph),
    roles: d(i.roles),
    condition: d(i.condition) || v(i.condition),
    scripted_list: v(i.scripted_list_script) || v(i.script),
    active: d(i.active),
    raw_keys: Object.keys(i),
  }));
  write('menu-tree.json', menuTree);

  // Also dump full menu item records for scripted ones
  write('menu-items-full.json', menuItems);

  // Pages to walk: all related + enable/disable demo + login
  const pageIds = [
    'customer_homepage',
    'customer_locations',
    'customer_sites',
    'customer_circuits',
    'customer_hardware',
    'appdirect_cat_item',
    'appdirect_kb_home',
    'appdirect_kb_search',
    'macd_request_page',
    'macd_case',
    'sso_redirect',
    'sso_initiate',
  ];

  // Add demo page by sys_id
  const extraSysIds = ['429926443bb87210d91af97a25e45ad2'];

  const structures = [];
  const widgetIndex = {};

  for (const pid of pageIds) {
    const pages = await snGet('sp_page', `sysparm_query=id=${pid}&sysparm_display_value=all`);
    if (!pages[0]) {
      console.log('Missing page', pid);
      continue;
    }
    const p = pages[0];
    console.log('Walking', pid);
    const structure = await walkPage(v(p.sys_id), pid);
    structure.title = d(p.title);
    structure.short_description = d(p.short_description);
    structure.public = d(p.public);
    structure.roles = d(p.roles);
    structure.draft = d(p.draft);
    structure.sys_created_by = d(p.sys_created_by);
    structure.sys_updated_on = d(p.sys_updated_on);
    structures.push(structure);
    for (const c of structure.containers)
      for (const r of c.rows)
        for (const col of r.columns)
          for (const inst of col.instances)
            if (inst.widget?.id || inst.widget?.sys_id) {
              const key = inst.widget.id || inst.widget.sys_id;
              if (!widgetIndex[key]) widgetIndex[key] = { ...inst.widget, pages: [] };
              if (!widgetIndex[key].pages.includes(pid)) widgetIndex[key].pages.push(pid);
            }
  }

  for (const sid of extraSysIds) {
    const pages = await snGet('sp_page', `sysparm_query=sys_id=${sid}&sysparm_display_value=all`);
    if (!pages[0]) continue;
    const p = pages[0];
    const pid = d(p.id);
    console.log('Walking', pid);
    const structure = await walkPage(sid, pid);
    structure.title = d(p.title);
    structure.short_description = d(p.short_description);
    structure.public = d(p.public);
    structure.roles = d(p.roles);
    structures.push(structure);
  }

  write('page-structures.json', structures);
  write('widget-index.json', widgetIndex);

  // CSS includes detail
  const m2m = require('/tmp/sn-portal/theme-css-m2m_sp_theme_css_include.json');
  const cssDetails = [];
  for (const row of m2m) {
    const cid = v(row.sp_css_include);
    const css = await snGet('sp_css_include', `sysparm_query=sys_id=${cid}&sysparm_display_value=all`);
    cssDetails.push(css[0]);
    if (css[0]) {
      const name = d(css[0].name) || cid;
      const cssSysId = v(css[0].sp_css);
      if (cssSysId) {
        const spCss = await snGet('sp_css', `sysparm_query=sys_id=${cssSysId}&sysparm_display_value=all`);
        if (spCss[0]) {
          fs.writeFileSync(path.join(OUT, `theme-${name.replace(/\s+/g, '_')}.css`), v(spCss[0].css) || '');
        }
      }
      // Also url-based includes
      if (v(css[0].url)) console.log('CSS URL include:', d(css[0].name), v(css[0].url));
    }
  }
  write('theme-css-details.json', cssDetails);

  // Also grab header as widget sources into widgets dir
  const headerDir = path.join(WIDGETS_DIR, 'appdirect-header-generic');
  fs.mkdirSync(headerDir, { recursive: true });
  for (const f of ['template.html', 'server.js', 'client.js', 'css.css', 'link.js']) {
    const src = path.join(OUT, `header-${f.replace('.html', '').replace('.js', '').replace('.css', '')}.${f.split('.').pop()}`);
    // map names
  }
  fs.copyFileSync(path.join(OUT, 'header-template.html'), path.join(headerDir, 'template.html'));
  fs.copyFileSync(path.join(OUT, 'header-server.js'), path.join(headerDir, 'server.js'));
  fs.copyFileSync(path.join(OUT, 'header-client.js'), path.join(headerDir, 'client.js'));
  fs.copyFileSync(path.join(OUT, 'header-css.css'), path.join(headerDir, 'css.css'));
  fs.copyFileSync(path.join(OUT, 'header-link.js'), path.join(headerDir, 'link.js'));

  console.log('Done. Pages:', structures.length, 'Widgets:', Object.keys(widgetIndex).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
