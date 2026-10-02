# Case Escalation, Require Update & Update SLA — Functional Design

**Version 1.0 · Prepared for functional / UAT review**  
**Environment:** adcomsolutionsdev  
**URL:** `https://adcomsolutionsdev.service-now.com/`  
**Primary table:** `sn_customerservice_case` (Case)  
**Related:** Escalation (`sn_customerservice_escalation`), Update SLA (`task_sla` where SLA target = `update`)

---

## 1. Business summary

Customer Service cases track whether an agent must provide a customer/operational **update** within a priority-based window. That obligation is driven by:

| Concept | Field / object | Meaning |
|---|---|---|
| **Require Update** | `u_require_update` (true/false) | Case currently needs an update |
| **Update SLA** | P1–P4 Case Update SLA definitions | Times how long the case may wait for that update |
| **Next Update Due** | `u_next_update_due_duration` | Planned due timestamp used for scheduling the next “require update” flip |
| **Escalate Case** | UI action → Escalation record | Raises escalation severity/approval; writes system work notes on the case |

**Why it exists**

- Hold agents to update cadence by priority (P1–P4).
- Start, complete, and re-start Update SLAs from Require Update transitions.
- Allow **Escalate Case** without treating escalation bookkeeping notes as a customer/operational update that satisfies the Update SLA.

**Who it is for**

- Case agents and escalators (internal).
- Operations / SLA owners reviewing Update SLA performance.
- Developers maintaining BR **Update Required Update field** and related Update SLA definitions.

---

## 2. Functional requirements

| ID | Requirement | Behavior |
|---|---|---|
| FR-01 | Cases have a boolean **Require Update** (`u_require_update`) | Default **false**; dictionary read-only on form (server scripts may still set it) |
| FR-02 | When Require Update becomes **true** on an **Open** case, the matching priority **Update SLA** starts | P1–P4 start: `priority=N` ∧ `state=Open(10)` ∧ `u_require_update=true` |
| FR-03 | When Require Update becomes **false**, the in-progress Update SLA **stops / completes** (satisfied) | Stop conditions include `u_require_update=false` (also Resolved / On Hold / Closed) |
| FR-04 | A genuine agent update (Additional comments / Work notes) on an Open case clears Require Update to **false** | Only if updater ≠ **Opened by** and updater ≠ `system` |
| FR-05 | After an agent update clears Require Update, a scheduled job can set it back to **true** at Next Update Due | BR **Trigger the Scheduled** + one-shot `sys_trigger` |
| FR-06 | **Escalate Case** creates an Escalation and appends work notes on the case | Via `EscalationUtils.appendNote` (requested / approved / updated / etc.) |
| FR-07 | Escalation-driven work notes must **not** clear Require Update and must **not** satisfy Update SLA | BR guard `isEscalationNote` (update set: *Exclude Escalation from Require Update BR*) |
| FR-08 | Real agent comments/work notes during an open escalation may still clear Require Update | Guard matches escalation text patterns only, not all notes while escalated |
| FR-09 | Updates by the case **Opened by** user never flip Require Update via this BR | Outer condition: `sys_updated_by != opened_by.user_name` |
| FR-10 | Update SLA can reset when Require Update changes to true again (and related breach rules) | Per-SLA `reset_condition` on P1–P4 Update SLA definitions |

---

## 3. Key objects

### 3.1 Case fields

| Label | Column | Type | Notes |
|---|---|---|---|
| Require Update | `u_require_update` | Boolean | Default false; read-only in dictionary |
| Next Update Due | `u_next_update_due_duration` | Date/Time | Fed from Update SLA planned end / reset logic |
| Update SLA Breached | `u_update_sla_breached` | Boolean | Synced from in-progress Update `task_sla.has_breached` |
| Active Escalation | `active_escalation` | Reference | Set when an escalation is requested |

### 3.2 Case states (relevant values)

