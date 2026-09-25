# Market Place Customer Portal — Technical Design

**Version 1.0 · ServiceNow Service Portal · Environment: adcomsolutionstest**  
**Portal URL:** `https://adcomsolutionstest.service-now.com/customer`  
**Scope:** Global (portal, theme, header, pages, and AppDirect widgets)

---

## 1. Purpose

This document describes the technical design of the **Customer** Service Portal
(`/customer`) built for the Market Place (AppDirect) project on the Adcom Test
instance.

The portal is a customer-facing Managed Services experience that embeds the
**company’s AppDirect global header** as the primary chrome, while ServiceNow
Service Portal pages and widgets deliver operational content (cases, locations,
circuits, hardware, knowledge, and catalog/MACD flows).

Primary technical goals:

1. Host a Service Portal under URL suffix `customer`.
2. Mount the AppDirect **global header** (`global-header.js`) on every authenticated page.
3. Synchronize the ServiceNow user with the AppDirect marketplace user via OAuth/OIDC + JWT.
4. Reuse company-scoped operational widgets (cases, inventory, maps) behind that chrome.

---

## 2. Architecture

```
Browser
  │
  ├─ AppDirect Catalog (sandbox)     catalogsandbox.byappdirect.com
  │     OAuth authorize / token / JWT / global-header.js
  │
  └─ ServiceNow Portal /customer
        │
        ├── Theme: Appdirect Header Theme
        │     └── Header: Appdirect Header Generic  (#global-nav mount)
        │           ├── embeds widget appdirect-sidebar-pane
        │           └── loads AppDirect global-header.js
        │
        ├── Menu: Appdirect Customer Menu  (sp_rectangle_menu)
        │     └── rendered by appdirect-sidebar-menu
        │
        ├── Pages (id=…)
        │     customer_homepage | customer_locations | customer_sites
        │     customer_circuits | customer_hardware
        │     appdirect_kb_home | appdirect_kb_search | appdirect_cat_item
        │     macd_request_page | macd_case
        │     sso_initiate | sso_redirect
        │
        ├── Script Includes
        │     fetchAppdirectJWT | AppdirectPortalUtils | AppdirectPaginationUtils
        │     CustomerPortalUtils | NewRocketUtils
        │
        └── Scripted REST
              /api/admso/appdirectheader/fetchjwt
```

### 2.1 Portal record

| Field | Value |
|---|---|
| Title | Customer |
| URL suffix | `customer` |
| sys_id | `1098d4a23bae7a14d91af97a25e45a54` |
| Homepage | `customer_homepage` |
| Login page | `sso_initiate` |
| Theme | Appdirect Header Theme (`9623b07f3bea3a54d91af97a25e45a6c`) |
| Main menu | Appdirect Customer Menu (`1024e0b33b6a3a54d91af97a25e45a73`) |
| Search application | Service Portal Default Search Application |
| Package / scope | Global |
| Created | 2026-01-22 by `psharma` |

---

## 3. Global header (main requirement)

### 3.1 Theme and header binding

| Component | Record | Notes |
|---|---|---|
| Theme | `sp_theme` **Appdirect Header Theme** | `navbar_fixed=true`; CSS variables for navy navbar `#01174B` / `#01174B` rgba |
| Header | `sp_header_footer` **Appdirect Header Generic** (`id=appdirect-header-generic`) | Roles: `snc_external`, `snc_internal` |
| CSS includes | Appdirect Styles + Remix Icons CDN | Linked via `m2m_sp_theme_css_include` |
| Footer | None configured on this theme | |

Theme CSS variables (excerpt):

- `$navbar-inverse-bg` / `$nr-navbar-header-bg`: `rgba(1, 23, 75, 1)`
- `$navbar-height`: `65px`
- `$body-bg`: `#f2f3f6`
- Sidebar width variables for AppDirect/NewRocket side panes: `314px`

### 3.2 Header widget structure

**Template** mounts:

1. Nested widget `appdirect-sidebar-pane` (ServiceNow left nav / Managed Services menu).
2. DOM target `<div id="global-nav"></div>` where AppDirect’s remote header is rendered.

