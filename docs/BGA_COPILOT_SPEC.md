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

These go into the system prompt that governs Solomon on BGA case
sessions. They are not hard rules in code; they are directions for the
model.

- **Keep the review constructive.** Lead with what's working before
  what needs attention. "Positive about the company and the review" per
  the strategist's directive.
- **Challenge assumptions.** When a client's stated goal doesn't match
  their numbers, say so plainly. Example: "They want 30% growth in 12
  months. Trailing-12 margin is 38%, AR >60 is $185K, concentration risk
  is ~45% top-3. 30% growth is possible, but it stacks on top of three
  stability gaps. Worth asking: do they want growth or stability first?"
- **Clarify missing facts.** Keep a running `clarifications_needed`
  list and surface items whenever a recommendation would depend on
  something not yet verified.
- **Change priorities when the strategist tells you to.** The call is
  where real priorities land. If the strategist says "they want to focus
  on pricing not AR," rewrite the 90-day section to lead with pricing.
- **Discuss what the client can handle internally.** Section 6 (Support
  Gaps) is editable — mark each gap as "client handles" or "needs CFO
  BD" based on what the strategist records from the call.
- **Present relevant CFO By Design fractional services.** Only
  recommend services the strategist's catalog says apply. Never invent
  offerings or pricing. If section 7 cannot be filled from the catalog,
  render "requires catalog" placeholder; don't guess.
- **Record what the client actually decided.** Use the
  `record_decision` and `record_service_selection` tools. Decisions
  flow into Email 04's next-steps block.
- **Stop at the button.** When the draft is ready, Solomon's final move
  is "Draft looks ready. If you agree, click Mark Reviewed, then
  Approve & Send." Solomon does NOT invoke a finalize tool. There is
  no finalize tool.

---

## 4. Tool-call surface

Each tool is a server endpoint the Ask Solomon client can invoke on
behalf of a conversation turn. All are password-gated (CONSOLE_PASSWORD).
All are scoped to one `contactId` per call. All are logged to the
session's `/asksolomon/history` row with a visible "wrote to field X"
line in the conversation transcript.

| Tool | Writes | Fires HL automation? |
|------|--------|----------------------|
| `generate_financial_request(contactId)` | `swot_financials_request_list` | No |
| `store_verified_financials(contactId, summary)` | `swot_verified_financials` | No |
| `generate_roadmap_draft(contactId)` | `swot_growth_plan_draft` (full 8-section render with "DRAFT · INTERNAL PREP ONLY" banner) | No |
| `update_roadmap_section(contactId, n, content)` | `swot_growth_plan_draft` (in place, section n only) | No |
| `record_decision(contactId, text)` | appends an entry to `swot_bga_decisions` (JSON array of `{at, text}`) | No |
| `record_service_selection(contactId, service_ids, bundle_id)` | `swot_bga_services_selected` | No |
| `preview_final_email(contactId)` | nothing — renders Email 04 locally against current draft + decisions + selections for the strategist to review | No |

**There is no `finalize_and_send` tool.** The LLM has no server endpoint
for applying `swot_growth_plan_ready` or writing `swot_growth_plan`.
Attempting to invoke one 404s because it isn't registered.

---

## 5. The button — the only path to delivery

**UI**: `[APPROVE & SEND TO CLIENT]` button in the case view.

**Preconditions** (all enforced server-side on the endpoint, not just UI):

1. Caller is authenticated with CONSOLE_PASSWORD.
2. `contactId` has `swot_paid_297` applied.
3. `swot_growth_plan_draft` field is populated and non-empty.
4. The request body includes `reviewed: true` — set when the strategist
   clicks the separate `[Mark Reviewed]` toggle in the console after
   reading the final draft.
5. `swot_growth_plan_ready` is NOT already present on the contact
   (idempotent refusal).

**UI flow**:

```
Strategist reviews final draft in the case view
         ↓
Clicks [Mark Reviewed]  ← sets a UI flag; swot_growth_plan_draft stays as-is
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
   headers: Authorization: Bearer <CONSOLE_PASSWORD>
   body: { contactId, reviewed: true }
```

