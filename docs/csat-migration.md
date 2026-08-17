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
- **`CSAT Test Probe`** — a Scripted REST API used only by the check scripts to
  call server-side code. It is created on demand by `scripts/lib/probe.js`, is
  not part of the solution, and is deliberately excluded from the set

## The update set to move

There is one, and it is the only CSAT Survey Portal set left in **Complete**
state on adcomsolutionsdev:

> ### CSAT Survey Portal - ALL CHANGES v2.0
> 117 changes · `cdf1ea853b7a8750c4e908ac24e45a64`

It holds the solution as it stands and nothing else: the portal and its three
pages and widgets, the three tables with their columns, labels and choice
lists, the three script includes, both business rules, the scheduled job, the
event and notifications, the mail scripts, and both survey definitions with the
two questions each actually asks.

| | |
|---|---|
| Application menu and modules | 3 |
| Tables, columns, labels, choices | 53 |
| Script includes | 3 |
| Business rules | 2 |
| Scheduled job | 1 |
| Event and notifications | 7 |
| Mail scripts | 3 |
| Portal, pages, widgets, menu, layout | 25 |
| System properties | 2 |
| Survey definitions, questions, choices | 18 |

Every entry is an insert or update of a record that exists and is in use. There
are no deletions and no superseded artefacts.

Every other `CSAT Survey Portal` set is now **Ignore**. Their contents are
preserved, so setting one back to Complete restores it, but none of them should
be migrated — everything they held is in the set above.

> The instance also carries older CSAT work belonging to the customer
> (`SE-740_CSAT Survey edits_CC` and similar, 14 sets). Those are unrelated to
> this project and were left alone.

### Moving it

1. On the source: **System Update Sets > Local Update Sets >
   CSAT Survey Portal - ALL CHANGES v2.0 > Export to XML**
2. On the target: **Retrieved Update Sets > Import Update Set from XML**
3. Open the retrieved set, **Preview**, resolve any collisions, then **Commit**

Read [what does not transfer](#what-does-not-transfer) first — companies, users,
SMTP and `survey.link.whitelabel` are instance data and are not in the set.

### Rebuilding the consolidated set

If more changes are made, re-run:

```bash
ENV_FILE=.env.adcom node scripts/consolidate-update-set.js --dry-run
ENV_FILE=.env.adcom node scripts/consolidate-update-set.js --retire-sources
```

It reads every `CSAT Survey Portal` set, keeps the newest version of each
record, and rebuilds the target set from scratch, so it is safe to run
repeatedly. Source sets are only read, never emptied.

The build went through several changes of direction, and the sets captured
every step. These are left out so the target receives only what is in use:

- **Anything whose final state is a deletion.** The record does not exist here,
  and on a fresh target there is nothing to delete. This covers the portal
  layout churn (placing a widget deletes and recreates the containers, rows and
  columns, so each re-deploy left a delete behind), the orphaned choice lists
  from the `u_`-prefix defect, and the two mail scripts that were superseded by
  extending the customer's own.
- **Superseded survey questions.** The surveys started with five questions,
  then one, then two. The retired questions were deactivated rather than
  deleted here, because answers recorded against them during testing would have
  gone with them. A target has no such history, so it receives only the two
  questions each survey asks and their answer choices.
- **The original UI Page build.** `CSATSurveyAjax` and the `CSAT Survey API`
  with its four resources served the first implementation, which was replaced
  by the Service Portal. Nothing referenced them any more, so they were deleted
  from the instance and the repository as well as from the set.
- **Temporary diagnostic endpoints** created while debugging.
- **Records that no longer exist here**, which would otherwise be recreated on
  the target.

The scheduled job needs the opposite treatment. ServiceNow treats
`sysauto_script` as data, so editing it is never captured; the script pushes it
in through `GlideUpdateManager2`, the same API behind the **Add to Update Set**
action. Without that step the 30 and 60-day schedules would never run on the
target.

### Why consolidation was needed

Changes are captured against whichever set is current for the deploying user,
and the work ran across a dozen sets as it was built. Two things also caused
drift:

- Creating a scoped application switched the current set to that application's
  Default, so some changes were captured elsewhere.
- The latest `CSATSurveyService` — containing the Draft guard and the fix for
  falsely reported sends — had at one point been captured only into **Default**,
  so migrating the named sets alone would have shipped older core logic.