**Server script** responsibilities:

- Read system property `x_admso_adcom_serv.enable_datadog` (DataDog RUM gate).
- Call `new fetchAppdirectJWT().fetchAppdirectJWT()` to obtain a marketplace JWT for the session.
- Decode JWT payload (`sub`) → `data.appdirect_user_id`.
- Load `sys_user.u_marketplace_user_id` for the logged-in user → `data.snow_user_id`.
- Call `NewRocketUtils.setUsersCompany(gs.getUser().getCompanyID())` for company context.

**Client script** responsibilities:

1. **Identity guard** — if AppDirect user id ≠ ServiceNow marketplace user id (and page is not SSO), force logout redirect to `/customer?id=sso_initiate`.
2. **JWT presence guard** — if no JWT and page is not `sso_redirect`, redirect to `/customer?id=sso_redirect`.
3. **`window.ad_global_header_config`** — environment-specific config before loading the remote script:

| Host | `remoteMarketUrl` | Logout href | JWT endpoint |
|---|---|---|---|
| `adcomsolutionstest.service-now.com` | `https://catalogsandbox.byappdirect.com` | `/logout` on Test instance | `/api/admso/appdirectheader/fetchjwt` |
| `managedservices.appdirect.com` | same sandbox catalog | managedservices logout | same API path |
| `adcomsolutions.service-now.com` | same sandbox catalog (as coded) | prod instance logout | same API path |

Config flags used:

- `useFeJwt: true`
- `header.renderTo: "#global-nav"`
- `customizations.logo.href: "/customer"`
- `setReferrerPolicy: 'strict-origin-when-cross-origin'`

4. Dynamically inject:

```text
https://catalogsandbox.byappdirect.com/global-header/global-header.js
```

### 3.3 Supporting sidebar widgets

| Widget id | Name | Role |
|---|---|---|
| `appdirect-sidebar-pane` | Appdirect Sidebar Pane | Loads the portal’s rectangle-menu instance (or a configured widget) into the left pane |
| `appdirect-sidebar-menu` | AppDirect Sidebar Menu | Builds menu from `$sp.getMenuItems(menu_id)`, applies SVG icons per label, LogicMonitor session flags, TAO group visibility for Case Insights |
| *(no id)* | AppDirect Sidebar Monitor Menu | Alternate/monitor menu variant |

`appdirect-sidebar-pane` server logic:

```javascript
var menu = $sp.getPortalRecord().getValue("sp_rectangle_menu");
data.widget = $sp.getWidgetFromInstance(menu);
```

---

## 4. Authentication and identity

### 4.1 End-to-end flow

```
User hits /customer
        │
        ▼
Portal login_page = sso_initiate
        │  (iss query param from AppDirect)
        ▼
ServiceNow SSO  login_with_sso.do?glide_sso_id=<test SSO id>
        │
        ▼
OIDC via AppdirectOIDC 2  (oauth_entity)
  authorize → catalogsandbox.byappdirect.com
  token     → catalogsandbox.byappdirect.com/oauth2/token
        │
        ▼
Header needs marketplace JWT
        │
        ▼
/customer?id=sso_redirect
  → OAuth authorize (openid profile email company)
  → callback with ?code=
  → GlideAjax fetchAppdirectJWT.fetchauthcode_test(code)
  → session property appdirect_authcode = access_token
  → redirect /customer
        │
        ▼
Header server: fetchAppdirectJWT() exchanges access_token for JWT
Header client: loads global-header.js with useFeJwt + fetchjwt API
```

### 4.2 SSO / OIDC records (Test)