| Value | Label |
|---|---|
| 1 | New |
| 10 | Open |
| 18 | On Hold |
| 6 | Resolved |
| 3 | Closed |
| 7 | Cancelled |

### 3.3 Update SLA definitions (active)

| Name | Priority | Duration (business) | Start condition (summary) |
|---|---|---|---|
| P1 - Critical Case Update SLA | 1 | 1 hour | P1 + Open + Require Update = true |
| P2 - High Case Update SLA | 2 | 2 hours | P2 + Open + Require Update = true |
| P3 - Medium Case Update SLA | 3 | 12 hours | P3 + Open + Require Update = true |
| P4 - Low Case Update SLA | 4 | 3 days | P4 + Open + Require Update = true |

**Stop (all):** Require Update = false **or** Resolved **or** On Hold **or** Closed  
**Cancel:** priority no longer matches **or** Cancelled  
**Reset (pattern):** breach flag / Open + matching priority + Require Update **changes to** true  

Schedule: shared business schedule used by these SLAs on Dev.

---

## 4. Process flows

### 4.1 Require Update → true (Update SLA starts)

```
Case becomes eligible for an update
        │
        ▼
u_require_update = true
        │
        ▼
SLA engine evaluates start conditions
        │
        ▼
Matching P1–P4 Update SLA → In progress
```

**Ways Require Update becomes true** (BR **Update Required Update field** and related automation; updater ≠ Opened by):

| Trigger | Result |
|---|---|
| State **New (1) → Open (10)** and field was false | Set **true** |
| State **On Hold (18) → Open (10)** and field was false | Set **true**; pending scheduled trigger for the case deleted |
| **Priority** changes while field is false | Set **true**; pending scheduled trigger deleted |
| Scheduled job at Next Update Due (case still Open) | Set **true** |
| Script Action **Reset Case fields** on event `sn_customerservice.update.event.case` | Set **true** and advance Next Update Due by priority hours (P1=1h, P2=2h, P3=12h, P4=48h) |

**Important:** Setting Require Update with `setWorkflow(false)` (e.g. dictionary read-only workarounds) does **not** attach Update SLA until `TaskSLAController` runs or a normal workflow update recalculates SLAs.

### 4.2 Genuine agent update → Require Update false (Update SLA satisfied)

```
Agent (≠ Opened by, ≠ system) adds Comments or Work notes
on Open case
        │
        ▼
BR "Update Required Update field" (after, order 200)
        │
        ├─ If note is escalation-driven → SKIP (leave true; SLA stays in progress)
        │
        └─ Else → u_require_update = false
                    │
                    ▼
                 Update SLA stop condition met → Completed (satisfied)
                    │
                    ▼
                 BR "Trigger the Scheduled" (order 300) may queue
                 a job to set Require Update true again at Next Update Due
```

### 4.3 Escalate Case (must not satisfy Update SLA)

```
User clicks Escalate Case on Case form
        │
        ▼
Escalation record created (template e.g. Standard Case Escalation)
        │
        ▼
EscalationUtils.appendNote writes Case work notes, e.g.
  - "{user} has requested to escalate this Case. ESC… created."
  - "Escalation ESC… has been approved."
  - "Escalation ESC… has updated: …"
        │
        ▼
Case update fires BR "Update Required Update field"
        │
        ▼
isEscalationNote = true → do NOT set Require Update false
        │
        ▼
Require Update stays true; Update SLA stays In progress
```

**UAT caveat:** If the escalator’s `user_name` equals **Opened by**, the BR’s outer check skips all Require Update logic. Escalation notes still appear, but this BR neither clears nor sets the flag. Prefer testing escalate with a **different** user than Opened by.

### 4.4 Case resolved

When state changes to **Resolved (6)**, BR **Update Worknotes when Case closed** posts SLA summary work notes and clears `u_require_update` / `u_next_update_due_duration`.

---

## 5. Business rule: Update Required Update field

