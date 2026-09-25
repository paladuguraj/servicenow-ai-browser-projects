# Market Place Customer Portal — Functional Design

**Version 1.0 · Prepared for functional / UAT review**  
**Environment:** adcomsolutionstest · **Portal:** `/customer`  
**URL:** `https://adcomsolutionstest.service-now.com/customer`

---

## 1. Business summary

The Market Place Customer Portal is the customer-facing Managed Services
experience delivered inside ServiceNow and branded with the **company’s AppDirect
global header**. Customers who buy or manage services through the AppDirect
marketplace land in a familiar marketplace chrome (logo, account menu, marketplace
navigation) while still seeing Adcom operational data—cases, sites, circuits,
hardware, knowledge, and change (MACD) requests—from ServiceNow.

**Why it exists**

- Give marketplace customers one place to view service health and open work.
- Keep the **AppDirect global header** as the primary product identity (project
  main requirement).
- Avoid a separate custom shell: ServiceNow Service Portal pages host content;
  AppDirect supplies the global header and identity.

**Who it is for**

- External customer users (`snc_external`) and internal users (`snc_internal`)
  tied to a customer company account.
- Users authenticated through AppDirect (OIDC / SSO), not via a standalone
  local-only portal login.

---

## 2. Functional requirements

| ID | Requirement | Status on Test |
|---|---|---|
| FR-01 | Portal is reachable at URL suffix **`/customer`** | Met |
| FR-02 | Portal title is **Customer**; homepage is Customer Homepage | Met |
| FR-03 | Portal uses the **Appdirect Header Theme** with fixed navy navbar | Met |
| FR-04 | Every authenticated page mounts the **company AppDirect global header** into `#global-nav` | Met (design) |
| FR-05 | Global header loads from AppDirect (`global-header.js`) with marketplace remote URL | Met |
| FR-06 | Header logo returns users to `/customer` | Met |
| FR-07 | Header logout returns to the instance logout URL for that environment | Met |
| FR-08 | Login entry is **SSO initiate** (`sso_initiate`), not a local-only login page | Met |
| FR-09 | Users authenticate via **AppDirect OIDC** (AppdirectOIDC 2 / managed-services-servicenow) | Met |
| FR-10 | After SN login, portal obtains an AppDirect **marketplace JWT** for the header | Met |
| FR-11 | If marketplace user id and ServiceNow `u_marketplace_user_id` disagree, user is forced to re-auth | Met |
| FR-12 | Left sidebar shows Managed Services navigation (Home, Locations, Infrastructure, Connectivity, etc.) | Met |
| FR-13 | Homepage shows case KPIs: activity, resolution, priority summary | Met |
| FR-14 | Homepage shows annual case count chart | Met |
| FR-15 | Homepage shows a map of customer locations / health | Met |
| FR-16 | Locations page lists customer sites with filters | Partial — see §6 |
| FR-17 | Connectivity page lists circuits with filters and status visuals | Met |
| FR-18 | Infrastructure page lists hardware with filters and summary table | Met |
| FR-19 | Documents opens Knowledge home (browse knowledge bases) | Met |
| FR-20 | Knowledge search supports facets (rating, views, language, KB, author, modified, category, tags, resource) | Met |
| FR-21 | Catalog item page supports ordering / related items / related articles | Met |
| FR-22 | MACD request flow is available via AppDirect SC Catalog Item widget | Met |
| FR-23 | Network Insights deep-links to LogicMonitor (SAML) | Met |
| FR-24 | Case Insights menu entry is available (with TAO group exceptions) | Met |
| FR-25 | Demo enable/disable menu only for members of the designated demo group | Met |
| FR-26 | Data shown is scoped to the user’s company (and locations when visibility is limited) | Met |
| FR-27 | Remix / AppDirect styling is applied via theme CSS includes | Met |

---

## 3. Personas and access

| Persona | How they enter | What they see |
|---|---|---|
| Marketplace customer contact | AppDirect → SSO → `/customer` | Global header + Managed Services sidebar + company-scoped data |
| Internal operator with portal roles | Same SSO path (or existing SN session + JWT bootstrap) | Same chrome; company context from their user company |
| Unauthenticated visitor | Redirected to SSO / AppDirect login | No operational widgets |
| Demo operators | Extra sidebar item when in demo group | Enable/Disable Demo |

