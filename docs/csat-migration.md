# Moving the CSAT Survey Portal to another instance

Everything is defined in code under `servicenow/` and applied by the scripts in
`scripts/`. Migrating means pointing those scripts at the target instance and
running them; no update set is required.

The deploy scripts are idempotent — they look records up before creating them,
so re-running is safe.

## 1. Point at the target instance

Keep one credentials file per instance and select it with `ENV_FILE`:

```bash
cp env.example .env.target
ENV_FILE=.env.target npm run preflight:csat
```

```
SN_INSTANCE_URL=https://<target>.service-now.com
SN_USERNAME=<admin user>
SN_PASSWORD=<password>
```

The account needs `admin` (it writes to `sys_db_object`, `sys_dictionary`,
`sp_*`, `sysevent_*` and `sys_properties`).

Every deploy script prints the instance it is about to write to. Check that
line before letting it run — without `ENV_FILE` the scripts fall back to `.env`.

An integration (non-interactive) user can deploy over REST but cannot sign in
to the UI or Service Portal, so browser verification needs a normal account.

## 2. Check the target can host it

```bash
npm run preflight:csat
```

Blockers must be fixed first; warnings are informational.

| Check | Why it matters |
|-------|----------------|
| Service Portal plugin active | Theme and login page are inherited from the stock `/sp` portal |
| Survey definitions with questions | `SNC.AssessmentCreation` returns `noquestions` for empty definitions, so nothing sends |
| "Survey Invitation" notification | Delivers the assignment email |
| Companies and users with email | Otherwise a request has no recipients |
| Outbound email | The deploy enables `glide.email.smtp.active`, but SMTP still needs configuring |

## 3. Capture the work in an update set

```bash
ENV_FILE=.env.target npm run updateset:begin "CSAT Survey Portal"
```

This creates the set and makes it current for the deploying user, which is what
causes REST writes to be captured.

## 4. Deploy

```bash
ENV_FILE=.env.target npm run deploy:csat
```

Runs, in order:

1. `deploy-csat-app.js` — application menu, tables, columns, choices, script includes, business rule, scheduled job
2. `patch-csat-app.js` — re-pushes server-side scripts
3. `deploy-csat-portal.js` — widget, page, layout, portal, menu
4. `deploy-csat-notifications.js` — event, notifications, submission rule

Outbound email is left untouched. Once you are ready to actually deliver mail:

```bash
ENV_FILE=.env.target node scripts/deploy-csat-notifications.js --enable-email
```

## 5. Close the update set

```bash
ENV_FILE=.env.target npm run updateset:status     # review what was captured
ENV_FILE=.env.target npm run updateset:complete   # mark complete + print export URL
```

If anything landed outside the set — creating a scoped app, for example, makes
ServiceNow switch the current set — pull it back in:

```bash
ENV_FILE=.env.target npm run updateset:adopt "CSAT Survey Portal"
```

Everything is deployed to the **global** scope deliberately. A scoped
application gets its own Default update set that cannot be merged with a global
one, which would split the deployment across two sets, and it would also
prefix every table name with the scope.

## 6. Verify

```bash
ENV_FILE=.env.target npm run test:csat
```

Drives the portal in a browser and verifies assignment plus submission email for
templates with `notify_user` both enabled and disabled. Both scenarios must PASS.

The test sends to a single named recipient. Do not switch it to "all users" —
that emails every active employee of the selected company on each run.

## Plugin prerequisite for the report PDF export

The results report can export to PDF, Excel and CSV. Excel and CSV need nothing
beyond the platform; the PDF is rendered by **ServiceNow PDF Generation
Utilities** (`sn_pdfgeneratorutils`). Preflight reports whether it is active.

If the plugin is inactive the report itself and the Excel and CSV exports still
work — only the PDF button returns an error — so this is a warning rather than a
blocker. Activate the plugin from **System Definition > Plugins** on the target
if PDF export is required.

## What does not transfer

These are instance data or configuration, not application artifacts:

- **Companies and users** (`core_company`, `sys_user`) — existing target data is used
- **Survey definitions** (`asmt_metric_type` and their questions) — must already exist, or be moved separately via update set
- **Survey requests and execution history** — operational records, intentionally left behind
- **SMTP configuration** — instance-level email setup
- **`survey.link.whitelabel`** — the partner-to-domain map is business data
  maintained on each instance. The deploy never writes it. Where it is absent,
  survey links simply use the instance address
- **REST API base URI** — ServiceNow assigns the namespace per instance, so the
  path differs (for example `/api/2114022/csat_survey_api`). Scripts read it from
  the API definition rather than hardcoding it.

## Update sets on adcomsolutionsdev

| Set | Changes | State | Migrate? |
|---|---|---|---|
| **CSAT Survey Portal - COMPLETE v1.0** | **177** | Complete | **Yes — this one** |
| CSAT Survey Portal | 0 | Ignore | No |
| CSAT Survey Portal - Tweaks | 0 | Ignore | No |
| CSAT Survey Portal - Draft guard | 0 | Ignore | No |
| CSAT Survey Portal - Recipient picker | 0 | Ignore | No |
| CSAT Survey Portal - View request button | 0 | Ignore | No |
| CSAT Survey Portal - Requests page | 0 | Ignore | No |

The six working sets were consolidated into the COMPLETE set and marked Ignore.
They are empty and must not be migrated.

Export:
`/export_update_set.do?sysparm_sys_id=b9379cd52b62cf1007a3fa95b891bf80`

### Why consolidation was needed

Changes are captured against whichever set is current for the deploying user.
Two things caused drift across the build:

- Creating a scoped application switched the current set to that application's
  Default, so some changes were captured elsewhere.
- The latest `CSATSurveyService` — containing the Draft guard and the fix for
  falsely reported sends — had been captured only into **Default**. Migrating
  the named sets alone would have shipped an older version of the core logic.

`npm run updateset:adopt` and a consolidation pass moved everything into one
set. Records for temporary diagnostic REST endpoints were deleted so they
cannot be recreated on a target.

## Promoting via the exported update set

Once a deployment has been captured, later instances can be done with the XML
instead of the scripts:

1. Export from the source: **System Update Sets > Local Update Sets >
   CSAT Survey Portal > Export to XML**
2. On the target: **Retrieved Update Sets > Import Update Set from XML**
3. Preview, then Commit

The scheduled job (`sysauto_script`) is data rather than metadata and is not
captured in update sets, so re-create it on the target by running
`deploy-csat-app.js`, or add the record manually.
