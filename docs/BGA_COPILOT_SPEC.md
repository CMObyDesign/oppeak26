# BGA Copilot — Ask Solomon as Strategist Case Partner

> **STATUS:** Design spec. Companion to `docs/FUNNEL_TAXONOMY.md`
> (five-lane funnel map) and `docs/brand/PRODUCT_NAMING_AND_LADDER.md`
> (product names + tier IDs). This doc governs how the strategist works
> with Solomon on a specific BGA case from the moment `swot_paid_297`
> is applied through to Email 04 delivery.
>
> **OWNER:** CFO By Design strategy (Miguel) · Spark Agency (engineering).
>
> **CENTRAL SAFETY RULE:** Solomon cannot send Email 04. Only the strategist
> clicking the APPROVE & SEND TO CLIENT button in the Ask Solomon console
> can write `swot_growth_plan` or apply `swot_growth_plan_ready`. That is
> the single human-in-the-loop gate for customer delivery, enforced by
> code the LLM cannot invoke.

---

## 1. The problem this solves

Today `swot_growth_plan` (Part 2 of the Business Growth Analysis) is written
100% by hand in HighLevel. The strategist juggles:

- The client's intake answers (15+ narrative fields in the paid_297 survey).
- Part 1 analysis (`business_playbook`), which was generated from the
  intake, not from verified financials.
- The client's actual financials (uploaded P&L, balance sheet, AR aging,
  tax returns) — reviewed manually, no structured record.
- The strategist brief (`swot_strategist_brief`) — Solomon's internal
  consultant notes about this client.
- The CFO By Design services catalog — what fractional offerings fit,
  which bundles to recommend, pricing, eligibility.
- The actual live conversation on the 50-minute BGA session, where
  priorities get clarified, assumptions get challenged, and the client
  decides what they're actually going to do.

The strategist is doing all synthesis in their head and then typing a
Growth Plan into an HL custom field.

Solomon can help without ever being the deliverer. The strategist stays
the trust boundary for every financial fact and every customer-visible
word; Solomon helps assemble, draft, challenge, and record — then
publishes **only** when the strategist clicks the button.

---

## 2. Shape: one conversational case session, not phase gates

The strategist doesn't think in phases. They think in a conversation about
one client. The system reflects that.

**Load the case → chat with Solomon → steer the draft → preview the email →
click APPROVE & SEND when ready.**

A case session is scoped to one contact. Multiple sessions on the same
contact over multiple days all share the same case state and conversation
history. Resume is cheap.

### 2.1 Loading a case

In the Ask Solomon console, the strategist picks a `swot_paid_297` contact
(dropdown lists all paid_297 contacts, sorted by day-since-purchase so
overdue drafts float up). On selection, the Worker assembles the case
bundle from GHL state and loads it as the conversation's system context.

**What's in the bundle at load time:**

```
CASE: [Business Name] · contactId=<id>
Status: Day N since swot_paid_297 applied (target: ≤5 for first draft)
Classification: <growth | needs-attention | rehab>
Rehab flag: <true | false>
Opportunity flags: <list of _opp tags>

── BGA Intake (client's own words) ──
<every paid_297 narrative field, labeled by section + question number>

── Part 1 Business Growth Analysis ──
<full business_playbook content>

── Strategist Brief (internal) ──
<full swot_strategist_brief content>

── Prior Full Diagnostic (if the client also came through $47) ──
<full swot_full_report content, else "not present">

── Verified Financials ──
<swot_verified_financials, or "Not yet provided — ask Solomon for the
 financial request list to send the client.">

── Case State ──
Financial request list drafted: <yes | no>
Growth plan draft present: <yes | no>
Decisions recorded: <count>
Services selected: <ids or "none">

── Session History ──
<prior turns in this case session, if any>
```

Nothing from this bundle is customer-visible. All of it comes from GHL
state the strategist already has access to.

