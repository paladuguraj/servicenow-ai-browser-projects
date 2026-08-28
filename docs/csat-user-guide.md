# Network Operations CSAT Survey — User Guide

For the team members who send customer satisfaction surveys and read the
results. No technical knowledge is assumed.

---

## 1. What this is for

Customer satisfaction used to be measured only when a case closed. This portal
lets you send a satisfaction survey to a customer at any point — after a
significant incident, or as a regular check on the relationship — and then see
how people responded.

You can:

- send a survey to a customer account's main contact, or to specific people you
  choose;
- send it once, or have it repeat every 30 or 60 days;
- see who was surveyed, who replied, and what they said.

Everything you send is recorded, so there is always a record of who was
contacted and when.

---

## 2. Getting in

Open **`/csat`** on the ServiceNow instance, for example:

```
https://<your-instance>.service-now.com/csat
```

The menu across the top has five entries:

| Menu item | What it shows |
|---|---|
| **New Request** | The form for sending a survey |
| **Survey Requests** | Every request that has been raised |
| **Results** | The report on sends and responses |
| **Executions** | The detailed send-by-send audit log |
| **My Surveys** | Surveys assigned to you personally |

---

## 3. Sending a survey

Choose **New Request**. The form has five parts, top to bottom.

### 3.1 Company / Account

Start typing the customer's name. The list narrows as you type; click the
account you want.

Only **active** accounts appear, so if an account is missing it is either
inactive or spelled differently to what you typed. Use the small **×** to clear
your choice and start again.

### 3.2 Recipients

Two options:

**Account Primary Contact** — the main contact recorded against the account.
The note under this option reads *"Account Primary Contact must have an active
portal account."* If that person cannot be surveyed, the portal says why
instead of silently skipping them. Common reasons:

- the account has no primary contact recorded;
- the contact has no email address;
- the contact's account is locked out or inactive.

**Selected Users only** — pick specific people from that account. A filter box
narrows a long list, and each person you tick appears as a small chip above so
you can see your selection at a glance. The note reads *"More than one user can
be sent the survey."*

Some people will be listed separately as **ineligible**, with the reason shown.
The most common is the 90-day rule described in section 5 — for those, the
portal tells you the date they were last surveyed and when they become
available again.

### 3.3 Survey Template

Choose the survey to send. Two are available:

- **Complex Resolution Survey** — after a significant or complex incident.
- **Generic Schedule Survey** — for regular, ongoing feedback.

Above this field is a reminder:

> *It is possible that these users could have received a Closed Case Survey.*

That refers to the separate survey sent automatically when a case closes. If
you are concerned about contacting someone too often, check the Close Case
Survey report before sending.

If a survey ever appears greyed out, it has not been published yet and cannot
be sent. That needs a survey administrator, not you.

### 3.4 Schedule

Three choices:

| Option | Meaning |
|---|---|
| **Send immediately** | Goes out as soon as you submit |
| **Every 30 days** | Sends now, then repeats monthly |
| **Every 60 days** | Sends now, then repeats every two months |

Some surveys can only be sent immediately, because they relate to a single
event rather than an ongoing relationship. **Complex Resolution Survey** is one
of these, so when you pick it the repeat options disappear. This is expected.

### 3.5 Notes

When you pick a survey, this box fills in with the survey name to start you
off. Add anything that gives the recipient context — it is included in the
email they receive.

### 3.6 Confirm and send

Press **Create Survey Request**. Nothing is sent yet: a confirmation appears
first.

> **Confirm before sending.** This will email **3** people at Acme Ltd.

Read the number and the account name, then press **Send to 3 recipients** to go
ahead, or **Cancel** to go back and change something. This step exists so no
one accidentally emails an entire company.

### 3.7 What happens next

A message confirms the outcome, for example:

> **Survey request submitted**
> 3 survey invitations have been sent.

Scheduled requests instead confirm the schedule and the first run date. If
anyone was skipped or a send failed, that is stated here too, with the reason —
so an empty result is never mistaken for success.

Two buttons:

- **View Requests** — the list of all survey requests.
- **Create another survey** — a fresh, blank form.

---

## 4. What the customer receives

Recipients get an email invitation with a link to the survey. Clicking it takes
them **straight to the first question** — there is no welcome screen to click
through.

The survey has two questions:

1. **How would you rate the overall quality of our service?** — a 1 to 5 rating
   from *Very Dissatisfied* to *Very Satisfied*.
2. **Do you have any additional comments or suggestions for how we could
   improve?** — a free-text box.

Customers of partners who resell under their own brand see the survey on that
partner's own web address, so the branding stays consistent for them.

When the survey is submitted, the customer gets a thank-you email and the
person who raised the request is notified that a response has come in.

---

## 5. The rules the system applies

These run automatically. You do not need to track them, but knowing them
explains what you see on the form.

**One survey per person every 90 days.** Nobody can be surveyed twice through
this portal inside 90 days, whichever survey it is. The portal shows exactly
when someone becomes available again, for example *"Surveyed on 2026-08-01.
Eligible again in 89 days."*

**Recipients need a working account.** The person must have an email address
and an account that is active and not locked out.

**Only active accounts can be selected.**

**Nothing sends without confirmation**, and the confirmation always states how
many people will be emailed.

---

## 6. Reading the results

Choose **Results** from the menu.

### 6.1 Choosing what to look at

Four filters, all optional. Leave them alone to see everything.

| Filter | Use it to |
|---|---|
| **Type of Survey** | Look at one survey, or *All surveys* |
| **Account** | Look at one customer, or *All accounts* |
| **Survey sent from** / **Survey sent to** | Limit to a date range — for example one quarter |
| **Sent vs Replied** | *All sent surveys*, *Replied only*, or *Awaiting reply only* |

Press **Run report**. **Reset** clears the filters and starts over.

### 6.2 What you get back

Four figures across the top:

| Figure | Meaning |
|---|---|
| **Surveys sent** | Invitations that actually reached someone |
| **Replied** | How many were completed |
| **Response rate** | Replied as a percentage of sent |
| **Average score** | Mean of the 1–5 ratings received |

Below that, **By account** and **By survey** break the same figures down, so you
can see which customers and which surveys are responding.

Last comes the detail table — one row per person, showing the account, survey,
recipient, when it was sent, whether they replied and when, their score, and
any comments they left.

**A note on the numbers.** Sends that never reached anyone — someone skipped by
the 90-day rule, or a technical failure — are counted separately and kept out of
the response rate. The rate therefore reflects people who genuinely received a
survey, and is not diluted by ones that were never delivered.

### 6.3 Exporting

Once a report has run, three buttons appear under **Export**:

| Button | Gives you |
|---|---|
| **PDF** | A formatted document with the filters used, the summary figures, both breakdowns and every detail row. Best for sharing or attaching to a review. |
| **Excel** | A spreadsheet of the detail rows, for your own pivots and charts. |
| **CSV** | The same data as plain text, for other tools. |

All three follow the filters currently applied, so export what is on screen.
The PDF takes a moment to prepare and the button says so while it works.

---

## 7. Common questions

**A customer I want is not in the account list.**
Only active accounts are listed. Check the spelling, then check whether the
account is still marked active.

**The person I want is greyed out or missing.**
They will be listed as ineligible with a reason — most often the 90-day rule.
The message tells you when they become available again.

**It says the account has no Account Primary Contact.**
No primary contact is recorded against that account. Either have one added, or
use **Selected Users only** and choose someone yourself.

**The confirmation shows more people than I expected.**
Go back and check your selection. That is exactly what the confirmation step is
for — nothing has been sent yet.

**It said no surveys were sent.**
The message states the reason. Usually everyone chosen was inside their 90-day
window. **Executions** in the menu shows the send-by-send detail.

**A survey is greyed out in the list.**
It has not been published. A survey administrator needs to publish it first.

**My customer says they never received it.**
Check **Survey Requests** for the request, then **Executions** for that
recipient — it records whether the invitation was generated and any error. If
it was sent, ask the customer to check their spam folder.

**The report shows fewer sent than I raised.**
Skipped and failed sends are excluded from the sent figure by design, because
they never reached anyone. The counts underneath account for them.

**Can I stop a repeating survey?**
Yes. Open the request from **Survey Requests** and set it to inactive; no
further runs happen.

---

## 8. Getting help

For anything the portal does not explain — a survey that needs publishing, a
missing primary contact, or emails that are not arriving — contact the Network
Operations team with the survey request number from **Survey Requests**.