**Roles on content pages (typical):** `snc_external`, `snc_internal`  
**Homepage also allows:** `public`, `admin` (still behind portal auth in practice)

**Identity fields**

- ServiceNow: `sys_user.u_marketplace_user_id`
- AppDirect JWT: `sub` claim compared to marketplace user id in the header widget

---

## 4. User journeys

### 4.1 First login (happy path)

1. User opens `https://adcomsolutionstest.service-now.com/customer` (or marketplace deep link).
2. Portal login page **SSO Initiate** runs and sends the browser to ServiceNow SSO (`login_with_sso.do`) for the AppDirect identity provider.
3. User signs in at **AppDirect Catalog (Sandbox)**.
4. ServiceNow session is established.
5. Header detects missing marketplace JWT → **SSO Redirect** page starts OAuth authorize (`openid profile email company`).
6. Callback returns `?code=…` to `/customer?id=sso_redirect`.
7. Platform exchanges the code for an access token (stored in session) and redirects to `/customer`.
8. Header fetches JWT, injects `global-header.js`, and renders the AppDirect global header above the ServiceNow page body.
9. Sidebar shows Managed Services navigation; homepage KPIs and map load for the user’s company.

### 4.2 Identity mismatch

If the JWT subject does not match `u_marketplace_user_id`, the header forces logout and returns the user to SSO Initiate so the correct marketplace identity is used.

### 4.3 Browse operations

| Journey | Steps | Outcome |
|---|---|---|
| View service health home | Open Home | Charts, case summary, map |
| Find a site | Sidebar → Locations | Site list / map context |
| Review circuits | Sidebar → Connectivity | Filtered circuit list + status charts/tables |
| Review devices | Sidebar → Infrastructure | Filtered hardware list |
| Read docs | Sidebar → Documents | Knowledge base browser / search |
| Raise MACD | Catalog / MACD pages | Catalog item form in portal chrome |
| Open monitoring | Network Insights | External LogicMonitor UI |

---

## 5. Functional areas by page

### 5.1 Home — Managed Services dashboard

**Page:** `customer_homepage`

| Capability | Description |
|---|---|
| Case activity | Count of cases opened this month vs prior period for the company |
| Case resolution | Resolution performance over a recent window (incl. six-month context) |
| Case summary | Open cases by priority: Critical, High, Medium, Low + total |
| Annual case chart | Bar graph from configured graph template (Annual Case Count) |
| Location map | Leaflet map of customer locations with health context |
| Login guard | Soft check that the session is authenticated |

### 5.2 Locations / Sites

**Pages:** `customer_locations`, `customer_sites`

| Capability | Description |
|---|---|
| Page title + breadcrumbs | Standard portal chrome |
| Site listing | Customer locations for the account (Adcom Sites / Appdirect Locations family) |
| Filters | City / state / country and health status (up, down, degraded, cellular) where Appdirect Locations is used |
| Pagination | Server-side page size (default 10–12) |
| Visibility | Full company list vs single user location depending on session rights |

**Functional note (Test):** The `customer_locations` page layout currently has an inactive/empty primary widget slot. The menu also exposes `customer_sites` (and LogicMonitor-gated Locations). UAT should confirm which Locations entry is the intended production path.

### 5.3 Connectivity (Circuits)

**Page:** `customer_circuits`

| Capability | Description |
|---|---|
| Circuit list + filter | Browse company circuits |
| Stacked bar | Visual status breakdown |
| Summary tables | Multiple template-driven tables beside the list |

Legacy menu entry **Circuits** (old page) remains for LogicMonitor-conditioned audiences.

### 5.4 Infrastructure (Hardware)

**Page:** `customer_hardware`

| Capability | Description |
|---|---|
| Hardware list + filter | Browse company hardware |
| Summary table | Side analytics table |

Legacy **Hardware** menu entry remains for LogicMonitor-conditioned audiences.

### 5.5 Documents (Knowledge)

| Page | Capability |
|---|---|
| `appdirect_kb_home` | Browse knowledge bases |
| `appdirect_kb_search` | Search with rich facets |