| Property | Value |
|---|---|
| Name | Update Required Update field |
| Table | `sn_customerservice_case` |
| When | After | Update |
| Order | 200 |
| Filter | Open (10) and (state changes **or** comments change **or** work notes change) |
| Sys ID (Dev) | `f54a2a4b93d79a14bdedf87d1dba101e` |

### 5.1 Escalation exclusion (current Dev behavior)

When clearing Require Update to **false**, skip if the latest work note change matches escalation patterns, including:

- `has requested to escalate this`
- `has been approved` / `has approved escalation`
- `has declined escalation`
- `has been closed`
- `Escalation ` … `has updated:`
- `phase has changed` / `trend has changed`

### 5.2 Update set

| Item | Value |
|---|---|
| Name | Exclude Escalation from Require Update BR |
| Application | Customer Service |
| State | Complete |
| Sys ID | `b1a466ff3b278b10c4e908ac24e45a19` |
| Link | https://adcomsolutionsdev.service-now.com/sys_update_set.do?sys_id=b1a466ff3b278b10c4e908ac24e45a19 |
| Local XML | `artifacts/Exclude_Escalation_from_Require_Update_BR.update_set.xml` |

---

## 6. Related automation (reference)

| Name | Type | Role |
|---|---|---|
| Trigger the Scheduled | BR (after, order 300) | After update clears/keeps Require Update true path; schedules flip back to true at Next Update Due |
| Update Due Date Time on Case | BR on `task_sla` | Copies Update SLA `planned_end_time` → case Next Update Due |
| Change Update SLA breached on Case | BR on `task_sla` | Syncs `has_breached` → `u_update_sla_breached` |
| Update Worknotes when Case closed | BR on case | On Resolved: SLA HTML summary; clears Require Update / Next Due |
| Reset Case fields | Script Action | Event `sn_customerservice.update.event.case` → Require Update true + due by priority |
| Escalate Case | UI Action | Opens/creates Escalation for the case |
| Escalation field change handler | BR on escalation | Calls `EscalationUtils.appendNote` / notifications on escalation changes |
| EscalationUtils.appendNote | Script Include | Writes standardized escalation work notes onto the source case |

---

## 7. Personas and test guidance

| Persona | Typical action | Expected Require Update | Expected Update SLA |
|---|---|---|---|
| Agent ≠ Opened by | Adds real work note / comment on Open case with Require Update true | → **false** | → **Completed** |
| Agent ≠ Opened by | Clicks **Escalate Case** while Require Update true | Stays **true** | Stays **In progress** |
| Same as Opened by | Escalates or comments | BR does not flip flag | Unchanged by this BR |
| System / scheduled job | Next Update Due fires | → **true** | New / reset Update SLA can start |

### Suggested UAT cases

1. **Happy path update:** Open case, Require Update true, Update SLA in progress → different user posts work note → flag false, SLA completed.  
2. **Escalate exclusion:** Same setup → different user escalates → flag stays true, SLA stays in progress.  
3. **Opened-by exclusion:** Opened by user escalates → confirm BR does not clear flag (document as known rule).  
4. **Priority / hold paths:** On Hold → Open and priority change set Require Update true and (re)attach Update SLA when workflow runs.

---

## 8. Out of scope / non-goals

- Changing Update SLA durations or schedules.
- Changing Escalation approval templates or `EscalationUtils` note text (guard depends on current message patterns).
- Response SLAs (separate from Update target SLAs).
- Portal / customer-facing escalation UX beyond the Case **Escalate Case** button.

---

## 9. Document control

| Item | Value |
|---|---|
| Source environment | adcomsolutionsdev |
| Validated behaviors | Require Update flips; Update SLA start/stop; Escalate note exclusion; Opened-by skip |
| Companion artifact | Update set *Exclude Escalation from Require Update BR* |
| Related technical objects | BR `Update Required Update field`; SLAs P1–P4 Case Update SLA; `EscalationUtils.appendNote` |
