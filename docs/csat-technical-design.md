# CSAT Survey Portal — Technical Design

**Version 1.0 · ServiceNow Service Portal · Global scope**

---

## 1. Purpose

Lets an internal user raise a Customer Satisfaction survey against a customer
account from a Service Portal page, choosing who receives it and when, while
the platform's own survey engine does the actual delivery and response
capture. Every send is written to an audit table.

The solution deliberately uses **native ServiceNow surveys**
(`asmt_metric_type` / `asmt_assessment_instance`) rather than a bespoke
questionnaire, so responses land in the standard assessment tables and are
available to the standard survey reporting.

---

## 2. Architecture

```
Service Portal  /csat
├── csat_home        → widget csat-survey-request    (raise a request)
└── csat_requests    → widget csat-survey-requests   (list all requests)
                              └── embeds widget-data-table

Widget server script
        │  (no REST hop; $sp server script calls the include directly)
        ▼
CSATSurveyService  ── script include, all business logic
        ├── SNC.AssessmentCreation      → creates asmt_assessment_instance
        └── CSATSurveyNotification      → fires notification events

Data
├── u_x_csat_survey_request        request header
├── u_x_csat_survey_request_user   recipients (M2M)
└── u_x_csat_survey_execution      per-recipient audit row

Automation
├── BR  CSAT Survey Request - Process on Submit   (request → active)
├── BR  CSAT Survey - Notify on Submission        (instance → complete)
└── Job CSAT Survey Request - Scheduled Runner    (daily, recurring sends)
```

Everything is created in the **global** scope. A scoped application was
deliberately avoided: it forces its own Default update set that cannot be
merged with a global one, and it prefixes every table name with the scope
(`x_csat_survey_u_x_csat_survey_request`), which breaks references.

---

## 3. Data model

### 3.1 `u_x_csat_survey_request`

| Column | Type | Notes |
|---|---|---|
| `u_number` | String | Reserved, not currently populated |
| `u_company` | Reference → `core_company` | Mandatory |
| `u_metric_type` | Reference → `asmt_metric_type` | Survey definition |
| `u_recipient_mode` | Choice | `primary_user`, `selected_users` |
| `u_schedule_frequency` | Choice | `immediate`, `every_30_days`, `every_60_days` |
| `u_state` | Choice | `draft`, `active`, `paused`, `completed`, `cancelled` |
| `u_next_run` | Date/Time | Next scheduled execution |
| `u_last_run` | Date/Time | Last execution |
| `u_requested_by` | Reference → `sys_user` | Who raised it |
| `u_notes` | String (4000) | Free text for audit |
| `u_active` | Boolean | Picked up by the scheduled job |

### 3.2 `u_x_csat_survey_request_user`

| Column | Type |
|---|---|
| `u_survey_request` | Reference → request |
| `u_user` | Reference → `sys_user` |

Both recipient modes write rows here. `getRecipients()` reads only this table,
so no code path can fan out to an entire company.

### 3.3 `u_x_csat_survey_execution`

| Column | Type | Notes |
|---|---|---|
| `u_survey_request` | Reference → request | |
| `u_user` | Reference → `sys_user` | Recipient |
| `u_metric_type` | Reference → `asmt_metric_type` | |
| `u_assessment_instance` | Reference → `asmt_assessment_instance` | Populated on success |
| `u_status` | Choice | `pending`, `success`, `failed`, `skipped` |
| `u_message` | String (4000) | Outcome detail |
| `u_scheduled_for` | Date/Time | |
| `u_executed_on` | Date/Time | Drives the cooldown |

One row per recipient per run. This is the audit record and the source of
truth for the 90-day rule.

> **Column naming.** ServiceNow prefixes new columns on a global custom table
> with `u_`. Choice lists must be attached to the stored name
> (`u_recipient_mode`), not the logical one, or the list view shows raw values.
> `deploy-csat-app.js` resolves the real column via `resolveElement()`.

---

## 4. Server logic — `CSATSurveyService`

| Method | Responsibility |
|---|---|
| `getCompanies(term, limit)` | Active companies (`u_active=true`), optional name search, capped |
| `getSurveyTemplates()` | Active surveys with `immediate_only` and `published` flags |
| `getPrimaryContact(companyId)` | Resolves `u_primary_billing_contact` (an email) to a user and validates them |
| `checkPortalAccount(userGr)` | Active, not locked out, not web-service-only, not integration, has email |
| `getCooldown(userId)` | Last successful send and days remaining in the 90-day window |
| `getUsersByCompany(companyId)` | Users with `eligible` / `reason` decorations |
| `createSurveyRequest(payload)` | Validates, writes request + recipients, activates |
| `executeRequest(requestId)` | Sends to each recipient, advances the schedule |
| `processDueRequests()` | Scheduled job entry point |
| `getRequestSummary(requestId)` | Result payload including per-recipient outcomes |
| `hasField(table, element)` | Dictionary probe so customer-specific fields are optional |