| Item | Value |
|---|---|
| Portal login page | `sso_initiate` |
| Test `glide_sso_id` (in widget) | `c8f7ebd33bc7fa50d91af97a25e45a2e` |
| OAuth OIDC Entity | **AppdirectOIDC 2** (`7fe7ebd33bc7fa50d91af97a25e45a06`) |
| Client id | `managed-services-servicenow` |
| Auth URL | `https://catalogsandbox.byappdirect.com/oauth2/authorize` |
| Token URL | `https://catalogsandbox.byappdirect.com/oauth2/token` |
| Redirect URL | `https://adcomsolutionstest.service-now.com/navpage.do` |
| Grant type | Authorization Code |
| User field | `sys_user.u_marketplace_user_id` (Marketplace User ID, String 50) |

> Client secrets exist in `fetchAppdirectJWT` per-environment methods. They must remain in the instance (or a secure vault), not in documentation or source control.

### 4.3 Script include `fetchAppdirectJWT`

Client-callable GlideAjax processor with methods:

| Method | Purpose |
|---|---|
| `fetchAppdirectJWT` | POST `…/oauth2/token/jwt` with Bearer = session `appdirect_authcode` |
| `fetchauthcode` | Prod code→token exchange |
| `fetchauthcode_test` | Test code→token exchange |
| `fetchauthcode_managedservices` | Managed-services host exchange |

Session key written: `appdirect_authcode`.

### 4.4 Scripted REST API

| Service | Base URI | Operation |
|---|---|---|
| `appdirectheader` | `/api/admso/appdirectheader` | `POST /fetchjwt` → calls `fetchAppdirectJWT().fetchAppdirectJWT()` and streams JSON body |

Used by `feJwtURL` in the global header config.

### 4.5 SSO pages / widgets

| Page id | Widget | Behavior |
|---|---|---|
| `sso_initiate` | `sso_initiate` | Reads `iss`; redirects to `login_with_sso.do` with environment-specific `glide_sso_id` |
| `sso_redirect` | `sso_redirect` | If no `code`, starts AppDirect OAuth authorize; if `code` present, GlideAjax token exchange then `/customer` |

---

## 5. Pages

All pages below are part of the Market Place Customer portal surface. Machine-readable inventory: `docs/reference/customer-portal-page-inventory.json`.

### 5.1 `customer_homepage` — Customer Homepage

| Attribute | Value |
|---|---|
| Public | true |
| Roles | `snc_external`, `snc_internal`, `public`, `admin` |
| Layout | Two containers |

| Order / width | Widget | Purpose |
|---|---|---|
| C2 / 12 | `ad-login` | Ensures user is logged in; redirects host root if not |
| C1 / 4 | `appdirect_bar_graph_v3` | Annual case count graph (`u_graph_templates` GPH0001135) |
| C1 / 4 | `case_resolution` | Resolution SLA / within-window metrics for user’s company |
| C1 / 4 | `case_activity` | Month-over-month opened case activity for user’s company |
| C1 / 12 | Appdirect Leafleft Map - Customer | Leaflet map of company locations / health |
| C1 / 12 | `case_summary_portal` | Open case counts by priority (Critical/High/Medium/Low) via `CustomerPortalUtils` |

### 5.2 `customer_locations` — Locations

| Attribute | Value |
|---|---|
| Public | true |
| Roles | `snc_external`, `snc_internal` |
| Widgets | `breadcrumbs`, `nr-title` |
| Note | Primary list widget instance is currently **inactive / unbound** on Test; menu also links to `customer_sites` |

### 5.3 `customer_sites` — Customer Locations

| Attribute | Value |
|---|---|
| Public | true |
| Roles | `snc_external`, `snc_internal` |
| Widgets | `breadcrumbs`, `nr-title`, **Copy of Adcom Sites** |

Menu condition (alternate Locations entry):

```javascript
javascript: new x_admso_adcom_serv.LogicMonitorDashboardUtils().isLocations() && …
```

### 5.4 `customer_circuits` — Circuits (Connectivity)

| Attribute | Value |
|---|---|
| Public | true |
| Roles | `snc_external`, `snc_internal` |

| Widget | Purpose |
|---|---|
| `nr-title`, `breadcrumbs` | Page chrome |
| Customer Circuit List Filter | Filter controls (12 results/page default) |
| Appdirect Circuits List | Paginated circuit inventory |
| `adcom-stacked-bar-graph` | Status stacked bar (graph template driven) |
| `adcom-table` ×4 | Summary tables bound to graph/table template records |

