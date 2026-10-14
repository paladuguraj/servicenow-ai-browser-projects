# Escalation Process Enhancements — Technical Design

| | |
|---|---|
| **Document type** | Technical design & change record |
| **Product / platform** | ServiceNow Customer Service Management |
| **Primary table** | `sn_customerservice_escalation` |
| **Source instance** | `adcomsolutionsdev.service-now.com` |
| **Version** | 1.0 |
| **Status** | Deployed on Dev; packaged for migration |
| **Related requirement** | SNOW Escalation Widget update v2.1 |
| **Consolidated update set** | Escalation Enhancements - ALL CHANGES v1.0 |

---

## 1. Purpose

This document records all configuration and code changes made to the Case Escalation process so the work can be reviewed, migrated, and maintained later.

The enhancements cover three themes:

1. **Request Escalation form fields** — capture richer escalation metadata (level, reason, category, owner, channels, impact, notes).
2. **Customer-visible wording** — rename **Escalation Justification** to **Customer Justification**.
3. **External case notes** — append customer and de-escalation justifications to case **Additional Comments** so customers can see them, without duplicating notes when OOB escalation logic runs.

---

## 2. Scope

### In scope

| Area | Detail |
|------|--------|
| Table | `sn_customerservice_escalation` |
| Form view | `request_escalation` (Request Escalation) — opened by **Escalate Case** |
| Label change | `escalation_justification` → display label **Customer Justification** |
| Automation | Global business rule posting to case `comments` (Additional Comments) |
| Migration | Single consolidated update set XML |

### Out of scope / intentionally unchanged

| Item | Reason |
|------|--------|
| Field **#2 Escalation Source** | Already exists as OOB `request_source` (Customer / Internal) |
| OOB `sn_customerservice.EscalationUtils` | ACL-protected (`sys_policy=read`); not customized |
| De-escalation form field layout | Existing `request_de_escalation` view retained |
| SLA “escalation should not satisfy SLA” note from the business doc | Not implemented in this package (configuration/process item outside this change set) |
| Exclude Escalation from Require Update BR | Separate update set; not in ALL CHANGES v1.0 |

---

## 3. High-level architecture

```
Case (sn_customerservice_case)
        │
        │  UI Action: Escalate Case
        ▼
Escalation (sn_customerservice_escalation)
  view = request_escalation
  + 8 custom fields (u_*)
  + Customer Justification (renamed OOB field)
        │
        │  After BR: Append escalation justifications to case
        ▼
Case Additional Comments (comments)
  • "Customer Justification: …"   on escalate / first set
  • "De-escalation Justification: …" on state → Closed Escalated (103)
```

OOB **Escalation field change handler** still writes **internal Work notes** via `EscalationUtils.appendNote()`. This package writes **customer-visible Additional Comments** only.

---

## 4. Dictionary fields added

All custom fields are on **`sn_customerservice_escalation`**, global scope, element names prefixed with `u_`.

| # | Label | Element | Type | Choice | Max length | Multi-select |
|---|-------|---------|------|--------|------------|--------------|
| 1 | Escalation Level / Tier | `u_escalation_level` | Integer | Dropdown (choice=1) | 40 | No |
| 3 | Escalation Reason / Justification | `u_escalation_reason` | String | Dropdown with --None-- (choice=3) | 255 | Yes (`list_collector=true`) |
| 4 | Documentation Accuracy Flag | `u_documentation_accuracy` | String | Dropdown (choice=1) | 40 | No |
| 5 | Escalation Category / Type | `u_escalation_category` | String | Dropdown (choice=1) | 40 | No |
| 6 | Owner | `u_escalation_owner` | String | Dropdown (choice=1) | 40 | No |
| 7 | Communication Channel Used for Escalation | `u_communication_channel` | String | Dropdown with --None-- (choice=3) | 255 | Yes (`list_collector=true`) |
| 8 | Customer Impact Status | `u_customer_impact_status` | String | Dropdown with --None-- (choice=3) | 255 | Yes (`list_collector=true`) |
| 9 | Additional Notes | `u_additional_notes` | String | None (open text) | 1000 | N/A |