### 2.2 Session lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Load case                                                 │
│    Strategist picks contact · Worker assembles bundle        │
├──────────────────────────────────────────────────────────────┤
│ 2. Converse                                                  │
│    Strategist asks for the financial request list            │
│    Strategist pastes financials summary after reviewing docs │
│    Strategist asks for the roadmap draft                     │
│    Strategist reviews, iterates on sections                  │
├──────────────────────────────────────────────────────────────┤
│ 3. Live call with client                                     │
│    Strategist dictates / types updates during the call       │
│    Solomon updates draft sections, records decisions,        │
│    records service selections                                │
├──────────────────────────────────────────────────────────────┤
│ 4. Preview                                                   │
│    Strategist asks Solomon to render Email 04 preview        │
│    Reviews what the client will see                          │
├──────────────────────────────────────────────────────────────┤
│ 5. Mark Reviewed · APPROVE & SEND                            │
│    Strategist clicks [Mark Reviewed] after visual check      │
│    [APPROVE & SEND TO CLIENT] button becomes enabled         │
│    Confirm modal → [Confirm and Send]                        │
│    Worker publishes + fires HL automation                    │
└──────────────────────────────────────────────────────────────┘
```

A session can be left open across days. All session state persists per
contact. The ready tag can be applied at most once per contact; the
button refuses after that.

---

## 3. Behavior guidelines for Solomon in a case session

### 3.1 The universal provenance rule (safety invariant)

**Every material conclusion Solomon states — in any tool, in any
output — must be traceable to one of four provenance tags**:

| Tag | What it means | Example |
|-----|--------------|---------|
| `VERIFIED FACT` | Taken from a verified financial entry the strategist recorded in `swot_verified_financials`. Carries the metric name, value, period, and source document. | `[VF: AR_over_90 = $96,800, period=2026-09-30, source=AR_aging.pdf]` |
| `CLIENT-STATED` | Taken from the client's own words in the BGA intake narrative fields. Carries the intake question ID. | `[CS: owner_hiring_plan, from Q_D, "plans to hire 2 in Q1"]` |
| `STRATEGIST JUDGMENT` | A conclusion the strategist entered during the call via `record_decision` or inline edit. Carries a timestamp. | `[SJ: 2026-10-09T14:32, "pricing is the real issue, not AR"]` |
| `SERVICE MATCH` | A service recommendation drawn from the structured services catalog (§7). Carries the service ID and the specific `signals_relevant` catalog entry that matched. | `[SM: fractional_cfo_core, signal=low_margin_visibility]` |

This rule is enforced at the model layer (system prompt directs
Solomon to emit the tag inline with every claim) AND at the Pre-Send
QA layer (§5.3 — any customer-visible claim lacking a provenance tag
is a blocker). The console renders the tags as inline badges so the
strategist can see provenance at a glance; the customer-facing render
strips the tags and leaves clean prose.

The point: Solomon has no path to inventing financial recommendations
from thin air. Every number came from somewhere, and the system knows
where.

### 3.2 Behavior directives (prompt-level)

These go into the system prompt. They are not hard rules in code (the
provenance rule above is the hard rule); they are directions that
shape how Solomon reads the case and talks about it.

- **Keep the review constructive.** Lead with what's working before
  what needs attention. "Positive about the company and the review"
  per the strategist's directive.
- **Challenge assumptions.** When a client's stated goal doesn't
  match their verified numbers, say so plainly with both provenance
  tags visible. Example: "`[CS: Q_H, "want 30% growth in 12 months"]`
  — `[VF: gross_margin_pct=38, period=TTM]`, `[VF: AR_over_60=$185K]`,
  `[CS: concentration_top_3_pct, ~45]`. Growth is possible, but it
  stacks on top of three stability gaps."
- **Flag what's missing before recommending.** If a conclusion
  depends on a fact that isn't verified yet, say so — do NOT fill
  the gap with inference. "I cannot responsibly recommend debt
  restructuring yet: monthly debt service is verified but total
  outstanding debt and terms are missing. See §4.1 `audit_case_gaps`."
- **Change priorities when the strategist tells you to.** The call
  is where real priorities land. Re-render affected sections of the
  draft when a strategist decision is recorded.
- **Discuss what the client can handle internally.** Section 6 of
  the roadmap (Support Gaps) is editable per-item: mark each gap as
  "client handles" or "needs CFO BD" from the call record.
- **Present only cataloged services.** Any service recommendation
  must carry a `SERVICE MATCH` tag to a specific catalog entry. No
  invented offerings, pricing, or deliverables. If no service in the
  catalog matches, Solomon says so plainly rather than guessing.
- **Record what the client actually decided.** Use `record_decision`
  and `record_service_selection`. Decisions flow into Email 04's
  next-steps block only after APPROVE & SEND.
- **Stop at the button.** When the draft is ready, Solomon's final
  move is "Draft looks ready. Run Pre-Send QA, then if 0 blockers,
  click Mark Reviewed and Approve & Send." Solomon does NOT invoke
  a finalize tool. There is no finalize tool.

---

## 4. The strategist toolkit — nine named skills

Not seven anonymous tools; nine named skills inside one case view.
Each has a button in the Ask Solomon console and a corresponding
Worker endpoint. All are password-gated via `checkConsolePassword`
(`x-console-password` header). All scoped to one `contactId` per
call. Every call appends to the session's `/asksolomon/history` row
AND to the case's `swot_bga_version_history` field (§8), with a
visible "wrote to field X" line in the conversation transcript.

| Toolkit button | Underlying tool endpoint | Writes to | Fires HL? |
|---------------|-------------------------|-----------|-----------|
| [ FIND WHAT'S MISSING ] | `audit_case_gaps` | nothing (read-only) | No |
| [ RECORD / REVIEW VERIFIED FINANCIALS ] | `verified_financials_panel` | `swot_verified_financials` (JSON array) | No |
| [ DRAFT ROADMAP ] | `generate_roadmap_draft` | `swot_growth_plan_draft` + applies `swot_growth_plan_drafted` tag | No |
| ↳ *(inline per-section edit)* | `update_roadmap_section` | `swot_growth_plan_draft` (section N only, in place) | No |
| [ MATCH CFO BY DESIGN SERVICES ] | `match_services` | adds `SERVICE MATCH` entries to the current draft | No |
| [ CHALLENGE THIS PLAN ] | `challenge_roadmap` | nothing (read-only adversarial review) | No |
| [ PREP ME FOR THE CALL ] | `generate_prep_brief` | `swot_bga_prep_brief` | No |
| [ PROCESS CALL NOTES ] | `extract_call_decisions` | nothing until strategist confirms → then `swot_bga_decisions` + `swot_bga_services_selected` | No |
| [ RUN PRE-SEND QA ] | `red_team_check` | `swot_bga_red_team_report` | No |
| [ APPROVE & SEND TO CLIENT ] | `approve_and_send` (the button) | `swot_growth_plan`, `swot_bga_next_steps`, `swot_bga_services_selected_display`, applies `swot_growth_plan_ready` | **YES — Email 04 fires** |

`update_roadmap_section` is not a top-level toolkit button; it's an
inline "edit this section" action exposed per-section in the DRAFT
ROADMAP view. The strategist uses it to apply CHALLENGE THIS PLAN
critiques, fix issues flagged by RUN PRE-SEND QA, and incorporate
call-time changes — without regenerating the whole draft. See §4.3.1.
(Codex P1 on #90: without this action in the toolkit, the critique
and QA workflows had no way to apply a correction.)

**There is no `finalize_and_send` tool.** The LLM has no server
endpoint for applying `swot_growth_plan_ready` or writing
`swot_growth_plan`. The button is the only path (§5).

### 4.1 `audit_case_gaps` — FIND WHAT'S MISSING

Runs automatically on every case load; also on demand. Reports:

- Which BGA intake fields are empty.
- Which verified-financial metrics are missing (checked against the
  canonical metric list in §7).
- Whether `swot_full_report` is present (prior Full Diagnostic).
- Whether `swot_strategist_brief` is present.
- Whether `swot_verified_financials` has entries matching the
  verified-financial metrics the LLM would need to make a given
  recommendation ("to recommend debt restructuring, we need
  `monthly_debt_service`, `outstanding_debt_total`, `debt_terms`
  — have 1 of 3"). All three of those are canonical metric IDs in
  §10 item 2, so the strategist can enter every fact the audit asks
  for; `debt_terms` is a free-text field capturing rate, maturity,
  covenants, prepay penalties, and personal guarantees. (Codex P2
  on #92: `debt_terms` was referenced here before being pinned as a
  canonical metric; §10 now includes it.)
- Specific documents or questions to request from the client to
  close each gap.

Read-only. No state changes. Output goes to the conversation.

### 4.2 `verified_financials_panel` — RECORD / REVIEW VERIFIED FINANCIALS

Structured per-metric form in the console. The strategist records
each verified metric with:

```
metric_id:    one of the canonical IDs in §10 item 2
value:        <number or structured value for metrics like ar_30_60_90>
period:       <YYYY-MM-DD or "TTM" or similar>
source_doc:   <filename or GHL file reference>
note:         <optional strategist note>
provenance:   "verified"   ← fixed; this tool writes only verified entries
```

The field `swot_verified_financials` holds a JSON array of these
objects. The console renders them as a table. Each entry's
provenance badge is `VERIFIED FACT`.

**The canonical metric list is pinned in §10 item 2 of this spec.**
That's the single source of truth. `audit_case_gaps`,
`verified_financials_panel`, `match_services` dependency checks, and
the §9 regression tests all read against §10. Any addition requires
a schema PR that updates §10 AND the detectors in `audit_case_gaps`
AND adds a regression test; content-only entries using existing IDs
need no code change. (Codex P2 on #90: eliminated the shadow list
that previously appeared here with `net_profit` and `outstanding_debt`
drift from the §10 canonical names, and corrected the broken pointer
to a nonexistent §7 of the HL setup doc.)

### 4.3 `generate_roadmap_draft` — DRAFT ROADMAP

Pulls Part 1, strategist brief, intake, Full Diagnostic (if
present), verified financials, and the services catalog. Produces
the 8-section draft with "DRAFT · INTERNAL PREP ONLY · NOT FOR
CUSTOMER DELIVERY" banner. Writes to `swot_growth_plan_draft`.
Applies `swot_growth_plan_drafted` tag.

Every claim in the output carries an inline provenance tag per §3.1.
Section 7 (Service Recommendations) is populated by calling
`match_services` as a sub-step; if no catalog entry matches, section
7 says so plainly.

#### 4.3.1 `update_roadmap_section` — inline per-section edit

Not a top-level toolkit button; a per-section action exposed inline
on each section of the DRAFT ROADMAP view. Takes `(contactId,
section_number, new_content)` and overwrites only that section of
`swot_growth_plan_draft` while leaving every other section
unchanged.

Used in three places in the workflow:

- **After CHALLENGE THIS PLAN (§4.5)** — strategist reads the
  critique and applies the specific corrections they agree with to
  the affected sections.
- **After RUN PRE-SEND QA (§4.8)** — strategist resolves a blocker
  by editing the section the blocker names (missing provenance tag,
  internal terminology leak, Miguel-personal pronoun, etc.) and
  re-runs QA.
- **During the live call** — strategist records inline edits when
  priorities change on the call, without regenerating the whole
  draft.

Written content must preserve inline provenance tags for every
material claim (§3.1); `red_team_check` catches any that got stripped
during edit. The edit action appends a `swot_bga_version_history`
entry per §8 so the audit trail captures every per-section change.

### 4.4 `match_services` — MATCH CFO BY DESIGN SERVICES

Reads the structured services catalog (§7). For each identified need
in the current draft:

- Scans `signals_relevant` across all catalog entries.
- Checks `when_not_to_recommend` to exclude.
- Verifies `dependencies` are supportable from verified facts.
- Returns a ranked list of service matches, each with the specific
  signal that matched (`SERVICE MATCH` provenance tag).

Writes the matches into the current draft's Section 7. Standalone
read-only mode also available ("show me what services would match
without changing the draft").

### 4.5 `challenge_roadmap` — CHALLENGE THIS PLAN

Read-only adversarial self-review. Takes the CURRENT draft (post any
edits), runs an LLM pass with explicit "poke holes" framing. Returns
a critique:

- "Is this treating a symptom as the cause?"
- "Is the recommended hire supportable from verified cash + revenue?"
- "Is service X recommended because it fits, or because we sell it?"
- "Does priority #2 depend on #1 — and have we said so?"
- "Are we certain about this 12-month item, or should it be a
  reassessment goal?"

Does NOT change state. Does NOT touch any field. The strategist reads
the critique and manually updates sections via `update_roadmap_section`
if they agree.

### 4.6 `generate_prep_brief` — PREP ME FOR THE CALL

One-screen condensed briefing drawn from the current draft. Not a
summary — a specific prep sheet with these sections only:

```
Top 3 financial priorities (ranked, with VF provenance)
Verified facts supporting each one
Assumptions still needing validation
Questions Miguel should ask
90-day roadmap preview
Likely objections or concerns
Services worth discussing (with SM provenance)
Services NOT to recommend (with reason)
Decisions the call needs to produce
```

Writes to `swot_bga_prep_brief`. Does not fire anything. Likely more
day-to-day useful than reading the full draft.

### 4.7 `extract_call_decisions` — PROCESS CALL NOTES

Takes free-form call notes pasted by the strategist (or, future, a
transcript). Parses them into a structured record:

```
Priorities confirmed
Priorities changed
Client corrections (to verified facts or intake answers)
90-day commitments
6-month direction
12-month goals / reassessment
Next steps
Services discussed
Services selected
Services declined / deferred
Follow-up needed
```

**Nothing is committed until the strategist confirms it.** The tool
returns the parsed structure for review; a separate "Confirm
decisions" action writes to `swot_bga_decisions` and
`swot_bga_services_selected`.

### 4.8 `red_team_check` — RUN PRE-SEND QA

**Mandatory before APPROVE & SEND TO CLIENT becomes enabled.** See
§5.3 for the full blocker/warning checklist. Writes the result to
`swot_bga_red_team_report`. The button endpoint (§5.2) refuses unless
the latest red-team report has 0 blockers.

### 4.9 `approve_and_send` — APPROVE & SEND TO CLIENT (the button)

Only path to writing `swot_growth_plan` and applying
`swot_growth_plan_ready`. Preconditions, write ordering, and
guardrails in §5.

---

## 5. The button — the only path to delivery

**UI**: `[APPROVE & SEND TO CLIENT]` button in the case view.

### 5.1 Preconditions

All enforced server-side on the endpoint, not just UI:

1. Caller is authenticated via `checkConsolePassword`
   (`x-console-password` header).
2. `contactId` has `swot_paid_297` applied.
3. `swot_growth_plan_draft` field is populated and non-empty.
4. **The latest `swot_bga_red_team_report` for this contact has 0
   blockers** (§5.3). The button is disabled in the UI until this is
   satisfied; the endpoint re-verifies server-side.
5. The request body includes `reviewed: true` — set when the
   strategist clicks the separate `[Mark Reviewed]` toggle in the
   console after reading the final draft AND the red-team report.
6. `swot_growth_plan_ready` is NOT already present on the contact
   (idempotent refusal).

### 5.2 UI flow

```
Strategist reviews final draft in the case view
         ↓