### 5.5 `customer_hardware` — Hardware (Infrastructure)

| Attribute | Value |
|---|---|
| Public | false |
| Roles | `snc_external`, `snc_internal` |

| Widget | Purpose |
|---|---|
| `nr-title`, `breadcrumbs` | Page chrome |
| `customer-hardware-list-filter` | Filters |
| `customer-hardware-list` | Hardware inventory list |
| `adcom-table` | Side summary table |

### 5.6 Knowledge

| Page | Widgets |
|---|---|
| `appdirect_kb_home` | `kb-bases-browse` (“Explore our Knowledge Bases”) |
| `appdirect_kb_search` | Fixed facet header + facets: rating, view count, language, KB, author, modified, category, tags, resource |

### 5.7 Catalog / MACD

| Page | Widgets | Notes |
|---|---|---|
| `appdirect_cat_item` | `widget-sc-cat-item-v2`, `sc_scroll_to_top`, `related_catalog_item`, `kb_related_articles` | Standard SP catalog item experience branded for AppDirect portal |
| `macd_request_page` | `appdirect-sc-catalog-item` | MACD request catalog item renderer |
| `macd_case` | Redirect to MACD | Client redirects to `/monitor?id=macd_request_page&sys_id=…` |

### 5.8 SSO pages

See §4.5 (`sso_initiate`, `sso_redirect`).

---

## 6. Navigation menu

**Menu:** Appdirect Customer Menu (`1024e0b33b6a3a54d91af97a25e45a73`)  
Source: `docs/reference/customer-portal-menu.json`

| Order | Label | Type | Target | Condition / notes |
|---|---|---|---|---|
| 100 | Home / Managed Services | Page | `customer_homepage` | Dual labels present |
| 200 | Locations | URL | `?id=customer_locations` | Unconditional |
| 200 | Locations | URL | `?id=customer_sites` | LogicMonitor `isLocations()` |
| 300 | Infrastructure | Page | `customer_hardware` | Current |
| 300 | Hardware | Page | `ad_hardware_old_31_10_2024` | Legacy; LogicMonitor `isHardware()` |
| 400 | Connectivity | Page | `customer_circuits` | Current |
| 400 | Circuits | Page | `ad_circuits_old_31_10_2024` | Legacy; LogicMonitor `isCircuits()` |
| 450 | Case Insights | URL | `javascript:void(0)` | Visibility adjusted in sidebar for TAO groups |
| 500 | Network Insights | URL | LogicMonitor SAML URL (`nocportal.logicmonitor.com`, sandbox domain) | External |
| 1000 | Documents | URL | `?id=appdirect_kb_home` | Knowledge |
| 9999 | Links | Scripted List / URL | — | Extensible link list |
| 10000 | Enable/Disable Demo | Page | (demo page sys_id) | Only if user is member of group `b207a2403bb87210d91af97a25e45a14` |

---

## 7. Widgets (custom / AppDirect)

Key custom widgets (full index: `docs/reference/customer-portal-widgets.json`):

| id / name | Used on | Server role |
|---|---|---|
| `appdirect-header-generic` | Theme header | JWT + global header bootstrap |
| `appdirect-sidebar-pane` / `appdirect-sidebar-menu` | Header | Menu chrome |
| `appdirect_bar_graph_v3` | Homepage | Graph template rendering |
| Appdirect Leafleft Map - Customer | Homepage | Map + location health |
| `case_activity` / `case_resolution` / `case_summary_portal` | Homepage | Case KPIs for `gs.getUser().getCompanyID()` |
| Appdirect Locations (+ filter) | Locations flows | Paginated `cmn_location` via `AppdirectPaginationUtils` |
| Appdirect Circuits List + filter | Circuits | Circuit inventory |
| `customer-hardware-list` (+ filter) | Hardware | Hardware inventory |
| `appdirect-sc-catalog-item` | MACD | Catalog item (fork of SC item) |
| `adcom-table` / `adcom-stacked-bar-graph` | Circuits / Hardware | Template-driven analytics |
| `sso_initiate` / `sso_redirect` | Auth | OAuth/SSO orchestration |
| `customer-registration` | (available) | Registration helper (not on core pages walked) |