**Skipped:** #2 Escalation Source — use existing `request_source`.

### 4.1 Choice values

#### Escalation Level / Tier (`u_escalation_level`)

| Value | Label |
|------:|-------|
| 0 | Level 1 |
| 1 | Level 2 |
| 2 | Level 3 |
| 3 | Level 4 |

#### Escalation Reason / Justification (`u_escalation_reason`) — multi-select

| Value | Label |
|------:|-------|
| 0 | SLO Breach |
| 1 | Repeated Issue |
| 2 | Recommended Fix Not Implemented |
| 3 | Carrier/Vendor Non-Responsive |
| 4 | Technical Complexity |
| 5 | Inactivity |
| 6 | Business Critical |

#### Documentation Accuracy Flag (`u_documentation_accuracy`)

| Value | Label |
|------:|-------|
| 0 | Case Notes Accurate |
| 1 | Documentation Error Identified |

#### Escalation Category / Type (`u_escalation_category`)

| Value | Label |
|------:|-------|
| 0 | Technical Investigation |
| 1 | Performance Optimization |
| 2 | Service Restoration |
| 3 | Carrier/Vendor Coordination |
| 4 | On-Site Dispatch |
| 5 | Management Review & Decision |
| 6 | Account Management/Billing |
| 7 | Architecture/Design Review |

#### Owner (`u_escalation_owner`)

| Value | Label |
|------:|-------|
| 0 | NOC |
| 1 | Engineering Team |
| 2 | Customer Success / Account Management |
| 3 | Finance / Billing |
| 4 | Executive Management |
| 5 | Platform Team |

#### Communication Channel Used for Escalation (`u_communication_channel`) — multi-select

| Value | Label |
|------:|-------|
| 0 | Email |
| 1 | Phone Call |
| 2 | Slack Channel |
| 3 | Microsoft Teams |
| 4 | Management Review Meeting |

#### Customer Impact Status (`u_customer_impact_status`) — multi-select

| Value | Label |
|------:|-------|
| 0 | Severity = Hard Down |
| 1 | Intermittent Issues |
| 2 | Degraded Performance |
| 3 | No Current Impact – Preventive Escalation |

#### Additional Notes (`u_additional_notes`)

Open text, max length **1000** (aligned with OOB `escalation_justification`).

---

## 5. Form layout changes

### View

| Property | Value |
|----------|-------|
| View name | `request_escalation` |
| View title | Request Escalation |
| View sys_id | `0359470ab3600300b85d6e5f26a8dc28` |
| Form section sys_id | `4f590b0ab3600300b85d6e5f26a8dcab` |
| Table | `sn_customerservice_escalation` |

### How users reach the form

UI Action **Escalate Case** on `sn_customerservice_case` redirects to:

`sn_customerservice_escalation.do?sys_id=-1&sysparm_view=request_escalation&sysparm_view_forced=true&…`

### Field order on Request Escalation (custom fields)

Custom fields were added after the existing OOB fields (for example `request_source`, `reason`, `escalation_justification`).

| Position | Element |
|---------:|---------|
| 14 | `u_escalation_level` |
| 15 | `u_escalation_reason` |
| 16 | `u_documentation_accuracy` |
| 17 | `u_escalation_category` |
| 18 | `u_escalation_owner` |
| 19 | `u_communication_channel` |
| 20 | `u_customer_impact_status` |
| 21 | `u_additional_notes` |

Existing OOB elements on the same section (unchanged): `number`, `source_record`, `request_source`, `reason`, `escalation_severity`, `type`, `watch_list`, `add_account_team_members`, `assignment_group`, `assigned_to`, `escalation_justification`, plus form splitters.

---

## 6. Label change — Customer Justification