### 4.1 Survey creation

```js
var result = String(new SNC.AssessmentCreation()
    .createAssessments(metricTypeId, '', userId) || '');
var instanceId = result.split(',')[0];

if (!/^[0-9a-f]{32}$/.test(instanceId))
    return this._finalizeExecution(execId, 'failed',
        this._explainCreateFailure(result, metricTypeId));
```

Two behaviours worth knowing:

**The source record must be empty.** Passing the CSAT request `sys_id` as the
second argument makes the platform evaluate question conditions against the
metric type's own table, which does not match, and it returns `noquestions`.
An empty source still produces a distinct instance on each call, so recurring
schedules work.

**The return value is not always a sys_id.** It returns words such as
`noquestions` or `not_available` on failure. Anything that is not a 32-character
hex string that also resolves to a real record is treated as a failure and
translated into a readable message. Without this check a Draft survey silently
recorded a successful send that never happened.

### 4.2 Rules enforced server-side

| Rule | Enforcement |
|---|---|
| Company must be active | `getCompanies` filters `u_active=true` |
| Survey must be published | `createSurveyRequest` rejects Draft before writing anything |
| Immediate-only surveys | Frequency coerced to `immediate` for the two named surveys |
| Primary user eligibility | `getPrimaryContact` must return `eligible` |
| 90-day cooldown | `_sendSurveyToUser` re-checks per recipient at send time |

The UI applies the same rules for feedback, but the server is authoritative —
the scheduled job and any API caller pass through the same checks.

---

## 5. Notifications

| Trigger | Mechanism |
|---|---|
| Survey assigned | Platform dispatch rules fire `assign.send_survey` / `record.send_survey` when the instance reaches `ready`, driving the stock **Survey Invitation** notification |
| Survey assigned, `notify_user` off | `CSATSurveyNotification.notifyAssigned()` raises the event itself, so the portal always notifies |
| Survey submitted | BR on `asmt_assessment_instance` (state → `complete`, `trigger_table = u_x_csat_survey_request`) raises `csat.survey.submitted` |

Two notifications listen on `csat.survey.submitted`:

- **CSAT Survey Submitted - Thank You** → respondent (`recipient_fields = user`)
- **CSAT Survey Submitted - Requestor** → requestor (`event_parm_1 = true`)

> Both must have `generation_type = event`. The default `engine` value causes
> the notification engine to ignore `gs.eventQueue` events entirely: the event
> is marked processed and no email is produced.

> `GlideEmail` is not usable from the scoped/REST execution context — it throws
> `JavaAdapter requires at least one argument`. Notification records are used
> instead.

---

## 6. Portal widgets

### `csat-survey-request`

Server script exposes three actions — `searchCompanies`, `loadCompany`,
`createRequest` — and returns templates, schedule options and the cooldown
length on first load.

Client controller handles the debounced company typeahead (300 ms), the
recipient picker with filter and chips, schedule narrowing for immediate-only
surveys, a confirmation step showing the recipient count, and the post-submit
dialog.

### `csat-survey-requests`

Wraps `widget-data-table` via `$sp.getWidget()` rather than reusing the stock
`list` page.

> The stock page uses `data-table-from-url`, which hardcodes
> `data.show_new = true` with no option to disable it. `widget-data-table`
> reads `show_new` from its options, so embedding it and leaving that unset
> removes the stock **New** button. The page then supplies **New Survey
> Request**, which opens the request form instead of an empty record.

### `csat-survey-report`

Server script exposes `run` and `pdf`; both delegate to `CSATSurveyReport`.
`run` returns the result rows, the summary, the per-account and per-survey
breakdowns, and the Excel export URL for the filters just used.

Filter options are limited to surveys the portal is configured to send, read
from the same `csat.portal.survey_names` property as the request form, so the
report never offers a survey the portal cannot raise.

---

## 6.1 Report exports

The report exports to PDF, Excel and CSV. Each takes a different route because
each has a different constraint.

| Format | Produced by | Why |
|---|---|---|
| CSV | Browser, from rows already returned | No round trip and no re-query |
| Excel | Platform list exporter (`.do?XLSX`) | A genuine workbook, and it applies the caller's own read access |
| PDF | `sn_pdfgeneratorutils.PDFGenerationAPI` | Carries the summary and breakdowns, not just detail rows |

**Excel.** `CSATSurveyReport.getExcelUrl()` renders the active filters as an
encoded query and points the platform's own XLSX exporter at
`u_x_csat_survey_execution`. Nothing is assembled by hand, so the file is a real
`.xlsx` and the rows respect the reader's access to the underlying records.