Clicks [RUN PRE-SEND QA]  ← runs red_team_check (§5.3)
         ↓
Red-team report returned with blockers/warnings counts
         ↓ (if blockers > 0, strategist fixes and re-runs)
0 blockers  →  [Mark Reviewed] toggle becomes available
         ↓
Clicks [Mark Reviewed]  ← sets a UI flag
         ↓
[APPROVE & SEND TO CLIENT] button becomes enabled
         ↓
Click button → modal:

    ┌────────────────────────────────────────┐
    │ Send Business Growth Plan to [Client]? │
    │                                        │
    │ This will:                             │
    │  • Write final roadmap →               │
    │    swot_growth_plan                    │
    │  • Write next-steps block →            │
    │    swot_bga_next_steps                 │
    │  • Record service selections →         │
    │    swot_bga_services_selected          │
    │  • Apply swot_growth_plan_ready tag    │
    │    → Email 04 fires                    │
    │                                        │
    │       [Cancel]    [Confirm and Send]   │
    └────────────────────────────────────────┘
         ↓
[Confirm and Send]
         ↓
POST /asksolomon/case/approve-and-send
   headers: x-console-password: <CONSOLE_PASSWORD>
   body: { contactId, reviewed: true }
```

**Auth note**: the endpoint uses the existing `checkConsolePassword`
helper on `worker/src/index.js`, which reads the `x-console-password`
header for consistency with every other `/asksolomon` API. There is no
separate auth path for the button.

### 5.3 Pre-Send QA checklist (`red_team_check`)

Each item is categorized as **BLOCKER** (prevents send) or
**WARNING** (requires explicit strategist acknowledgment but can
proceed). The checklist runs against the current `swot_growth_plan_draft`,
`swot_bga_decisions`, and `swot_bga_services_selected`.

**Blockers** (any one present → button disabled, must fix):

1. Service marked "selected" when the catalog match only ranked it
   as "recommended" (status elevation requires explicit
   `record_service_selection` call, not just a catalog match).
2. Financial claim in customer-visible copy with no `VERIFIED FACT`
   or `CLIENT-STATED` provenance tag.
3. Service recommendation in customer-visible copy without a
   `SERVICE MATCH` provenance tag tied to a specific signal.
4. Missing 90-day priorities section.
5. Internal terminology detected in customer copy. Banned terms
   from `docs/brand/PRODUCT_NAMING_AND_LADDER.md`: `SWOT`, `rubric`,
   `paid_297`, `Deep Dive`, `business_playbook`, `Business Health
   Analysis`, `deep-dive analysis`, and the internal path labels
   `rehab`/`urgent`/`strong` in customer-visible contexts.
6. Miguel-personal pronoun ("I will…", "my team will…") in
   customer-visible copy. The customer-facing copy speaks for CFO By
   Design, not for one strategist by name.

**Warnings** (any present → checkbox to acknowledge, then can proceed):

1. A 12-month item presented as a certain outcome rather than a
   reassessment goal.
2. 6-month section is noticeably shorter than the 90-day section
   (likely under-developed).
3. An intake answer and a verified financial fact disagree
   (e.g. intake says 45% margin, verified says 38%) and the draft
   does not call out the gap.
4. A service listed in the catalog with current
   `when_not_to_recommend` conditions present is still in the
   recommendations list.

The red-team report writes to `swot_bga_red_team_report` as:

```json
{
  "run_at": "<ISO timestamp>",
  "blockers": [
    { "id": "service_elevation_without_decision",
      "where": "section 7, item 3",
      "detail": "..." }
  ],
  "warnings": [...],
  "acknowledged_warnings": [],
  "inputs_checked": {
    "draft_hash":                "sha256:<hex of swot_growth_plan_draft content at run_at>",
    "decisions_hash":            "sha256:<hex of swot_bga_decisions content at run_at>",
    "selections_hash":           "sha256:<hex of swot_bga_services_selected content at run_at>",
    "verified_financials_hash":  "sha256:<hex of swot_verified_financials content at run_at>",
    "intake_bundle_hash":        "sha256:<hex of the paid_297 intake-answer subset the warnings read, canonicalized at run_at>",
    "catalog_ref":               "<git SHA of worker/data/service_catalog.json at run_at>"
  }
}
```

The button endpoint re-verifies this field at request time with
**both** checks:

1. **No blockers in the latest report** (same as before).
2. **Every input hash still matches the current content.** The
   report binds all six inputs any rule in §5.3 could read:
   - `draft_hash` — the roadmap body
   - `decisions_hash` — call decisions log
   - `selections_hash` — service selections
   - `verified_financials_hash` — the facts warning 3 (intake vs.
     verified disagreement) checks against intake
   - `intake_bundle_hash` — the paid_297 intake narrative fields
     warning 3 reads
   - `catalog_ref` — the services catalog version warning 4
     (service with `when_not_to_recommend` conditions still
     recommended) evaluated against

   If any input differs from the current content, the report is
   stale. The endpoint refuses with `409 "red-team report is stale;
   re-run RUN PRE-SEND QA before sending"` and names which input
   changed. (Codex P1 on #90 + follow-up P1 on #92: without binding
   every input the QA actually reads, the strategist could red-team
   a clean draft, then change a verified financial or catalog entry,
   and ship stale QA.)