| Property | Before | After |
|----------|--------|-------|
| Element | `escalation_justification` | *(unchanged)* |
| Dictionary column label | Escalation Justification | **Customer Justification** |
| Field label (`sys_documentation`, en) | Escalation Justification | **Customer Justification** |
| Plural | Escalation Justifications | **Customer Justifications** |
| Table | `sn_customerservice_escalation` | *(unchanged)* |

Artifacts updated:

- `sys_dictionary` — `sys_dictionary_sn_customerservice_escalation_escalation_justification`
- `sys_documentation` — `sys_documentation_sn_customerservice_escalation_escalation_justification_en`

---

## 7. Business rules

### 7.1 New — Append escalation justifications to case

| Property | Value |
|----------|-------|
| **Name** | Append escalation justifications to case |
| **sys_id** | `494966022bbfcb5007a3fa95b891bf10` |
| **Table** | `sn_customerservice_escalation` |
| **When** | after |
| **Order** | 200 |
| **Insert** | true |
| **Update** | true |
| **Active** | true |
| **Scope** | global |
| **Update name** | `sys_script_494966022bbfcb5007a3fa95b891bf10` |
| **Repo artifact** | `servicenow/business-rules/append-escalation-justifications-to-case-comments.js` |

#### Behavior

| Event | Condition | Writes to case |
|-------|-----------|----------------|
| Escalate | Customer Justification first set (insert, or empty → value) | Additional Comments: `Customer Justification: {text}` |
| De-escalate | State changes to **103** (Closed Escalated) and de-escalation justification is populated | Additional Comments: `De-escalation Justification: {text}` |

Only source tables **`sn_customerservice_case`** and **`csm_order_case`** are updated. Notes go to **`comments`** (customer-visible), not `work_notes`.

#### Duplicate-note guard

OOB **Escalation field change handler** (order **1000**) calls `EscalationUtils.appendNote()`, which performs a nested `escalation.update()` for internal work notes. That nested update re-fired this business rule and posted Customer Justification twice.

**Fix:** before posting, query `sys_journal_field` for the same case `comments` entry containing the marker text; skip if already present.

### 7.2 OOB rules that interact (not modified)

| Name | Role in the flow |
|------|------------------|
| Escalation field change handler | After insert/update; calls `EscalationUtils.appendNote` / `notifyUsers` for state, severity, trend, work notes, comments |
| Append escalation approval comments | Before; copies approval comments into escalation work notes |
| Close escalation | Before; sets `de_escalated_by` |
| Escalation state management | Before; case/escalation state coordination |

`EscalationUtils` could not be customized (ACL: *ACL Exception Update Failed due to security constraints*). Customer-visible note behavior is therefore implemented in the global BR above.

---

## 8. Update sets / migration

### Recommended: one consolidated set

| Property | Value |
|----------|-------|
| **Name** | Escalation Enhancements - ALL CHANGES v1.0 |
| **File** | `updatesets/Escalation_Enhancements_ALL_CHANGES_v1.0.xml` |
| **Change count** | 27 |
| **Contents** | 8 field dictionaries + labels + choices, form layout, Customer Justification rename, final business rule (deduped) |

**Target import steps**

1. **Retrieved Update Sets → Import Update Set from XML**
2. Select `Escalation_Enhancements_ALL_CHANGES_v1.0.xml`
3. **Preview**
4. Resolve any collisions if prompted
5. **Commit**

Prerequisite on target: Customer Service Management / Case Escalation (`sn_customerservice_escalation`) available.

### Historical split sets (only if not using ALL CHANGES)

Apply in this order:

| Order | Update set | File | Changes |
|------:|------------|------|--------:|
| 1 | Escalation Form Fields v1.0 | *(on Dev; captured in ALL CHANGES)* | 24 |
| 2 | Escalation Customer Notes v1.0 | `updatesets/Escalation_Customer_Notes_v1.0.xml` | 3 |
| 3 | Escalation Customer Notes Dedup v1.1 | `updatesets/Escalation_Customer_Notes_Dedup_v1.1.xml` | 1 |

