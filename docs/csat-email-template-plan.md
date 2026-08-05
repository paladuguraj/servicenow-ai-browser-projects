# CSAT Survey Invitation Email — Plan of Action

**Setting up the invitation template and the survey link**
**Environment: adcomsolutionsdev · Version 1.1 — implemented**

> **Status: built and verified.** The invitation now follows the same pattern as
> the existing case survey email and links to the Service Portal. Outbound email
> remains disabled, so nothing is delivered yet. Sections 1 and 2 record why the
> change was needed; section 3 records what was built.

---

## 1. Why this is needed

Surveys raised from the CSAT portal are being picked up by a notification that
was written for case-triggered surveys. The result is a broken invitation.

Evidence from the instance:

| Finding | Detail |
|---|---|
| Notification firing today | **Survey User Invite v2- Manually Created** (`asmt_assessment_instance`, generation type *engine*) |
| Its condition | `metric_type.name = Closed Case Survey` and `state CHANGES TO ready` — which portal surveys satisfy |
| Subject produced | `Survey for case- , Site` — `${task_id.number}` and `${task_id.location}` are empty |
| Survey link produced | **None** |

The missing link is the important part. The body calls the mail script
`asmt_assessment_instance_script_for_partners`, which begins:

```js
var partner = new GlideRecord('customer_account');
partner.addQuery('sys_id', current.task_id.company);
partner.query();
if (partner.next()) {          // never true for a portal survey
    ...
    template.print(html);      // so the link is never printed
}
```

Portal-raised surveys have no `task_id`, so the query returns nothing and the
link is never written into the email. A recipient would receive a message with
a malformed subject and no way to reach the survey.

The stock notification that *does* contain a working link — **Survey
Invitation** — is currently **inactive**.

### Confirmed: the link mechanism itself works

Tested against a real portal-created survey instance:

```
instance:  8e92ec112b2a0f10efa0f95ed891bf13
task_id:   (empty)
url:       https://adcomsolutionsdev.service-now.com/nav_to.do?uri=%2Fassessment_take2.do
           %3Fsysparm_assessable_type=<metric_type>%26sysparm_assessable_sysid=<instance>
linkHtml:  <a href="...">Take me to the Survey</a>
```

`AssessmentUtils().getInstanceLinkHTML(current)` needs only the instance, not a
case. It is the correct building block.

---

## 2. Decisions taken

**Link destination: Service Portal.** Recipients are customer contacts, so the
invitation links to `/csat?id=take_survey&instance_id=<sys_id>` rather than the
platform UI. Verified: opening the link as the survey owner loads the survey
with a **Get Started** button; opening it as anyone else is correctly refused.

**Pattern: mirrors the existing case invitation.** Same body structure, same
covering wording, and the same sender-resolution approach, so the two emails
read consistently.

**Sender:** resolved from the `survey.from.mail` property using the account on
the CSAT request, falling back to `support@noc-portal.com` — the same rule the
case email uses.

Still to confirm with the business: whether a due date should be quoted, and
whether branding or a logo is required.

---

## 3. What was built

Deployed by `scripts/deploy-csat-email-template.js`, which is idempotent and
safe to re-run.

| Artifact | Purpose |
|---|---|
| Mail script `csat_survey_portal_from` | Resolves sender and reply-to from the CSAT request's account |
| Mail script `csat_survey_portal_link` | Prints the Service Portal survey link, with a copyable fallback |
| Notification `CSAT Survey Invitation` | The invitation itself, scoped to portal-raised surveys |
| Condition changes on three existing notifications | Stops them producing a second, broken email |

### Phase 1 — Stop the wrong email (done first)

Three active notifications would otherwise also fire. Each was narrowed, without
changing how it behaves for the surveys it was written for.

> **The obvious guard does not work for all of them.** Adding
> `trigger_table != u_x_csat_survey_request` only helps for *event-based*
> notifications, which are evaluated when the queued event is processed — by
> which time the portal has stamped the trigger table onto the instance.
>
> **Survey User Invite v2- Manually Created** is *record-based* (`generation_type
> = engine`), so it is evaluated the instant the instance is inserted, before
> the trigger table is set. The guard was always true and it kept firing. It is
> now excluded with `task_id IS NOT EMPTY` instead — portal surveys have no
> task, and that notification renders `${task_id.number}` in its subject and
> uses `task_id.company` to build its link, so without a task it could only ever
> produce a broken email anyway.

| Notification | Type | Guard applied |
|---|---|---|
| Request survey | event | `trigger_table != u_x_csat_survey_request` |
| Survey Assigned Notification | event | `trigger_table != u_x_csat_survey_request` |
| Survey User Invite v2- Manually Created | record | `task_id IS NOT EMPTY` |

### Phase 2 — Build the link mail script

Create a Mail Script named `csat_survey_link`.

Option A — platform link, reuses the stock helper:

```js
(function runMailScript(current, template, email, email_action, event) {
    template.print(new AssessmentUtils().getInstanceLinkHTML(current));
})(current, template, email, email_action, event);
```

Option B — Service Portal link, recommended:

```js
(function runMailScript(current, template, email, email_action, event) {
    var portal = 'csat';
    var base = gs.getProperty('glide.servlet.uri').replace(/\/$/, '');
    var url = base + '/' + portal + '?id=take_survey&instance_id=' + current.getUniqueValue();

    template.print('<p><a href="' + url + '" ' +
        'style="background:#0b5cab;color:#ffffff;padding:12px 22px;' +
        'border-radius:4px;text-decoration:none;display:inline-block;">' +
        'Take the survey</a></p>');
    template.print('<p style="font-size:12px;color:#666;">' +
        'If the button does not work, copy this link:<br/>' + url + '</p>');
})(current, template, email, email_action, event);
```

The plain-text fallback matters — many corporate mail clients strip styled
buttons.

### Phase 3 — Build the invitation notification

Create a Notification on `asmt_assessment_instance`:

| Field | Value |
|---|---|
| Name | `CSAT Survey Invitation` |
| Table | `asmt_assessment_instance` |
| Send when | Event is fired |
| Event name | `assign.send_survey` |
| **Generation type** | **`event`** |
| Users | `user` (recipient field) |
| Condition | `Trigger table` **is** `u_x_csat_survey_request` |
| Subject | `${metric_type} — we would value your feedback` |

Body:

```html
<p>Hi ${user.first_name},</p>

<p>Thank you for working with us. We would appreciate a few minutes of your
time to tell us how we are doing.</p>

<p>The survey takes 1–3 minutes and your answers go directly to the team
supporting your account.</p>

${mail_script:csat_survey_link}

<p>Thank you,<br/>The Customer Success Team</p>
```

> **`generation_type` must be `event`.** The default value `engine` causes the
> notification engine to ignore `gs.eventQueue` events entirely — the event is
> marked processed and no email is ever produced. This has already caught us
> once on the submission notifications.

### Phase 4 — Confirm which event fires

Portal surveys are created with an empty source record, so the platform's
*Dispatch Survey event (Non triggered)* rule raises **`assign.send_survey`**.
That is the event to listen on.

Both platform dispatch rules require `metric_type.notify_user = true`. Confirm
this is ticked on each survey definition that will be used, otherwise the
portal falls back to raising the event itself through
`CSATSurveyNotification.notifyAssigned()`.

### Phase 5 — Tested with delivery off

Outbound email is disabled, so everything was written to `sys_email` without
being sent. Verified on adcomsolutionsdev:

```
Recipient: American Bank Notifications (security@ambk.com)
Emails generated for this recipient: 1
   Closed Case Survey - we would value your feedback
Link: https://adcomsolutionsdev.service-now.com/csat?id=take_survey
      &instance_id=698ba85d2be2cf1007a3fa95b891bfa4
```

| Check | Result |
|---|---|
| Exactly one invitation per recipient | Yes — the duplicate no longer fires |
| Subject renders the survey name | `Closed Case Survey - we would value your feedback` |
| No empty placeholders | Confirmed |
| Survey link present | Yes, Service Portal |
| Link opens the survey for its owner | Verified — loads with **Get Started** |
| Link refused for anyone else | Verified — "not authorized or the record is not valid" |

### Phase 6 — Enable delivery

1. Review anything already queued in `sys_email` so switching on does not
   release a backlog
2. Set `glide.email.smtp.active = true`
3. Send to one internal recipient and confirm receipt and the link
4. Then send to a genuine customer contact

---

## 4. Prerequisites still outstanding

These block a live send regardless of the email template:

| Item | Status |
|---|---|
| Outbound email enabled | **Off** |
| Closed Case Survey | Published, 1 question |
| Complex Resolution Survey | **Draft, 0 questions** |
| Generic Quarterly Survey | **Draft, 0 questions** |
| Primary Billing Contact populated | **1 company only** |

A survey with one question will produce a very thin invitation. Content should
be reviewed alongside the email wording.

---

## 5. Sequence and dependencies

```
Phase 1  Exclude portal surveys from the case notification   ← do first
Phase 2  Create the csat_survey_link mail script
Phase 3  Create the CSAT Survey Invitation notification
Phase 4  Confirm notify_user on each survey definition
Phase 5  Test with email still disabled
Phase 6  Enable delivery, pilot, then roll out
```

Phases 2 and 3 can be done together. Phase 1 must precede Phase 6 or recipients
receive two emails.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Duplicate invitations | Phase 1 excludes portal surveys from the case notification; verify only one `sys_email` row per recipient in Phase 5 |
| Notification silently produces nothing | Set `generation_type = event`; confirm a `sys_email` record appears in Phase 5 |
| Enabling SMTP releases a backlog | Review the queue before switching on |
| Link resolves for the wrong person | Assessment instances are per-user; confirm in Phase 5 by opening the link |
| Wrong sender identity | Agree sender name and reply-to before Phase 6 |

---

## 7. Rollback

Each phase is independently reversible.

| To undo | Action |
|---|---|
| The new invitation | Set **CSAT Survey Invitation** to inactive |
| The Phase 1 exclusion | Remove the trigger table condition |
| Delivery | Set `glide.email.smtp.active = false` |

No data model or portal changes are involved, so nothing needs redeploying.

---

## 8. What we still need from you

1. **Approve the wording** — subject line and covering text as built
2. **Confirm the sender mapping** covers the accounts you will survey, since
   anything unmapped falls back to `support@noc-portal.com`
3. **Enable outbound email** once the existing queue has been reviewed
4. **Owner and date** for publishing the two Draft surveys

The build is captured in the update set **CSAT Survey Portal - Invitation
email** for promotion, consistent with the rest of the solution.
