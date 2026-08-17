# CSAT Survey Portal — Functional Requirements & Test Report

**Version 1.0 · Prepared for management review**
**Environment: adcomsolutionsdev · Status: built and verified**

---

## 1. Business summary

Account teams need a controlled way to ask customer contacts how satisfied they
are, without raising surveys by hand and without over-surveying the same people.

The CSAT Survey Portal gives them a single page to pick a customer account,
choose who should be asked, select which survey to use and decide whether it
goes out now or on a repeating cycle. The platform's own survey engine delivers
the survey and records the answers, so responses appear in standard ServiceNow
survey reporting with no separate data store.

Two controls exist to protect the customer relationship: a recipient cannot be
surveyed more than once in any 90-day period, and the person raising the request
must confirm how many people will be emailed before anything is sent.

**Where it lives:** `https://adcomsolutionsdev.service-now.com/csat`

---

## 2. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-01 | Only **active** companies can be selected | Met |
| FR-02 | Company selector is **searchable** rather than a long dropdown | Met |
| FR-03 | Recipients can be the account's **Primary User**, taken from Primary Billing Contact | Met |
| FR-04 | Primary User must have an **active portal account** | Met |
| FR-05 | Alternatively the requester can pick **one or more specific users** from that account | Met |
| FR-06 | Both options carry on-screen guidance | Met |
| FR-07 | Survey template is chosen from the surveys configured on the platform | Met |
| FR-08 | **Closed Case Survey** and **Complex Resolution Survey** may only be sent immediately | Met |
| FR-09 | All other surveys may be sent immediately, every 30 days, or every 60 days | Met |
| FR-10 | A user may receive a CSAT survey through this portal **once every 90 days** | Met |
| FR-11 | No internal implementation detail is shown to the user | Met |
| FR-12 | On submission a **confirmation dialog** is shown | Met |
| FR-13 | From that dialog the user can start a new request or view all requests | Met |
| FR-14 | The requests list offers **New Survey Request**, not a blank-record New button | Met |
| FR-15 | Recipients are emailed when a survey is assigned | Met — see 5.1 |
| FR-16 | Respondent and requester are emailed when a survey is submitted | Met — see 5.1 |
| FR-17 | Every send is recorded for audit and reporting | Met |
| FR-18 | Survey owners can run a **results report** filtered by survey, account, sent-between dates, and sent vs replied | Met |
| FR-19 | The report offers only the surveys the portal can send | Met |
| FR-20 | Report results can be exported to **PDF, Excel and CSV** | Met |
| FR-21 | Exports reflect the filters currently applied to the report | Met |
| FR-22 | Recipients of a **white-label partner** receive the survey link on that partner's own domain | Met |
| FR-23 | Everyone else receives the link on the instance's own address | Met |

### 2.1 Business rules in plain terms

**Who can be surveyed.** The person must have a working account (enabled, not
locked out, not a system integration account) and an email address. Anyone who
fails these is listed separately as ineligible with the reason.

**How often.** Once per 90 days per person across the whole portal, regardless of
which survey. The list shows exactly when someone becomes eligible again, for
example *"Surveyed on 2026-08-01. Eligible again in 89 days."*

**Which surveys can be scheduled.** Case-outcome surveys relate to a single
event, so they are sent once and cannot repeat. Relationship surveys such as the
quarterly survey can repeat.

**Draft surveys.** A survey that has not been published cannot generate anything.
These appear greyed out and labelled, and are rejected if attempted.

**Which address the survey link uses.** Partners who resell the service under
their own brand have their own domain, listed in the `survey.link.whitelabel`
property. A customer inherits the domain of the partner their account sits
under, so they only ever see their own provider's address. Customers who are not
behind a partner get the standard address. The survey page itself is the same
for everyone.

---

## 3. How the process works

```
1  Search and pick a customer account          (active accounts only)
2  Choose recipients
      Primary User      → the account's billing contact
      Selected Users    → filter and tick individuals
3  Choose the survey template
4  Choose the schedule                         (restricted for some surveys)
5  Add optional notes
6  Confirm — "This will email N people at <account>"
7  Submitted — dialog reports the outcome
      [ View Requests ]  [ Create another survey ]
```