If a warning is unacknowledged, the UI shows an acknowledgment
checkbox; on acknowledgment the `acknowledged_warnings` array
updates. Acknowledging a warning does NOT revalidate the input
hashes — a content edit after acknowledgment still invalidates the
report.

### 5.4 Server endpoint behavior (`handleApproveAndSend` in `worker/src/index.js`)

Step order is intentional and the only correct sequence. Writes before
tag so the Email 04 merge fields are populated by the time the HL
workflow fires. The D1 lock insert happens BEFORE any external write
so a concurrent request is refused before it can observe stale state.

1. Verify password (via `checkConsolePassword`), `reviewed=true`, draft
   present, `swot_paid_297` present. Refuse (401/400/409 respectively)
   otherwise.
2. **Validate the red-team report before any external write.** Load
   `swot_bga_red_team_report`. Refuse unless:
   - the report exists (no QA yet → `409 "run RUN PRE-SEND QA
     before sending"`),
   - `blockers` is empty (any blocker → `409 "red-team blockers
     present"` naming each one),
   - every `warnings` entry has a matching entry in
     `acknowledged_warnings` (any unacknowledged → `400
     "unacknowledged warnings present"` naming them), AND
   - every hash in `inputs_checked` matches the current content for
     that input (compute SHA-256 of the current `swot_growth_plan_draft`,
     `swot_bga_decisions`, `swot_bga_services_selected`,
     `swot_verified_financials`, the canonical intake-bundle, and the
     catalog SHA, in exactly the shape the report hashed at run_at;
     any mismatch → `409 "red-team report is stale; re-run RUN
     PRE-SEND QA before sending"` naming which input changed).

   Capture the content read in this step into an in-memory
   `send_bundle` (draft, decisions, selections) that is reused for
   rendering in step 5. The approve path renders the exact bytes
   that the QA passed; a later edit between this check and the
   render cannot slip through. (Codex P2 on #92: without this step
   explicitly before the lock + render, an implementer following
   §5.4 numbered sequence could skip the gate the §5.3 prose
   requires.)