The encoded query mirrors the in-script filtering, including the case where an
execution has no assessment instance at all:

```
u_status=success
  ^u_assessment_instance.state!=complete
  ^ORu_assessment_instanceISEMPTY
```

A dot-walked `!=` drops rows whose reference is empty, so the `ORISEMPTY` clause
is required for "awaiting reply" to match what the report shows on screen.

**PDF.** `generatePdf()` renders the same figures to HTML and converts them.
The generated file is attached to the requesting user's own `sys_user` record,
which keeps one person's exports out of everyone else's view, and each export
purges that user's previous one so attachments do not accumulate.

The download URL returned is `/api/now/attachment/<sys_id>/file` rather than
`/sys_attachment.do?sys_id=`, because the latter redirects to `navpage.do`
instead of serving the file. The REST endpoint responds with a
`Content-Disposition: attachment` header, so the client triggers it through a
hidden link and the report page stays put.

This is the only part of the solution that depends on a plugin. If **ServiceNow
PDF Generation Utilities** is inactive the report and the other two exports are
unaffected and the PDF button reports the failure. Preflight checks for it.

---

## 7. Scheduled processing

`CSAT Survey Request - Scheduled Runner` (daily) calls `processDueRequests()`,
which selects requests where `u_active = true`, `u_state = active` and
`u_next_run <= now`, then runs `executeRequest()` on each. After a run:

- `immediate` → state `completed`, `u_next_run` cleared
- `every_30_days` / `every_60_days` → `u_next_run` advanced, state stays `active`

The 90-day cooldown is applied on every run, so a 30-day recurring request will
skip recipients until they become eligible.

> `sysauto_script` is data rather than metadata, so the job is **not captured in
> update sets**. Create it on the target by running `deploy-csat-app.js`, or add
> it manually.

---

## 8. Deployment

Everything is defined in code under `servicenow/` and applied by idempotent
scripts in `scripts/`. Credentials come from `.env`, or another file via
`ENV_FILE`. Every deploy script prints its target before writing.

```bash
cp env.example .env.target
ENV_FILE=.env.target npm run preflight:csat
ENV_FILE=.env.target npm run updateset:begin "CSAT Survey Portal"
ENV_FILE=.env.target npm run deploy:csat
ENV_FILE=.env.target npm run updateset:complete
```

| Script | Creates |
|---|---|
| `deploy-csat-app.js` | Application menu, tables, columns, choices, script includes, business rule, scheduled job |
| `patch-csat-app.js` | Re-pushes server-side scripts |
| `setup-csat-rest-api.js` | Scripted REST API and its four operations |
| `deploy-csat-notifications.js` | Event, notifications, submission business rule |
| `deploy-csat-portal.js` | Widgets, pages, layout, portal, menu |

Outbound email is never enabled implicitly. Pass `--enable-email` to
`deploy-csat-notifications.js` when the target is ready to deliver mail.

### Update set capture

ServiceNow records changes against whichever set is current for the deploying
user, including REST writes. Two behaviours to watch:

- Creating a scoped application switches the current set to that application's
  Default. `npm run updateset:adopt` pulls stray changes back.
- Idempotent re-runs do not re-save unchanged records, so nothing new is
  captured. To rebuild a set, changes must be moved rather than re-deployed.

---

## 9. Dependencies and assumptions

| Dependency | Consequence if absent |
|---|---|
| Service Portal plugin | No theme to inherit; deploy fails |
| Survey definitions, **Published**, with questions | Sends return `not_available` / `noquestions` |
| Active notification on `assign.send_survey` or `record.send_survey` | No invitation email |
| `glide.email.smtp.active = true` | Notifications logged to `sys_email` but never delivered |
| `core_company.u_active` | Filter skipped; all companies listed |
| `core_company.u_primary_billing_contact` | Primary User mode reports it is not configured |
| Users with company and email | Requests produce no recipients |

The last two are customer-specific fields. `hasField()` probes the dictionary
first so the solution degrades cleanly on instances without them.

`npm run preflight:csat` checks all of the above and separates blockers from
warnings.

---

## 10. Known constraints

**Synchronous sending.** `executeRequest` sends in-line. Roughly 17 seconds for
143 recipients. Fine at current volumes; move to a background job if
significantly larger accounts are expected.

**Cooldown is portal-wide.** It counts any successful send from this portal for
that user, regardless of survey definition. A user cannot receive two different
CSAT surveys within 90 days.

**Primary contact is matched by email.** `u_primary_billing_contact` is a string.
If no `sys_user` has that email, the mode reports it cannot resolve. A reference
field would be more robust.

**Request numbering.** `u_number` exists but is not populated; records are
identified by sys_id in the UI.

**Integration users cannot be used for UI testing.** ServiceNow blocks them from
the portal with *"Only interactive users are allowed to access UI"*.