### 7.1 Data access patterns

- **Company scoping:** `NewRocketUtils.getUsersCompany()` / `CustomerPortalUtils.getUsersCompanies()` / `gs.getUser().getCompanyID()`.
- **Cases:** `sn_customerservice_case` filtered by company.
- **Locations:** `cmn_location` with health fields `u_hardware_health_status`, `u_cellular_status`, `u_status`.
- **Pagination:** `AppdirectPaginationUtils.getPaginatedResults(paramObj)`.
- **Visibility:** session full-visibility vs single-location (`AppdirectPortalUtils.getUserLocation`).
- **Feature flags:** `x_admso_adcom_serv.LogicMonitorDashboardUtils` for legacy vs new menu entries.

### 7.2 Script includes

| API name | Role |
|---|---|
| `global.fetchAppdirectJWT` | OAuth code exchange + JWT fetch (Ajax) |
| `global.AppdirectPortalUtils` | Location/company aggregates, coordinates, case counts by location |
| `global.AppdirectPaginationUtils` | Shared pagination for location/circuit/hardware lists |
| `global.CustomerPortalUtils` | Open case status counts by company; multi-company helpers |
| `global.NewRocketUtils` | Company session helpers used across NewRocket-derived widgets |
| `x_admso_adcom_serv.LogicMonitorDashboardUtils` | Menu conditions for LM-backed dashboard variants |

---

## 8. Styling

| Asset | Purpose |
|---|---|
| Theme CSS variables | Navy fixed header, light gray body, link/sidebar tokens |
| **Appdirect Styles** (`sp_css`) | Portal-specific overrides (~5.3 KB) |
| Header widget CSS | Header/sidebar layout (~5.5 KB) |
| Remix Icons CDN | Icon font for menu/UI |

---

## 9. Environment matrix

| Concern | Test (`adcomsolutionstest`) | Notes |
|---|---|---|
| Portal URL | `/customer` | Also intended on `managedservices.appdirect.com` custom domain |
| AppDirect catalog | `catalogsandbox.byappdirect.com` | Sandbox |
| OIDC client | `managed-services-servicenow` / AppdirectOIDC 2 | |
| Header JWT API | `/api/admso/appdirectheader/fetchjwt` | Global scope REST |
| DataDog RUM | Gated by property; Test branch currently returns early in client | |

---

## 10. Package / update-set guidance

- Portal, theme, header, pages, and AppDirect-named widgets are in **Global**.
- Related utilities also live in scoped app **ADCom Service Portal** (`x_admso_adcom_serv`) for LogicMonitor menu conditions and properties.
- When promoting: include portal + theme + header + menu + pages + widgets + script includes + scripted REST + OAuth entity configuration (secrets handled per target).

---

## 11. Known technical observations (Test)

1. `customer_locations` has an unbound/inactive widget instance; functional Locations UX is primarily on `customer_sites` / Appdirect Locations widgets.
2. Menu contains both **current** and **legacy** Hardware/Circuits entries gated by LogicMonitor utils.
3. Global header will not render without a valid AppDirect session JWT; unauthenticated hits fall through to SSO.
4. `macd_case` immediately redirects into the **monitor** portal for the MACD catalog item.
5. OAuth client secrets are embedded in `fetchAppdirectJWT` — treat as sensitive; rotate via secure change process.

---

## 12. Reference artifacts

| File | Contents |
|---|---|
| `docs/reference/customer-portal-page-inventory.json` | Pages → widget layout |
| `docs/reference/customer-portal-widgets.json` | Widget index with sizes/pages |
| `docs/reference/customer-portal-menu.json` | Menu items |

---

*Documented from ServiceNow Table API inspection of adcomsolutionstest on 2026-09-25.*
