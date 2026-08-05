# CSAT Survey Invitation Email — Plan of Action

**Setting up the invitation template and the survey link**
**Environment: adcomsolutionsdev · Version 1.0**

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

## 2. Decision needed before build

**Where should the survey link point?**

| Option | URL | Best for |
|---|---|---|
| **A — Platform** | `nav_to.do?uri=/assessment_take2.do?...` | Internal users. This is what the stock helper returns. |
| **B — Service Portal** | `/csat?id=take_survey&instance_id=<sys_id>` | External customer contacts. Cleaner, no platform UI. |

Recipients are customer billing contacts, so **Option B is recommended**. The
`take_survey` page already exists on the instance. Option A works with no custom
code if a platform link is acceptable.

**Also to confirm with the business:**

- Sender display name and reply-to address
- Whether the survey has a due date to quote
- Whether branding or a logo is required
- Wording for the covering text

---

## 3. Plan

### Phase 1 — Stop the wrong email (must happen first)

The case notification must stop catching portal surveys, or recipients will get
two invitations once the new one is live.

1. Open **Survey User Invite v2- Manually Created**
2. Add to its condition: `Trigger table` **is not** `u_x_csat_survey_request`
3. Save

Its behaviour for genuine case-triggered surveys is unchanged.

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

### Phase 5 — Test before enabling delivery

With outbound email still **off**, everything is written to `sys_email` without
being sent. Use that to check the content safely.

1. Raise a request from the portal to a single test recipient
2. Open the generated record in **System Logs > Emails**
3. Verify:
   - Subject renders the survey name, with no empty placeholders
   - Body greets the recipient correctly
   - The survey link is present
   - The link opens the correct survey for that recipient
4. Confirm only **one** invitation was produced

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

## 8. What we need from you

1. **Link destination** — Service Portal (recommended) or platform
2. **Wording** — subject line and covering text, or approval of the draft above
3. **Sender identity** — display name and reply-to address
4. **Confirmation** to change the existing case notification's condition
5. **Owner and date** for publishing the two Draft surveys

On confirmation this can be implemented and captured in an update set for
promotion, consistent with the rest of the build.