3. **Acquire send lock atomically**: `INSERT INTO bga_send_locks
   (contact_id, acquired_at) VALUES (?, ?)` on the D1 `SOLOMON_DB`
   binding. The table has `contact_id TEXT PRIMARY KEY`, so a
   duplicate insert raises a UNIQUE constraint error. On conflict,
   fetch the existing row and return `409 "Already sent at
   <acquired_at>."`. This insert is the only serialization point —
   two concurrent approvals for the same contact race on this INSERT,
   one wins, the other 409s before it reaches any GHL call. Same
   mechanism also covers the idempotency promise.
4. Fetch the contact's current tags via GHL. If
   `swot_growth_plan_ready` is somehow already present (e.g. applied
   out-of-band in HL), roll back the lock row (`DELETE WHERE
   contact_id = ?`) and return `409 "Already sent (ready tag present
   on contact)."`. This defends against a desynced lock table and the
   small window between step 3 and step 7.
5. Render the final customer-facing Growth Plan HTML from the
   `send_bundle.draft` captured in step 2 (strip the "DRAFT · INTERNAL"
   banner; apply customer-facing styling). Use the step-2 bundle, not
   a fresh read — the point of hashing in §5.3 is that only the
   exact bytes QA passed may ship.
6. Render the next-steps block from `send_bundle.decisions`.
7. Render the services selection summary from `send_bundle.selections`.
8. `updateGHLContact(contactId, [
     { key: "swot_growth_plan", field_value: <rendered plan> },
     { key: "swot_bga_next_steps", field_value: <rendered next steps> },
     { key: "swot_bga_services_selected_display",
       field_value: <rendered selections> }
   ])` — all three fields in one HL call so a partial write doesn't
   leave a mixed state.
9. ONLY if (8) returns ok, `addGHLTag(contactId,
   ["swot_growth_plan_ready"])`.
10. Return `{ success: true }` to the console. The lock row stays as
    the permanent send record.
11. **On any failure after step 3** (GHL fetch, writeback, tag apply):
    delete the lock row (`DELETE FROM bga_send_locks WHERE contact_id
    = ?`) so a corrected retry is possible, do NOT apply the tag, and
    return `{ success: false, error: "<step>: <reason>" }`. The
    strategist sees exactly which step failed and nothing partially
    fired. For the specific case of (9) failing after (8) succeeded,
    the error message tells the strategist to apply
    `swot_growth_plan_ready` manually in HL — the writes landed, only
    the tag didn't, and HL has no idempotency on the tag so re-running
    the whole endpoint would re-write the fields.

**Idempotency**: enforced at the D1 lock insert in step 3. A second
click lands within milliseconds of the first and loses the INSERT race;
hours or days later it still finds a row and returns the same 409.
Either way, the second request cannot reach the GHL writes, cannot
re-apply the tag, cannot re-send Email 04.

**Why D1-backed, not in-memory**: Workers isolates are not long-lived
and don't share state across requests to different isolates. A
per-isolate mutex would only protect one isolate's double-clicks.
D1's SQLite primary-key uniqueness is strongly consistent for writes
to the same database (see Cloudflare D1 consistency guarantees) and
is the right tool for a cross-isolate serialization point.

---

## 6. HL field + tag inventory

**Note on types**: HL only exposes flat types — LARGE_TEXT is the
only one that fits our structured-data needs. Fields marked
"LARGE_TEXT (JSON)" store a JSON string in the HL field; the Worker
and console serialize/deserialize at the boundary. HL merge-field
rendering of these in customer emails would ship raw JSON — so none
of the JSON-shaped fields are customer-facing. The two customer-facing
fields (`swot_bga_next_steps`, `swot_bga_services_selected_display`)
hold rendered HTML written by the button endpoint only.

### New fields in the HL custom field catalog

| Field | HL type · code shape | Written by | Customer-facing? |
|-------|---------------------|-----------|------------------|
| `swot_financials_request_list` | LARGE_TEXT (prose) | `audit_case_gaps` + `generate_financial_request` | No — internal strategist use |
| `swot_verified_financials` | LARGE_TEXT (JSON array of `{metric_id, value, period, source_doc, note, provenance}`) | `verified_financials_panel` | No — Solomon's input |
| `swot_growth_plan_draft` | LARGE_TEXT (prose with inline provenance tags + "DRAFT · INTERNAL" banner) | `generate_roadmap_draft` + `update_roadmap_section` + `match_services` | No — internal prep |
| `swot_bga_decisions` | LARGE_TEXT (JSON array of `{at, text, type, actor}`) | `extract_call_decisions` (after strategist confirms) | No — Solomon's input to the final next-steps render |
| `swot_bga_services_selected` | LARGE_TEXT (JSON array of `{service_id, status: "selected" \| "declined" \| "deferred", reason}`) | `extract_call_decisions` (after strategist confirms) | No — Solomon's input to the final selection render |
| `swot_bga_prep_brief` | LARGE_TEXT (prose, one-screen) | `generate_prep_brief` | No — internal strategist use |
| `swot_bga_red_team_report` | LARGE_TEXT (JSON — see §5.3) | `red_team_check` | No — internal strategist use |
| `swot_bga_version_history` | LARGE_TEXT (JSON array of `{at, actor, action, affected_field, snapshot_hash}`) | **appended by every BGA tool call** (§8) | No — audit trail |
| `swot_bga_services_catalog_ref` | LARGE_TEXT (plain string: the first 12 hex chars of SHA-256 of the catalog JSON — see §7.1) | `generate_roadmap_draft` + `match_services` | No — audit trail |
| `swot_bga_next_steps` | LARGE_TEXT (rendered HTML) | **button endpoint only** | **Yes — merged into Email 04** |
| `swot_bga_services_selected_display` | LARGE_TEXT (rendered HTML) | **button endpoint only** | **Yes — merged into Email 04** |

### Existing fields unchanged

| Field | Role |
|-------|------|
| `swot_growth_plan` | **Button endpoint only.** Customer-facing final roadmap. Unchanged contract. |

### Status of PR #89 (already merged)