**Server endpoint behavior** (`handleApproveAndSend` in `worker/src/index.js`):

Step order is intentional and the only correct sequence. Writes before
tag so the Email 04 merge fields are populated by the time the HL
workflow fires.

1. Verify password, `reviewed=true`, draft present, `swot_paid_297`
   present, `swot_growth_plan_ready` NOT present. Refuse (409) otherwise.
2. Render the final customer-facing Growth Plan HTML from the current
   `swot_growth_plan_draft` content (strip the "DRAFT · INTERNAL"
   banner; apply customer-facing styling).
3. Render the next-steps block from `swot_bga_decisions`.
4. Render the services selection summary from
   `swot_bga_services_selected`.
5. `updateGHLContact(contactId, [
     { key: "swot_growth_plan", field_value: <rendered plan> },
     { key: "swot_bga_next_steps", field_value: <rendered next steps> },
     { key: "swot_bga_services_selected_display",
       field_value: <rendered selections> }
   ])` — all three fields in one HL call so a partial write doesn't
   leave a mixed state.
6. ONLY if (5) returns ok, `addGHLTag(contactId,
   ["swot_growth_plan_ready"])`.
7. Return `{ success: true }` to the console.
8. If step (5) failed, do NOT apply the tag. Return `{ success: false,
   error: "writeback failed; tag not applied" }`. The strategist sees
   the error, nothing was sent, nothing partially fired.

**Idempotency**: a second click on the same contact finds
`swot_growth_plan_ready` already present and returns 409 with a message
"Already sent at <timestamp>. Not re-sending." No duplicate email.

---

## 6. HL field + tag inventory

### New fields to add in the HL custom field catalog

| Field | Type | Written by | Customer-facing? |
|-------|------|-----------|------------------|
| `swot_financials_request_list` | LARGE_TEXT | `generate_financial_request` tool | No — internal strategist use |
| `swot_verified_financials` | LARGE_TEXT | `store_verified_financials` tool (strategist pastes in via chat) | No — Solomon's input |
| `swot_growth_plan_draft` | LARGE_TEXT | `generate_roadmap_draft` + `update_roadmap_section` tools | No — internal prep |
| `swot_bga_decisions` | LARGE_TEXT (JSON array) | `record_decision` tool | No — Solomon's input to the final next-steps render |
| `swot_bga_services_selected` | LARGE_TEXT (JSON) | `record_service_selection` tool | No — Solomon's input to the final selection render |
| `swot_bga_next_steps` | LARGE_TEXT (rendered HTML) | **button endpoint only** | **Yes — merged into Email 04** |
| `swot_bga_services_selected_display` | LARGE_TEXT (rendered HTML) | **button endpoint only** | **Yes — merged into Email 04** |

### Existing fields unchanged

| Field | Role |
|-------|------|
| `swot_growth_plan` | **Button endpoint only.** Customer-facing final roadmap. Unchanged contract. |

### New tags to add

| Tag | Applied by | Purpose |
|-----|-----------|---------|
| `swot_growth_plan_drafted` | `generate_roadmap_draft` tool (optional, for HL dashboard visibility) | Signals "prep done; call-ready" |

### Existing tags unchanged

| Tag | Role |
|-----|------|
| `swot_growth_plan_ready` | **Button endpoint only.** Fires HL Email 04 workflow. Unchanged contract. |

---

## 7. Guardrails pinned in regression tests

Each of these is a test that must stay green on every PR.

1. `/asksolomon/case/*` tool endpoints never write `swot_growth_plan`
   and never apply `swot_growth_plan_ready`. One test per tool.
2. `generate_roadmap_draft` renders content with the "DRAFT · INTERNAL
   PREP ONLY · NOT FOR CUSTOMER DELIVERY" banner at the top.
3. `POST /asksolomon/case/approve-and-send` refuses without
   CONSOLE_PASSWORD → 401.
4. Approve-and-send refuses without `reviewed=true` → 400.
5. Approve-and-send refuses without `swot_growth_plan_draft` present →
   409 "no draft to send."
