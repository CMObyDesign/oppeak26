# BGA Copilot — HighLevel setup checklist (PR 1 of the build)

> **STATUS:** HL-side configuration checklist. No code changes in this
> doc; it is the step-by-step for whoever manages the HL dashboard
> (Miguel / Spark ops) to create the custom fields and tag the BGA
> Copilot build depends on.
>
> **COMPANION:** `docs/BGA_COPILOT_SPEC.md` governs what each field is
> for and when it gets written. This doc governs how they get created.
>
> **ORDER:** This is PR 1 in the spec's §9 build order. Nothing else in
> the build can land until the fields exist in HL and their field IDs
> are captured.

---

## 1. Create eleven custom fields in HighLevel

**Where:** HighLevel dashboard → **Settings** → **Custom Fields** →
**Add Field** (for each of the eleven below).

**Common settings for every new field:**

| Setting | Value |
|---------|-------|
| **Object** | **Contact** · This is critical. HL's custom-field setup flow starts with an object selector (Contact / Opportunity / etc.). Pick **Contact**. Fields created on Opportunity or any other object are NOT returned by `/contacts/{id}`, NOT writable through the Worker's `updateGHLContact` path, and NOT available via the `{{contact.*}}` merge fields the delivery emails use. (Codex P2 on PR #89.) |
| Field Type | **LARGE TEXT** (also called "Multiline Text") |
| Placement on contact profile | Group under a new or existing group called **"BGA / Solomon"** so these stay together and don't clutter the main contact view |
| Visible on public forms? | **No** — never attach these to opt-in / lead-capture forms |
| Visible on contact profile? | Yes (strategist-facing) |
| Default value | Leave empty |

**The eleven fields to create** (seven originally in PR #89, plus
four added by the spec revision for the full strategist toolkit —
see `docs/BGA_COPILOT_SPEC.md` §6). The first seven already exist
if PR #89 was completed; verify them against the Contact-object
requirement and the key names, then create the four new ones (§1.8
onward).

### 1.1 `swot_financials_request_list`

- **Internal name / Field key**: `swot_financials_request_list`
- **Display label**: "BGA — Financials Request List (internal)"
- **Written by**: `generate_financial_request` tool via Ask Solomon
- **Customer-facing?** **No.** Never merged into customer emails.
- **Purpose**: Prioritized list of financial artifacts the strategist
  should ask the client for, specific to this case.

### 1.2 `swot_verified_financials`

- **Internal name / Field key**: `swot_verified_financials`
- **Display label**: "BGA — Verified Financials Summary (internal)"
- **Written by**: Strategist pastes it in via Ask Solomon chat; the
  `store_verified_financials` tool stores it to this field.
- **Customer-facing?** **No.** Never merged into customer emails.
- **Purpose**: The strategist's own words summarizing what the uploaded
  P&L / balance sheet / AR aging actually show. Input to the DRAFT
  roadmap pass.

### 1.3 `swot_growth_plan_draft`

- **Internal name / Field key**: `swot_growth_plan_draft`
- **Display label**: "BGA — Growth Plan Draft (internal)"
- **Written by**: `generate_roadmap_draft` + `update_roadmap_section`
  tools via Ask Solomon.
- **Customer-facing?** **No.** Carries a "DRAFT · INTERNAL PREP ONLY ·
  NOT FOR CUSTOMER DELIVERY" banner. Never merged into customer emails.
- **Purpose**: The 8-section pre-call prep roadmap the strategist
  reads before the BGA session.

### 1.4 `swot_bga_decisions`

- **Internal name / Field key**: `swot_bga_decisions`
- **Display label**: "BGA — Call Decisions Log (internal)"
- **Written by**: `record_decision` tool via Ask Solomon during the
  call.
- **Customer-facing?** **No** — but its contents are rendered into the
  customer-facing `swot_bga_next_steps` field at approve-and-send time.
- **Purpose**: JSON array of structured decisions the client makes
  during the live BGA session. Input to the next-steps render.

### 1.5 `swot_bga_services_selected`

- **Internal name / Field key**: `swot_bga_services_selected`
- **Display label**: "BGA — Services Selected (internal)"
- **Written by**: `record_service_selection` tool via Ask Solomon
  during the call.
- **Customer-facing?** **No** — contents are rendered into the
  customer-facing `swot_bga_services_selected_display` field at
  approve-and-send time.
- **Purpose**: JSON record of which CFO By Design fractional services /
  bundle the client committed to on the call.

### 1.6 `swot_bga_next_steps`

- **Internal name / Field key**: `swot_bga_next_steps`
- **Display label**: "BGA — Next Steps (customer email block)"
- **Written by**: **The APPROVE & SEND TO CLIENT button only.** This
  is a safety-critical write — no tool and no other code path writes
  this field.
- **Customer-facing?** **YES.** Merged into Email 04 via
  `{{contact.swot_bga_next_steps}}`.
- **Purpose**: Rendered HTML next-steps block, built from
  `swot_bga_decisions` at approve-and-send time.

### 1.7 `swot_bga_services_selected_display`

- **Internal name / Field key**: `swot_bga_services_selected_display`
- **Display label**: "BGA — Services Selected (customer email block)"
- **Written by**: **The APPROVE & SEND TO CLIENT button only.** Same
  safety profile as `swot_bga_next_steps`.
- **Customer-facing?** **YES.** Merged into Email 04 via
  `{{contact.swot_bga_services_selected_display}}`.
- **Purpose**: Rendered HTML service-selection summary, built from
  `swot_bga_services_selected` at approve-and-send time.

### 1.8 `swot_bga_prep_brief` (added by spec revision)

- **Internal name / Field key**: `swot_bga_prep_brief`
- **Display label**: "BGA — Pre-Call Prep Brief (internal)"
- **Written by**: `generate_prep_brief` tool via Ask Solomon
  (triggered by the `[ PREP ME FOR THE CALL ]` button in the console)
- **Customer-facing?** **No.** Internal strategist prep sheet, never
  merged into customer emails.
- **Purpose**: One-screen condensed briefing drawn from the Draft
  Roadmap. Top 3 priorities, verified-fact support, assumptions
  needing validation, questions to ask, 90-day preview, likely
  objections, services worth discussing and services to avoid, and
  the decisions the call needs to produce.

### 1.9 `swot_bga_red_team_report` (added by spec revision)

- **Internal name / Field key**: `swot_bga_red_team_report`
- **Display label**: "BGA — Pre-Send QA Report (internal)"
- **Written by**: `red_team_check` tool via Ask Solomon (triggered by
  the `[ RUN PRE-SEND QA ]` button)
- **Customer-facing?** **No.** Internal gate for the APPROVE & SEND
  button. Never merged into customer emails.
- **Purpose**: Structured JSON record of blockers and warnings found
  in the current draft. The APPROVE & SEND button is disabled unless
  the latest report has 0 blockers; warnings require explicit
  strategist acknowledgment before send. See
  `docs/BGA_COPILOT_SPEC.md` §5.3 for the blocker/warning rules.

### 1.10 `swot_bga_version_history` (added by spec revision)

- **Internal name / Field key**: `swot_bga_version_history`
- **Display label**: "BGA — Version History (audit trail)"
- **Written by**: **Every BGA tool call appends an entry.** The field
  is append-only from the Worker's side; strategist does not edit
  manually.
- **Customer-facing?** **No.** Internal audit trail. Never merged
  into customer emails.
- **Purpose**: JSON array of `{at, actor, action, affected_field,
  snapshot_hash, catalog_ref}` entries. Capped at ~50 entries per
  contact; older entries spill over to R2 under
  `bga_audit/<contact_id>/<yyyy-mm>.json`. See
  `docs/BGA_COPILOT_SPEC.md` §8 for the full audit-trail design.

### 1.11 `swot_bga_services_catalog_ref` (added by spec revision)

- **Internal name / Field key**: `swot_bga_services_catalog_ref`
- **Display label**: "BGA — Services Catalog Version (audit trail)"
- **Written by**: `generate_roadmap_draft` + `match_services` tools
  via Ask Solomon
- **Customer-facing?** **No.** Internal audit metadata. Never merged
  into customer emails.
- **Purpose**: Plain-text snapshot of which services catalog version
  (git commit SHA of `worker/data/service_catalog.json`) the draft
  was built against. Lets a later dispute or review trace the
  recommendations back to the exact catalog entries that were in
  effect at draft time.

---

## 2. Create one new tag in HighLevel

**Where:** HighLevel dashboard → **Settings** → **Tags** → **Add Tag**
(or let it auto-create the first time it's applied — but adding it
explicitly up front keeps the tag list tidy).

### 2.1 `swot_growth_plan_drafted`

- **Tag name**: `swot_growth_plan_drafted` (exact spelling,
  lowercase, underscores)
- **Applied by**: `generate_roadmap_draft` tool via Ask Solomon
- **Purpose**: Internal visibility signal that the pre-call prep draft
  exists for this contact. Does NOT fire any customer-facing workflow.
- **Workflows to attach**: optional. Useful as a dashboard filter
  ("show me contacts with `swot_paid_297` where
  `swot_growth_plan_drafted` is NOT present and it's been >48h since
  purchase" — surfaces overdue drafts).

### Existing tags unchanged (no action needed)

| Tag | Status |
|-----|--------|
| `swot_growth_plan_ready` | **Keep as-is.** Already in HL. Fires HL Email 04 delivery workflow on apply. The APPROVE & SEND TO CLIENT button is the only code path that applies this tag. |

---

## 3. Capture the HL field IDs for the Worker

Once the seven fields exist in HL, each one has a GHL-assigned field
ID that the Worker needs to read specific stored content back.

**For each new field, retrieve its field ID**:

1. In HighLevel, open the custom field.
2. The field ID appears in the URL or in the field's "copy ID" button
   (varies by HL UI version). It's a ~20-character alphanumeric string.
3. Record it in a plain list — one line per field, format:
   `<field_key>: <field_id>`

**Example of what to record** (field IDs are placeholders here — fill
in the real ones from your HL dashboard):

```
swot_financials_request_list:        <paste field ID>
swot_verified_financials:            <paste field ID>
swot_growth_plan_draft:              <paste field ID>
swot_bga_decisions:                  <paste field ID>
swot_bga_services_selected:          <paste field ID>
swot_bga_next_steps:                 <paste field ID>
swot_bga_services_selected_display:  <paste field ID>
swot_bga_prep_brief:                 <paste field ID>
swot_bga_red_team_report:            <paste field ID>
swot_bga_version_history:            <paste field ID>
swot_bga_services_catalog_ref:       <paste field ID>
```

Paste that list into the PR comment on the follow-up code PR (PR 2 of
the build, Worker scaffolding) and I'll add them to
`CONFIG.REPORT_FIELD_IDS` in `worker/src/index.js`.

**Why we need the IDs**: GHL's v2 contact GET endpoint returns custom
fields keyed by ID, not by the human-readable field key. The Worker's
read path (`handleReportStatus`, `/report/<contactId>`, the Case Load
bundler) matches on ID first and falls back to key. Writing works with
the key alone; reading is more reliable with the ID. See
`worker/src/index.js:91-95` for the existing
`REPORT_FIELD_IDS` entries this list will join.

---

## 4. What NOT to do during setup

Four things to double-check before saving each field:

- **Do NOT** create any of the eleven fields on an object other than
  **Contact**. If HL's object selector is set to Opportunity or
  anything else at creation time, the field lives on the wrong
  record type and is unreachable by the Worker, the delivery emails,
  and `{{contact.*}}` merge fields. Always confirm "Contact" is
  selected before saving.
- **Do NOT** attach any of the eleven fields to a public lead-capture
  form. They are strategist-facing only. If one accidentally lands on
  an opt-in form, clients could see or submit values into it.
- **Do NOT** rename any field key (the strings in §1 above). The
  Worker code reads and writes these fields by exact key match.
  Renaming the display label is fine; renaming the internal key
  breaks the integration.
- **Do NOT** apply `swot_growth_plan_drafted` or `swot_growth_plan_ready`
  manually from the HL UI during normal operation. Both tags should
  originate only from the Worker's code paths. Manual application in
  HL would skip the guardrails that keep draft and final content
  from getting mixed up.

---

## 5. Checklist to confirm HL field setup is done

Tick each line before announcing HL config complete:

- [ ] All eleven fields were created with **Object = Contact** at the
      HL object selector (not Opportunity or any other object)
- [ ] `swot_financials_request_list` field created (LARGE_TEXT)
- [ ] `swot_verified_financials` field created (LARGE_TEXT)
- [ ] `swot_growth_plan_draft` field created (LARGE_TEXT)
- [ ] `swot_bga_decisions` field created (LARGE_TEXT)
- [ ] `swot_bga_services_selected` field created (LARGE_TEXT)
- [ ] `swot_bga_next_steps` field created (LARGE_TEXT)
- [ ] `swot_bga_services_selected_display` field created (LARGE_TEXT)
- [ ] `swot_bga_prep_brief` field created (LARGE_TEXT)
- [ ] `swot_bga_red_team_report` field created (LARGE_TEXT)
- [ ] `swot_bga_version_history` field created (LARGE_TEXT)
- [ ] `swot_bga_services_catalog_ref` field created (LARGE_TEXT)
- [ ] All eleven fields grouped under a "BGA / Solomon" section on
      the contact profile
- [ ] None of the eleven fields attached to any public form
- [ ] `swot_growth_plan_drafted` tag added to the HL Tags list
- [ ] HL field IDs captured for all eleven fields and pasted into
      the follow-up build PR conversation (goes into the Worker's
      `CONFIG.REPORT_FIELD_IDS` once the Worker PRs begin)

Once every box above is ticked, the Worker + console scaffolding
build PRs (see `docs/BGA_COPILOT_SPEC.md` §11) can begin. Nothing
else in the BGA Copilot build can proceed until this HL config is
in place.

---

## 6. Change control

Updates to this checklist require:

1. A matching diff to `docs/BGA_COPILOT_SPEC.md` §6 (HL field + tag
   inventory). The spec is the source of truth for which fields exist
   and what writes them; this checklist is the how-to for creating
   them.
2. If a new field is added to the spec, add it here with the same
   LARGE_TEXT / internal-vs-customer-facing profile and tick-box
   format.
3. If a field is removed from the spec, add a "remove this field from
   HL" line here — don't leave orphans in the HL field catalog.