### 5.6 Catalog and MACD

| Page | Capability |
|---|---|
| `appdirect_cat_item` | View/order catalog item; related items; related KB articles; scroll-to-top |
| `macd_request_page` | MACD request experience using AppDirect SC Catalog Item widget |
| `macd_case` | Convenience redirect into monitor portal MACD request page |

### 5.7 Navigation chrome

| Element | Function |
|---|---|
| AppDirect global header | Marketplace identity, logo home, logout, marketplace nav |
| AppDirect sidebar menu | In-portal Managed Services links with custom icons |
| Case Insights | Entry reserved for case insight experience; hidden for some TAO Managed SBC-only users |
| Network Insights | Leaves ServiceNow for LogicMonitor |
| Links | Scripted/additional links bucket |
| Enable/Disable Demo | Admin/demo-only |

---

## 6. Business rules (plain language)

1. **You only see your company’s data.** Case widgets and inventory lists resolve the user’s company (and related companies where helpers expand the list).
2. **Some users only see their own location.** When full visibility is off, location queries are pinned to the user’s location.
3. **Marketplace identity wins.** The global header will not stay up if the AppDirect user and the ServiceNow marketplace user id do not match.
4. **No JWT, no header session.** Missing marketplace token sends the user through SSO Redirect before content chrome is considered complete.
5. **Legacy vs new inventory pages.** LogicMonitor utility methods decide whether older Hardware/Circuits/Locations menu items appear alongside the new Customer portal pages.
6. **Demo tooling is restricted** to a specific group membership.

---

## 7. Non-functional expectations

| Area | Expectation |
|---|---|
| Branding | AppDirect global header is mandatory chrome; ServiceNow theme matches navy header bar |
| Performance | List widgets paginate; graph/map widgets load asynchronously in the portal |
| Security | OIDC + session tokens; no anonymous operational data; secrets not exposed to the browser beyond JWT flow |
| Environments | Test uses AppDirect **sandbox** catalog; production hosts switch via hostname checks in widgets |
| Observability | Optional DataDog RUM (property-gated; Test short-circuits in current client code) |

---

## 8. UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | Open `/customer` while logged out | Redirect into AppDirect / SSO login |
| 2 | Complete SSO | Land on Customer Homepage with AppDirect header visible |
| 3 | Confirm header logo | Returns to `/customer` |
| 4 | Confirm header logout | Ends session per environment logout URL |
| 5 | Homepage KPIs | Numbers reflect the tester’s company cases |
| 6 | Homepage map | Pins/locations for the company render |
| 7 | Sidebar → Connectivity | Circuits list + charts for company |
| 8 | Sidebar → Infrastructure | Hardware list for company |
| 9 | Sidebar → Locations / Sites | Site list usable; confirm which menu item is canonical |
| 10 | Documents | Knowledge bases browse works |
| 11 | Knowledge search facets | Facets filter results |
| 12 | Network Insights | Opens LogicMonitor with sandbox domain context |
| 13 | Wrong marketplace linkage | Forced re-auth when ids differ |
| 14 | MACD request | Catalog form opens in portal (or via macd_case redirect path) |
| 15 | Demo menu | Visible only to demo group members |

---

## 9. Out of scope / related portals

This document covers only the **Customer** portal (`url_suffix=customer`) for the Market Place project.

Related but separate portals on the same instance (not documented here): Management Portal (`/service`), Employee Center (`/esc`), CSAT (`/csat`), Partner portals, Monitor (`/monitor`), etc.

---

## 10. Open functional questions for stakeholders

1. Which Locations experience is production: `customer_locations`, `customer_sites`, or LM-gated entry?
2. Should legacy Hardware/Circuits menu items be removed once LM cutover is done?
3. Is Case Insights meant to open a specific page (currently `javascript:void(0)`)?
4. Should production `remoteMarketUrl` point at production catalog (`catalog.appdirect.com`) rather than sandbox (code currently references sandbox on all hosts)?

---

*Documented from ServiceNow configuration on adcomsolutionstest (portal, pages, widgets, menu, auth) on 2026-09-25. Interactive UAT of authenticated chrome requires AppDirect sandbox login; Table API inventory is complete.*