Prefer **ALL CHANGES v1.0** so this sequence is unnecessary.

### Not included in ALL CHANGES

| Update set | Notes |
|------------|-------|
| Exclude Escalation from Require Update BR | Separate; rebuild with `npm run consolidate:escalation -- --include-require-update` if needed |

---

## 9. Repository deliverables

| Path | Purpose |
|------|---------|
| `scripts/deploy-escalation-fields.js` | Create/idempotent fields + choices on Dev |
| `scripts/deploy-escalation-form.js` | Add fields to `request_escalation` form |
| `scripts/deploy-escalation-customer-notes.js` | Label rename + BR deploy + XML export |
| `scripts/consolidate-escalation-update-set.js` | Build ALL CHANGES XML |
| `servicenow/business-rules/append-escalation-justifications-to-case-comments.js` | BR source of truth |
| `updatesets/Escalation_Enhancements_ALL_CHANGES_v1.0.xml` | **Migration package** |
| `updatesets/Escalation_Customer_Notes_v1.0.xml` | Historical split set |
| `updatesets/Escalation_Customer_Notes_Dedup_v1.1.xml` | Historical split set |

### npm scripts

```bash
npm run deploy:escalation-fields
npm run deploy:escalation-form
npm run deploy:escalation-customer-notes
npm run consolidate:escalation
```

---

## 10. Test evidence (Dev)

| Case | Escalation | Result |
|------|------------|--------|
| CS1703276 | ESC0004503 / ESC0004504 | Early tests; showed duplicate Customer Justification before dedup fix |
| CS1703308 | ESC0004505 | After dedup: **1** Customer Justification + **1** De-escalation Justification on Additional Comments |

### How to verify on a case

1. Open the case form.
2. Review **Additional Comments** (external / customer-visible) — not **Work notes**.
3. Expect:
   - After escalate: `Customer Justification: …`
   - After de-escalate (state 103): `De-escalation Justification: …`
4. Confirm Customer Justification appears **once**.

---

## 11. Operational notes

- Multi-select fields use ServiceNow choice `list_collector` attribute; UI renders a multi-select control on the form.
- Creating escalations via REST still fires the after BR; UI Escalate Case is the primary intended path.
- Internal work-note messages from OOB (`Escalation … has been approved/closed`) remain unchanged.
- If Customer Justification is filled later on an existing escalation (empty → value), the BR posts once at that time.

---

## 12. Change log

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-09-11 | Eight form fields + Request Escalation form layout |
| 1.0 | 2026-10-09 | Customer Justification rename + external notes BR |
| 1.1 | 2026-10-13 | Dedup guard for duplicate Customer Justification notes |
| 1.0 ALL | 2026-10-14 | Consolidated update set for migration |
| Doc 1.0 | 2026-10-14 | This technical design document |

---

## 13. Appendix — Requirement mapping (SNOW Escalation Widget update v2.1)

| Req item | Requirement | Implementation |
|----------|-------------|----------------|
| 1 | Escalation Level / Tier dropdown | `u_escalation_level` |
| 2 | Escalation Source | Skipped — OOB `request_source` |
| 3 | Escalation Reason / Justification multi-select | `u_escalation_reason` |
| 4 | Documentation Accuracy Flag | `u_documentation_accuracy` |
| 5 | Escalation Category / Type | `u_escalation_category` |
| 6 | Owner | `u_escalation_owner` |
| 7 | Communication Channel multi-select | `u_communication_channel` |
| 8 | Customer Impact Status multi-select | `u_customer_impact_status` |
| 9 | Additional Notes open text | `u_additional_notes` |
| — | Rename Escalation Justification → Customer Justification | Dictionary + documentation |
| — | Append escalation notes to external case notes | BR → case `comments` |
| — | Append de-escalation notes to external case notes | BR → case `comments` on state 103 |

---

*End of document.*