Recipients receive the standard ServiceNow survey invitation with a link.
When they submit, they get a thank-you and the requester is told a response
arrived.

---

## 4. Test report

Two automated suites run against the live instance. Both currently pass.

### 4.1 Business rule verification — 9 of 9 passed

Run: `npm run test:csat:rules` against adcomsolutionsdev

| # | Test | Covers | Result |
|---|---|---|---|
| 1 | Company list excludes inactive accounts | FR-01 | Pass — 500 returned, 0 inactive |
| 2 | Search filters the company list | FR-02 | Pass — "Bank" returned 116 matches |
| 3 | Closed Case Survey is immediate-only | FR-08 | Pass |
| 4 | Complex Resolution Survey is immediate-only | FR-08 | Pass |
| 5 | Generic Quarterly Survey allows scheduling | FR-09 | Pass |
| 6 | Cooldown window is 90 days | FR-10 | Pass |
| 7 | Primary Billing Contact resolves to a user | FR-03, FR-04 | Pass — resolved to a named, eligible user |
| 8 | Account without a contact explains why | FR-03 | Pass — "This company has no Primary Billing Contact set." |
| 9 | Users carry eligibility information | FR-04, FR-10 | Pass — 1,368 users evaluated |

### 4.2 Portal walkthrough — passed

Run: `npm run test:csat:portal` (browser automation, full journey)

| Step | Covers | Observed |
|---|---|---|
| Page loads | — | CSAT Survey Request |
| No implementation detail shown | FR-11 | Confirmed removed |
| Company search | FR-02 | 50 results, selection applied |
| Draft surveys blocked | — | 13 sendable, 1 Draft disabled and labelled |
| Schedule restriction | FR-08, FR-09 | Restricted surveys offered 1 option; others 3 |
| Both recipient options with guidance | FR-05, FR-06 | Both present with notes |
| Ineligible recipients excluded | FR-10 | Eligible list shrank as people were surveyed |
| Confirmation before sending | FR-12 | "This will email 1 person at ACME Australia." |
| Submission dialog | FR-12, FR-13 | View Requests / Create another survey |
| Form resets for next request | FR-13 | Confirmed |
| Requests page | FR-14 | 20 rows; stock New removed; New Survey Request present and opens the form |

### 4.2a Results report and exports — passed

Verified against live data on adcomsolutionsdev (48 sent, 0 replied at the time
of the run).

| Check | Covers | Observed |
|---|---|---|
| Survey filter offers portal surveys only | FR-19 | Complex Resolution Survey, Generic Quarterly Survey |
| Account filter | FR-18 | 12 accounts drawn from the audit trail |
| Report run, unfiltered | FR-18 | 48 rows, 12 account groups |
| Report run, awaiting reply only | FR-18 | 48 rows |
| PDF export | FR-20 | Valid PDF returned, with filters, summary tiles, per-account and per-survey breakdowns and all detail rows |
| Excel export | FR-20 | Valid `.xlsx` workbook, headers Company / Survey Template / User / Email / Executed On / State / Taken on |
| CSV export | FR-20 | Generated from the rows already on screen |
| Excel matches the report | FR-21 | 48 rows unfiltered, 48 awaiting, 0 replied — identical to the on-screen figures |
| Repeated PDF exports do not accumulate | — | Previous export purged; one attachment retained per user |

### 4.2b White-label survey links — passed

Every account surveyed to date resolved to its partner's domain, checked by
rendering the invitation mail script itself rather than the resolver alone:

| Account | Partner | Link host |
|---|---|---|
| ADCom (Corporate Account) | Direct | `nocportal.appdirect.com` |
| Vector-DTLR Inc | Vector Security Networks | `vsnnoc247.vectorsecurity.com` |
| Vector-Floyds Barbershop | Vector Security Networks | `vsnnoc247.vectorsecurity.com` |
| 1419 Clark County Credit Union | Fiserv | `nocportal.appdirect.com` |
| Henry Ford Health System | ATT TAO Partner | `portal.tao.attniglobal.com` |
| AppDIrect - 10512 | APX Net | `portal.apxnet.com` |

Fallbacks, each confirmed to return the instance address:

| Condition | Result |
|---|---|
| Account not behind a white-label partner | Instance address |
| Property not set or empty | Instance address |
| Property contains malformed JSON | Instance address, warning logged |
| Request has no account | Instance address |

Case-triggered surveys were re-checked and are unchanged.

### 4.3 Rules proven with live data

| Scenario | Result |
|---|---|
| First survey to a new recipient | Sent, assessment instance created, invitation queued |
| Same recipient again immediately | **Blocked** — "Surveyed on 2026-08-01 09:13:50. Eligible again in 90 day(s)." |
| Draft survey attempted | **Blocked** — "Survey 'Complex Resolution Survey' is still in Draft. Publish it in Survey Designer before sending." |
| Published survey to a Primary User | Sent — instance created, invitation queued |
| Selecting 2 of 28 users | Exactly 2 recipients, confirmed in the audit table |
| Filtering the picker | 28 narrowed to 1; only that person received it |

### 4.4 Defects found and resolved during build

| Issue | Impact | Resolution |
|---|---|---|
| Surveys silently reported as sent when they were not | Audit showed success with no survey delivered; recipient blocked for 90 days for nothing | Success now requires a verified survey record |
| Draft surveys could be selected | Requests appeared to succeed and did nothing | Blocked in the form and on the server |
| Submission emails never produced | No notification on response | Notification configuration corrected |
| Outbound email disabled | Nothing delivered | Identified; enabling is a deliberate, separate step |
| Recipient list looked like "send to everyone" | Risk of the wrong perception, and of mis-sending | Rebuilt as a filterable picker with a visible count |
| One click could email an entire company | Mass-send risk | Confirmation step naming the exact number |
| Survey status values shown as raw codes in list views | Poor readability for reporting | Choice lists reattached to the correct columns |

---

## 5. Open items for the business

### 5.1 Email delivery is switched off

Outbound email is currently **disabled** on adcomsolutionsdev
(`glide.email.smtp.active = false`). Notifications are generated and recorded,
but nothing leaves the instance. This was left untouched deliberately, because
enabling it can release anything already queued.

*Action:* confirm the existing queue is safe, then enable. Until then, surveys
are created and visible to recipients in **My Surveys**, but no email arrives.

### 5.2 Survey content is not ready

| Survey | Published | Questions |
|---|---|---|
| Closed Case Survey | Yes | 1 |
| Complex Resolution Survey | **No** | **0** |
| Generic Quarterly Survey | **No** | **0** |

Two of the three surveys cannot be sent. They need questions adding and then
publishing in Survey Designer. Only Closed Case Survey is usable today, and with
a single question.

*Action:* survey owner to complete and publish the two outstanding surveys.

### 5.3 Primary Billing Contact is barely populated

One company currently has this field set. Until it is populated more widely, the
**Primary User** option will report that no contact is configured for most
accounts, and requesters will have to use Selected Users.

*Action:* data owner to populate Primary Billing Contact across active accounts.

A related point for consideration: the field holds an email address as free
text, and is matched to a user by that address. If the address does not match a
user record, the option cannot be used. Converting it to a proper user reference
would remove that fragility.

### 5.4 Sending is synchronous

A request to 143 recipients took about 17 seconds, during which the page waits.
Acceptable now. If surveys to accounts materially larger than that are expected,
this should move to background processing.

---

## 6. Migration

The build is contained in a single update set:

**`CSAT Survey Portal - COMPLETE v1.0`** — 177 changes, Complete

Six earlier working sets have been consolidated into it and marked **Ignore**;
they must not be migrated.

One component is not carried by update sets: the daily scheduled job, which
ServiceNow classifies as data rather than configuration. It must be recreated on
the target.

Target environments must have the Service Portal plugin active, published
surveys with questions, and an active survey invitation notification. A
preflight check reports all prerequisites before deployment.

---

## 7. Recommendation

The portal is functionally complete against the agreed requirements and all
automated checks pass. It is **not yet ready for end users**, for reasons that
are configuration and content rather than build:

1. Outbound email must be enabled
2. Two of three surveys need questions and publishing
3. Primary Billing Contact needs populating

Once those are addressed, a short pilot on a handful of real accounts is
advisable before wider rollout, so the invitation wording and the 90-day rule
can be validated with genuine recipients.