6. Approve-and-send refuses without `swot_paid_297` present → 403.
7. Approve-and-send refuses when `swot_growth_plan_ready` is already
   applied → 409 "already sent at <timestamp>."
8. Approve-and-send writes `swot_growth_plan` + `swot_bga_next_steps` +
   `swot_bga_services_selected_display` BEFORE applying the ready tag.
   Simulate a writeback failure and confirm the tag is NOT applied.
9. Approve-and-send is the ONLY code path in the Worker that writes
   `swot_growth_plan` or applies `swot_growth_plan_ready`.
   (Grep-based test: no other call site exists.)

---

## 8. What's needed from the strategist before launch

Solomon's job is drafting against the strategist's inputs. Four things
only the strategist can produce:

1. **The CFO By Design services catalog** — fractional services, their
   deliverables, pricing, eligibility rules, and bundle combinations.
   Lives wherever the strategist wants it (committed as
   `docs/services/catalog.md`, uploaded as an Ask Solomon library file,
   or kept as a GHL field — Solomon can read from any of these). Until
   this exists, section 7 of every draft renders the placeholder
   "Services catalog not yet loaded — complete this section manually
   from your prep notes."
2. **The verified financials summary** — the strategist's own words
   summarizing what the uploaded P&L / balance sheet / AR aging / tax
   returns actually show. Pasted into the chat; Solomon stores to
   `swot_verified_financials`.
3. **The Part 2 prompt + 8-section structure review.** The structure in
   this doc comes from the strategist's prior message. If anything
   should change, change it here before build so the prompt pins it.
4. **The call-time workflow.** The strategist tells Solomon mid-call
   what the client decides. Solomon records. If this workflow should
   look different — say Solomon reads from a transcript rather than the
   strategist dictating — pin that here before build.

---

## 9. Build order

Each row below is one PR, mergeable independently.

| PR | What it ships | Depends on |
|----|---------------|------------|
| **1** | New HL custom fields + tag added to the field catalog (`docs/BGA_COPILOT_SPEC.md` already governs the names). HL-side config, not code. | Nothing |
| **2** | Worker + console scaffolding: `/asksolomon/case/load` + case view UI (read-only — just assembles and displays the bundle). No tool calls yet. | PR 1 |
| **3** | `generate_financial_request` tool + its endpoint + guardrail test. | PR 2 |
| **4** | `store_verified_financials` tool + endpoint. | PR 2 |
| **5** | `generate_roadmap_draft` tool + endpoint + 8-section prompt + "DRAFT · INTERNAL" banner + regression tests. | PR 2 (uses catalog if present, placeholder otherwise) |
| **6** | `update_roadmap_section`, `record_decision`, `record_service_selection` tools + endpoints. | PR 5 |
| **7** | `preview_final_email` renderer (local, no fire). | PR 6 |
| **8** | **The button**: `[Mark Reviewed]` toggle + `[APPROVE & SEND TO CLIENT]` button + modal + `POST /asksolomon/case/approve-and-send` endpoint + all 9 regression tests from §7. | PR 7 |
| **9** | Email 04 template update (`04_deep_dive_part2.html`) to merge in `{{contact.swot_bga_next_steps}}` and `{{contact.swot_bga_services_selected_display}}` alongside the existing `{{contact.swot_growth_plan}}`. | PR 8 |

Each PR is small, mergeable, and leaves the system in a consistent
state. The dangerous one (PR 8) lands last and only after every other
piece is in and tested; the field writes and tag application cannot be
reached before PR 8 by anyone.

---

## 10. Change control

Updates to this document require:

1. The code paths they govern updated in the same PR (worker handler,
   tool endpoint, console UI, test file).
2. If a new tool is added that writes or signals state — update
   `docs/FUNNEL_TAXONOMY.md` HL triggers inventory to list the new
   write.
3. Any change that affects what the strategist sees or does must be
   reviewed by Miguel before merge.
4. Any change that touches the button endpoint's preconditions, write
   ordering, or guardrails must keep every §7 regression test green.
   The ready tag's single code path is a safety invariant, not a design
   detail.
