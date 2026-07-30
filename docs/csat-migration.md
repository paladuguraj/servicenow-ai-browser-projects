# Moving the CSAT Survey Portal to another instance

Everything is defined in code under `servicenow/` and applied by the scripts in
`scripts/`. Migrating means pointing those scripts at the target instance and
running them; no update set is required.

The deploy scripts are idempotent — they look records up before creating them,
so re-running is safe.

## 1. Point at the target instance

```bash
cp env.example .env
```

```
SN_INSTANCE_URL=https://<target>.service-now.com
SN_USERNAME=<admin user>
SN_PASSWORD=<password>
```

The account needs `admin` (it writes to `sys_db_object`, `sys_dictionary`,
`sp_*`, `sysevent_*` and `sys_properties`).

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

## 3. Deploy

```bash
npm run deploy:csat
```

Runs, in order:

1. `deploy-csat-app.js` — tables, columns, choices, script includes, business rule, scheduled job
2. `patch-csat-app.js` — re-pushes server-side scripts
3. `deploy-csat-portal.js` — widget, page, layout, portal, menu
4. `deploy-csat-notifications.js` — event, notifications, submission rule, SMTP property

## 4. Verify

```bash
npm run test:csat
```

Drives the portal in a browser and verifies assignment plus submission email for
templates with `notify_user` both enabled and disabled. Both scenarios must PASS.

The test sends to a single named recipient. Do not switch it to "all users" —
that emails every active employee of the selected company on each run.

## What does not transfer

These are instance data or configuration, not application artifacts:

- **Companies and users** (`core_company`, `sys_user`) — existing target data is used
- **Survey definitions** (`asmt_metric_type` and their questions) — must already exist, or be moved separately via update set
- **Survey requests and execution history** — operational records, intentionally left behind
- **SMTP configuration** — instance-level email setup
- **REST API base URI** — ServiceNow assigns the namespace per instance, so the
  path differs (for example `/api/2114022/csat_survey_api`). Scripts read it from
  the API definition rather than hardcoding it.

## Scope note

Tables were created through the Table API and therefore live in the **global**
scope with a `u_` prefix (`u_x_csat_survey_request`). They are not a scoped
application, so an update set — not an application repository — is the
alternative distribution route if you prefer that over running the scripts.

## Alternative: update set

If the target instance is firewalled from your machine, capture the artifacts
into an update set on the source instance instead:

1. Create an update set and make it current
2. Add each artifact via **Unload / Add to Update Set** — see the artifact list
   in the pull request description
3. Export to XML, then import and commit on the target

Tables created via the Table API are not retroactively captured, so add
`sys_db_object` and `sys_dictionary` records explicitly. Running the scripts is
the more reliable path.