PR #89 landed the first seven fields in the HL custom-field catalog
with LARGE_TEXT type. The additional four fields above
(`swot_bga_prep_brief`, `swot_bga_red_team_report`,
`swot_bga_version_history`, `swot_bga_services_catalog_ref`) need to
be added in a follow-up HL-config step before the Worker + console
build begins. See `docs/BGA_COPILOT_HL_SETUP.md` §1 for the
step-by-step; the four new fields follow the same creation profile
(LARGE_TEXT, grouped under "BGA / Solomon", **Contact object**, not
on any public form).

### New tags to add

| Tag | Applied by | Purpose |
|-----|-----------|---------|
| `swot_growth_plan_drafted` | `generate_roadmap_draft` tool | Signals "prep done; call-ready." Already covered in PR #89. |

### Existing tags unchanged

| Tag | Role |
|-----|------|
| `swot_growth_plan_ready` | **Button endpoint only.** Fires HL Email 04 workflow. Unchanged contract. |

---

## 7. Structured services catalog

The catalog is the single source of truth for what CFO By Design
offers, when each offering applies, and how Solomon talks about them.
Not a PDF Solomon "reads"; a structured JSON file the Worker loads
and matches against.

### 7.1 Location and version control

**File**: `worker/data/service_catalog.json`
**Companion**: `docs/services/CATALOG_SCHEMA.md` (JSON Schema +
glossary of what each field means)
**Versioning**: committed to git; every change is a PR. The catalog
version `swot_bga_services_catalog_ref` records is the first 12 hex
characters of the SHA-256 of the parsed catalog JSON — a
content-addressable identifier that is stable across:

- cosmetic reformats (same content → same version),
- branches (two commits with identical catalog content, same version),
- Worker-only deploys without a catalog change (the recorded version
  does not drift just because the Worker redeployed).

A commit-SHA-based identifier would change on every unrelated commit
and would need a build-time inject through Workers Builds. The
content hash satisfies the audit-trail intent (a successful match
can be correlated with the exact catalog JSON that produced it) and
is derivable in the Worker without build-time plumbing. (Codex P2
on #97: previous spec text said "commit SHA"; the content hash is
what the implementation records and this clarification brings the
spec in line with the shipping behavior.)

### 7.2 Per-service schema

```json
{
  "service_id": "fractional_cfo_core",
  "name": "Fractional CFO — Core",
  "problem_solved": "Owner has no forward cash visibility and no
     monthly rhythm for financial review.",
  "signals_relevant": [
    "low_margin_visibility",
    "ar_concentration_risk",
    "no_13_week_cash_forecast",
    "monthly_close_absent_or_late"
  ],
  "when_not_to_recommend": [
    "active_tax_default",
    "legal_distress",
    "revenue_band_below_500k"
  ],
  "deliverables": [
    "Monthly close review with Miguel",
    "13-week rolling cash forecast",
    "Quarterly strategy session",
    "..."
  ],
  "client_responsibility": [
    "Bookkeeper closes books by day 7 of each month",
    "Owner attends monthly review",
    "..."
  ],
  "cfobd_responsibility": [
    "Review and interpret monthly financials",
    "Maintain 13-week cash forecast",
    "..."
  ],
  "pricing": {
    "model": "monthly_retainer",
    "amount_usd": 0,
    "min_term_months": 0,
    "note": "pricing TBD by Miguel"
  },
  "bundle_eligibility": {
    "included_in_bundles": ["premium_cfo_bundle"],
    "pairs_well_with": ["bookkeeping_cleanup", "cash_management_core"],
    "replaces": []
  },
  "dependencies": [
    "Must have reliable bookkeeping — if books are >60 days behind,
     recommend bookkeeping_cleanup first."
  ],
  "talking_points": [
    "This is the ongoing rhythm, not a one-time fix.",
    "You keep the day-to-day; we hold you to the plan."
  ]
}
```

### 7.3 Content ownership

- **Schema**: owned by this repo. Changes to the schema require a
  PR to `docs/services/CATALOG_SCHEMA.md` AND updates to any tool
  (`match_services`, `red_team_check`) that reads the field.
- **Content**: owned by Miguel. He fills in services with their real
  problem-solved, signals, when-not, deliverables, pricing. PRs
  updating `worker/data/service_catalog.json` are content-only.
  Spark reviews for schema conformance before merge.
- **Initial scaffold**: `worker/data/service_catalog.json` ships
  with 1-2 placeholder entries so the Worker can be built and
  tested against something. Build PRs refer to real entries only
  once Miguel's catalog content lands.

### 7.4 How Solomon uses the catalog

- `match_services` iterates the catalog, scores each service's
  `signals_relevant` against the current case's verified facts +
  intake answers, filters out any service with a current
  `when_not_to_recommend` condition met, and returns a ranked list.
- Every service recommendation Solomon emits carries a `SERVICE
  MATCH` provenance tag with the specific signal that matched.
- `red_team_check` blocks any service recommendation in customer
  copy that lacks a `SERVICE MATCH` tag.
- The `swot_bga_services_catalog_ref` field records the catalog
  SHA at draft time so later version-history audits can tell which
  catalog version was in effect.

---

## 8. Audit trail / version history

Financial recommendations need an auditable record of what Solomon
drafted, what Miguel edited, what the call changed, and what was
finally sent. The spec encodes this at the field level, not as a
separate database.

### 8.1 `swot_bga_version_history` — the per-case audit log

Every BGA tool call appends an entry:

```json
{
  "at": "2026-10-09T14:32:11Z",
  "actor": "console_session",
  "action": "generate_roadmap_draft",
  "affected_field": "swot_growth_plan_draft",
  "snapshot_hash": "sha256:abc123...",
  "catalog_ref": "sha:7f0a9b2"
}
```

Important caveats about what this log IS and ISN'T:

- `actor` is `"console_session"` — a flag that the write came
  through a `checkConsolePassword`-authenticated request. **The
  current console auth is a shared password; it does NOT identify
  which strategist on the team ran the action.** Hard-coding
  `miguel@cfobydesign.com` would misattribute every teammate's
  changes. Per-user attribution requires an auth upgrade (per-user
  console accounts or signed strategist tokens) — tracked as a
  future revision, not shipped in the toolkit build. (Codex P2 on
  #90.)
- `snapshot_hash` is a SHA-256 of the field's new content and is
  **best-effort audit, not forensic tamper-evidence**. The hash sits
  next to the content in the same writable HL field, so anyone who
  can modify the audited content can also recompute the hash and
  rewrite the history entry. For true tamper-evidence we would
  need: (a) chained hashes (entry N includes entry N-1's hash),
  (b) server-side signing with a key not stored in HL, and (c)
  anchoring hashes in append-only storage. All three are future
  revisions. For now the log is informative — it shows what
  happened in the normal course of operation and gives a diffable
  record for review, but it is not evidence that would survive an
  adversarial dispute. (Codex P2 on #90.)
- Full-content snapshots live in the `/asksolomon/history` row for
  the session; the version-history field is the index.
- The red-team check and the approve-and-send call both append
  entries. The approve entry includes the final content hash so
  routine review can trace the exact bytes delivered to the client
  under the audit model above.

### 8.2 Why in the HL field, not a separate DB

The case lives on the GHL contact. Keeping the version history on
the same contact means every reader (strategist, Miguel, Spark ops)
sees the same record without a second query. It also means the
version history is backed up and exportable through the same channel
as every other BGA field.

Caveat: HL LARGE_TEXT fields have a size limit. The log is bounded
by capping entries to ~50 per contact (older entries get written to
R2 under `bga_audit/<contact_id>/<yyyy-mm>.json` when the field
would otherwise overflow). Build PR for version history includes the
R2 spillover logic.

---

## 9. Guardrails pinned in regression tests

Each of these is a test that must stay green on every PR.

1. `/asksolomon/case/*` tool endpoints never write `swot_growth_plan`
   and never apply `swot_growth_plan_ready`. One test per tool.
2. `generate_roadmap_draft` renders content with the "DRAFT · INTERNAL
   PREP ONLY · NOT FOR CUSTOMER DELIVERY" banner at the top.
3. `POST /asksolomon/case/approve-and-send` refuses without a valid
   `x-console-password` header (via `checkConsolePassword`) → 401.
4. Approve-and-send refuses without `reviewed=true` → 400.
5. Approve-and-send refuses without `swot_growth_plan_draft` present →
   409 "no draft to send."
6. Approve-and-send refuses without `swot_paid_297` present → 403.
7. Approve-and-send refuses when `swot_growth_plan_ready` is already
   applied → 409 "already sent (ready tag present on contact)."
8. **Concurrent-approval serialization**: two parallel approve calls
   for the same contact — the first wins the D1 lock insert, writes
   the fields, applies the tag; the second observes the unique
   constraint failure on `bga_send_locks` and returns 409 before any
   GHL call. Test asserts exactly one GHL writeback and exactly one
   `addGHLTag` observed across both requests.
9. Approve-and-send writes `swot_growth_plan` + `swot_bga_next_steps` +
   `swot_bga_services_selected_display` BEFORE applying the ready tag.
   Simulate a writeback failure and confirm the tag is NOT applied AND
   the lock row is deleted so a corrected retry is possible.
10. Approve-and-send is the ONLY code path in the Worker that writes
    `swot_growth_plan` or applies `swot_growth_plan_ready`.
    (Grep-based test: no other call site exists.)
11. **Red-team check blocker gates the button**: a draft with any
    blocker in `swot_bga_red_team_report` returns 409
    "red-team blockers present" from the approve endpoint. Test
    seeds each blocker type (§5.3) and asserts the refusal.
12. **Red-team check warnings require acknowledgment**: a draft with
    unacknowledged warnings in `swot_bga_red_team_report` returns
    400 "unacknowledged warnings present". Test seeds a warning,
    confirms refusal, then updates `acknowledged_warnings` and
    confirms the subsequent approve call succeeds.
13. **Provenance tags in customer-visible output**: `red_team_check`
    scans the current draft and flags any customer-visible financial
    claim or service recommendation missing a provenance tag as a
    blocker. Test seeds a draft with (a) a bare financial claim with
    no tag → blocker, (b) a service recommendation with no `SERVICE
    MATCH` tag → blocker, (c) a well-tagged draft → no blockers.
14. **Services catalog match integrity**: `match_services` returns
    only services whose `signals_relevant` currently match the case
    AND whose `when_not_to_recommend` conditions are not met. Test
    seeds a catalog with one service that would normally match
    plus a `when_not_to_recommend` condition that IS currently met;
    confirms the service is excluded.
15. **Version history appends on every tool call**: every tool-call
    endpoint writes a new entry to `swot_bga_version_history`
    (with timestamp, actor, action, affected field, snapshot hash,
    catalog ref). Test calls three different tools and asserts the
    log length and ordering.
16. **No `finalize_and_send` endpoint exists**: grep-based test
    confirms no handler or route named `finalize_and_send`, nor any
    other `/asksolomon/case/*` route that writes `swot_growth_plan`.
17. **Red-team report is bound to the exact inputs it checked**
    (Codex P1 on #90 + follow-up P1 on #92). Scenario: run
    `red_team_check` on a draft with no blockers; confirm the
    report stores `inputs_checked` hashes for all six inputs
    (`draft_hash`, `decisions_hash`, `selections_hash`,
    `verified_financials_hash`, `intake_bundle_hash`,
    `catalog_ref`). Then call `update_roadmap_section` to change
    one section; attempt `approve_and_send` — must return 409
    "red-team report is stale; re-run RUN PRE-SEND QA" naming
    `draft_hash` as the changed input. Re-run `red_team_check`;
    the new report's hashes match; approve now succeeds. Repeat
    the scenario for each of: `swot_bga_decisions` edit,
    `swot_bga_services_selected` edit, `swot_verified_financials`
    edit, a change to the intake-answer subset the warnings read,
    and a services-catalog SHA bump — each must trigger the 409
    naming the specific input that changed.
18. **`update_roadmap_section` edits only the named section** and
    appends a version-history entry. Scenario: generate a draft with
    8 sections, call `update_roadmap_section(3, new_content)`,
    confirm section 3's content changed and sections 1-2, 4-8 are
    byte-identical to before. Confirm the version history grew by
    one entry with `action: "update_roadmap_section"` and
    `affected_field: "swot_growth_plan_draft"`.

---

## 10. What's needed from the strategist before launch

Solomon's job is drafting against the strategist's inputs. Four
content artifacts only Miguel + CFOBD can produce; everything else
I can scaffold.

1. **Services catalog content** — the actual CFO By Design fractional
   services, each conforming to the §7.2 schema. Content-only PRs
   against `worker/data/service_catalog.json`. Spark reviews for
   schema conformance; Miguel owns the content. Until this exists,
   §7 of every draft renders the placeholder "Services catalog
   entries pending — complete this section from prep notes" and
   `red_team_check` relaxes the SERVICE MATCH requirement for that
   section only (loud warning, not a blocker, until a non-empty
   catalog ships).
2. **Verified-financials metric list — confirmed canonical set.**
   The current working list (reflected in `audit_case_gaps` and the
   verified-financials panel):

   ```
   cash_on_hand
   revenue_ttm
   gross_margin_pct
   net_profit_pct
   ar_30_60_90           (structured object: {d30, d60, d90_plus})
   monthly_debt_service
   outstanding_debt_total
   debt_terms            (text: rate, maturity, covenants, prepay penalties, personal guarantees)
   working_capital
   tax_status            (enum: current | behind | in_default)
   ```

   Confirm or revise this list before PR 3 (verified-financials
   panel) is built. Each metric added later costs a schema change.
3. **Pre-Send QA blocker/warning split — confirmed.** §5.3 lists 6
   blockers and 4 warnings. Confirm or adjust before PR 9 lands;
   this split is baked into `red_team_check` as rule logic.
4. **Call-notes input shape — confirmed.** Default: free-form
   paste. `extract_call_decisions` parses into the structured
   record for strategist confirmation. If the input shape should
   be a structured template or future transcript ingestion, pin
   that here before the tool is built.

---

## 11. Build order

Reshuffled per the user's §11 toolkit vision. Each row is one PR,
mergeable independently.

| PR | What it ships | Depends on |
|----|---------------|------------|
| **1** | HL custom field catalog adds (PR #89 — **merged**: 7 fields + 1 tag). Plus a follow-up adding the four additional fields now required: `swot_bga_prep_brief`, `swot_bga_red_team_report`, `swot_bga_version_history`, `swot_bga_services_catalog_ref`. HL-side config only. | Nothing |
| **2** | **Services catalog scaffold**: `worker/data/service_catalog.json` with 1-2 placeholder entries + `docs/services/CATALOG_SCHEMA.md` JSON Schema. Content-less structural landing. | Nothing (parallel to PR 1 follow-up) |
| **3** | **Verified-financials panel**: `verified_financials_panel` tool + UI table + `audit_case_gaps` tool that uses the metric list. First tool with user-visible value. | PR 1 + PR 2 |
| **4** | **Worker + console scaffolding**: `/asksolomon/case/load` + case view UI (read-only — assembles and displays the bundle, auto-runs `audit_case_gaps` on load). | PR 3 |
| **5** | **Draft Roadmap**: `generate_roadmap_draft` tool + `update_roadmap_section` inline per-section edit (§4.3.1) + 8-section prompt + inline provenance tags + "DRAFT · INTERNAL" banner. Uses catalog if content exists, placeholder otherwise. | PR 4 |
| **6** | **Match Services**: `match_services` tool + sub-step inside DRAFT ROADMAP. Depends on catalog having real content for its output to be useful. | PR 5 (works end-to-end once Miguel fills in the catalog) |
| **7** | **Pre-Call Brief**: `generate_prep_brief` tool + its field write. | PR 5 |
| **8** | **Challenge My Plan**: `challenge_roadmap` tool (read-only adversarial pass). | PR 5 |
| **9** | **Call Notes → Decisions**: `extract_call_decisions` tool + "Confirm decisions" action that writes `swot_bga_decisions` and `swot_bga_services_selected`. | PR 5 |
| **10** | **Version history**: `swot_bga_version_history` write wrapper that every tool call goes through + R2 spillover for overflow entries. Refactor existing tools to use it. | PR 5–9 landed |
| **11** | **Email 04 template update** (`04_deep_dive_part2.html` + preview mirror) to merge in `{{contact.swot_bga_next_steps}}` and `{{contact.swot_bga_services_selected_display}}`. Pre-condition for PR 12 — template-only, zero fire risk, lands FIRST. | PR 1 |
| **12** | **Pre-Send QA + Finalize + the button**: `red_team_check` tool + **all six blocker rules** and all four warning rules from §5.3 + input-hash binding in the report + `[Mark Reviewed]` toggle + `[APPROVE & SEND TO CLIENT]` button + modal + D1 migration `bga_send_locks` + `POST /asksolomon/case/approve-and-send` (verifies hashes + no blockers + lock + preconditions) + all §9 regression tests. | PR 10 + PR 11 |
| **13** | **Public copy update** (post-launch, not blocking build): rewrite sales page + FAQ statements promising "written plan before the 50-minute session." Touch at least `app/public/deep-dive-sales/` and any FAQ copy. | PR 12 |
| **14** | **Document extraction** (optional, later): PDF/Excel parsing of uploaded financial docs with [VERIFY] [EDIT] [REJECT] confirmation flow. Only verified values enter `swot_verified_financials`. | PR 12 |

PR 11 (template) MUST precede or ship atomically with PR 12 (button).
Reversing them creates a window where an approval fires the current
template, which doesn't include the new merge fields — the next-steps
block and service selections would silently be omitted from the
client email (Codex P1 on #87). PR 13 and PR 14 are optional
post-launch improvements; the toolkit is production-ready once PR 12
lands.

The build order observes two safety rules:
- No tool can write `swot_growth_plan` or apply
  `swot_growth_plan_ready` until PR 12.
- Red-team check (PR 12) gates the button and depends on provenance
  tags from PRs 5–6 and the catalog from PR 2 (and its content from
  Miguel). The button cannot usefully ship before the pieces it
  needs to red-team against.

---

## 12. Change control

Updates to this document require:

1. The code paths they govern updated in the same PR (worker handler,
   tool endpoint, console UI, test file).
2. If a new tool is added that writes or signals state — update
   `docs/FUNNEL_TAXONOMY.md` HL triggers inventory to list the new
   write.
3. Any change that affects what the strategist sees or does must be
   reviewed by Miguel before merge.
4. Any change that touches the button endpoint's preconditions,
   write ordering, or guardrails must keep every §9 regression test
   green. The ready tag's single code path is a safety invariant,
   not a design detail.
5. Any change that touches the universal provenance rule (§3.1) is
   a safety-rule change. Must land with: a `red_team_check` rule
   update, a regression test for the new rule, and explicit sign-off
   from Miguel. The point of the four provenance tags is that
   there's no silent escape hatch — expanding or weakening the rule
   needs the same scrutiny as touching the button endpoint.
6. Services catalog content changes (`worker/data/service_catalog.json`)
   land as content-only PRs reviewed by Spark for schema conformance
   and by Miguel for substance. Schema changes
   (`docs/services/CATALOG_SCHEMA.md`) land separately as code PRs
   that update `match_services` and `red_team_check` in the same
   diff.
