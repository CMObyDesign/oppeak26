# Funnel Taxonomy — Source of Truth

> **STATUS:** Authoritative. Changes to the funnel structure or the HL
> trigger contract require updating this file in the same PR as the code
> change.
>
> **OWNER:** CFO By Design (product) · Spark Agency (engineering).
>
> **COMPANION:** `docs/brand/PRODUCT_NAMING_AND_LADDER.md` governs product
> names and tier IDs. This file governs funnel paths, destinations, and
> the HL automation triggers that drive the flow.

---

## The five lanes

Five independent entry points. Lanes 1–3 all converge on lane 4 (BGA
fulfillment) once BGA access is granted. Lane 5 is independent.

```
1. SOLOMON
   Free Business Health Check → $47 Full Diagnostic → /upsell → standard $297 → /audit-confirmed

2. ACTION TAKER
   /deep-dive-preview → /deeper-analysis → $150 → /audit-confirmed

3. STANDALONE
   /deep-dive-sales/ → PAYMENT_LINK_297 → /audit-confirmed

4. BGA FULFILLMENT (shared sink for lanes 1–3)
   /audit-confirmed
     → /bga-intake
     → GET /verify-bga-access (requires swot_paid_297)
     → BGA_INTAKE_SURVEY_URL (embedded iframe)
     → financials upload
     → team builds + delivers BGA
     → delivery email
     → /report/<contactId>
     → BOOKING_LINK_297

5. MARKETING AUDIT (independent, Spark-branded)
   /marketing?url=<domain>
     → /marketing/render
     → AUDIT_BOOKING_URL
```

**Special case** (not a lane — a one-off bypass path):
```
SOLOMON50 BETA ONLY
/mid-analysis = $47 payment bypass for authorized beta users
```
`/mid-analysis` is **NOT** the "declines $297 OTO" fallback. It is
specifically the SOLOMON50 beta coupon-bypass survey landing: HL
payment links require a card even at 100% off, so beta users with the
coupon applied are routed around the Stripe gate to this URL via
`UPGRADE_47_URL` in `wrangler.toml`.

---

## Lane 1 — SOLOMON

The main Free → $47 → optional $297 funnel.

| Step | Destination | Purpose |
|------|-------------|---------|
| 1 | HL page embedding `https://oppeak26.pages.dev` via iframe | Business Health Check entry (opt-in capture) |
| 2 | React app on `/` or `/beta` | Free assessment flow |
| 3 | Inline inside `Index.tsx` screen state (`landing → assessment → analyzing → results`) | **Free results — NOT a URL.** Rendered in the same iframe as the entry. |
| 4 | `PAYMENT_LINK_47` | $47 Full Diagnostic payment (Stripe via LC Payments) |
| 5 | `/upsell?contactId=...` (`Upsell.tsx`) | Post-$47 $297 OTO offer |
| 6A | $47 fulfillment path — $297 declined inside `/upsell` | Lands on `/paid-47` (paid_47 results) · delivery email with `{{contact.swot_report_path}}` |
| 6B | `PAYMENT_LINK_297` | $297 payment (acceptance of OTO) |
| 7 | `/audit-confirmed?session_id=...&contactId=...` (`AuditConfirmed.tsx`) | Post-$297 Stripe redirect landing |
| 8 | → joins Lane 4 (BGA FULFILLMENT) | |

**Important:** No React route exists at `/results`. The paid-tier result
pages are `/paid-47` (`PaidTier47.tsx`) and `/paid-297`
(`PaidTier297.tsx`). The deep-link report viewer used by every delivery
email is `/report/<contactId>` on the Worker.

---

## Lane 2 — ACTION TAKER ($150)

The $150 immediate-action strategy. Sells access to the SAME BGA
product at an alternate price point.

| Step | Destination | Wrapper source |
|------|-------------|----------------|
| 1 | `/deep-dive-preview` | `deep-dive-preview-wrapper.html` |
| 2 | `/deeper-analysis` | `deeper-analysis-wrapper.html` |
| 3 | $150 Action Taker payment (LC Payments or coupon) | — |
| 4 | → `/audit-confirmed` → joins Lane 4 | — |

**`/deeper-analysis` is NOT replaced by `/bga-intake`.** They are
different pages serving different jobs:

- `/deeper-analysis` = sells / processes the Action Taker $150 purchase.
- `/bga-intake` = fulfills the BGA AFTER access is granted.

**Required launch check:** The successful $150 payment MUST result in
the `swot_paid_297` tag being applied to the contact, since
`/verify-bga-access` only accepts that exact tag. See Launch Checks §5.

---

## Lane 3 — STANDALONE BGA

Direct $297 BGA acquisition path, separate from Solomon and the Action
Taker funnel.

| Step | Destination | Wrangler var |
|------|-------------|--------------|
| 1 | `deepdive.cfobydesign.com/deep-dive-sales/` (static page in `app/public/deep-dive-sales/`) | `DEEP_DIVE_SALES_URL` |
| 2 | `PAYMENT_LINK_297` | — |
| 3 | → `/audit-confirmed` → joins Lane 4 | — |

**`deepdive.cfobydesign.com/deep-dive-sales/` is NOT the same thing as
`/deeper-analysis`.** The former is the standalone $297 sales page; the
latter is the Action Taker $150 funnel. Both eventually sell access to
the same BGA fulfillment, but they are not interchangeable paths.

---

## Lane 4 — BGA FULFILLMENT (shared sink)

After any of lanes 1–3 completes successfully, the buyer enters this
shared fulfillment flow.

```
/audit-confirmed
   ↓
/bga-intake?contactId=<id>
   ↓
GET /verify-bga-access?contactId=<id>  (requires swot_paid_297)
   ↓ 200 { authorized: true, surveyUrl }
BGA_INTAKE_SURVEY_URL (iframe, contactId prefilled)
   ↓ survey submit (GHL post-submit workflow applies swot_bga_intake_complete)
financials upload (trigger link applies swot_financials_uploaded)
   ↓
CFO By Design team builds + delivers BGA (Miguel manual)
   ↓ Miguel applies swot_growth_plan_ready
delivery email (Email 04) with button → {{contact.swot_report_path}} = /report/<contactId>
   ↓
50-minute BGA session → BOOKING_LINK_297
```

Key integration points:

- **Access gate**: `/verify-bga-access` on the Worker (see
  `worker/src/index.js` → `handleVerifyBgaAccess`). Requires the exact
  tag `swot_paid_297`. Fail-closed: returns 403 (not 404) on unknown or
  unpaid contacts to avoid existence enumeration; 503 on upstream
  failure.
- **Survey URL**: `BGA_INTAKE_SURVEY_URL` is a Worker env var, never in
  HTML view-source. Handed to the wrapper only in a successful
  authorization response body.
- **Post-paid race protection**: Wrapper retries 403/503 twice
  (1500ms, 3000ms) to cover the gap between Stripe redirect and
  `/payment-status` applying `swot_paid_297` via `ctx.waitUntil`.
- **Report viewer**: `/report/<contactId>` on the Worker is tier-aware
  and renders whichever report field the contact has populated
  (`business_playbook` > `swot_full_report` > `swot_free_report`).

---

## Lane 5 — MARKETING AUDIT

Spark Agency's branded instant marketing audit by domain URL. Fully
independent — does NOT feed BGA fulfillment and does NOT share any of
the paid funnel plumbing.

| Step | Destination | Env var |
|------|-------------|---------|
| 1 | `GET /marketing?url=<domain>&mode=<public\|internal>` on `swot-engine.cfobydesign.workers.dev` (also aliased at `/audit`) | — |
| 2 | `GET /marketing/render?url=<domain>&mode=<mode>` | — |
| 3 | 30-minute consult CTA → `AUDIT_BOOKING_URL` | `AUDIT_BOOKING_URL` (separate from `BOOKING_LINK_47`) |
| 4 | Delivery email (manual, review-gated) | — |

**Do NOT connect this lane to:**
- `PAYMENT_LINK_47` / `PAYMENT_LINK_297`
- `/bga-intake`
- `BOOKING_LINK_47` / `BOOKING_LINK_297`

Delivery email: `email-templates/05_marketing_audit.html` — currently
**review-gated**, workflow should stay disabled in HL until Spark
confirms the add-on is active. Fires on manual `swot_marketing_audit_ready`
tag.

Social preview image: `AUDIT_OG_IMAGE_URL` (currently a placeholder in
`wrangler.toml:20` — swap to the real HL media URL once uploaded).

---

## Wrangler variables, organized by lane

### Solomon / $47
```
PAYMENT_LINK_47     https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641
BOOKING_LINK_47     https://my.cfobydesign.com/widget/booking/D3yNZNFtqIYsChkOgQc9
UPGRADE_47_URL      https://success.cfobydesign.com/mid-analysis  (SOLOMON50 beta bypass)
```

### Standard $297 BGA
```
PAYMENT_LINK_297    https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0
BOOKING_LINK_297    https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh
```

### BGA fulfillment
```
BGA_INTAKE_SURVEY_URL   dashboard-only (keep_vars = true preserves it across deploys)
BGA_INTAKE_ORIGIN       optional override; defaults to https://success.cfobydesign.com
```

### Standalone BGA sales page
```
DEEP_DIVE_SALES_URL     https://deepdive.cfobydesign.com/deep-dive-sales/
```

### Marketing Audit
```
AUDIT_BOOKING_URL       https://my.cfobydesign.com/widget/bookings/cfobd-consult
AUDIT_OG_IMAGE_URL      (placeholder — see wrangler.toml:20)
```

### Secrets (Cloudflare dashboard, not committed)
```
GHL_API_KEY             GHL v2 API bearer
ANTHROPIC_API_KEY       Claude API
CONSOLE_PASSWORD        Dev console gate
WEBHOOK_SECRET          /from-ghl-survey + /payment-status bearer
```

---

## Complete HL triggers inventory

Every tag the system reads or writes, grouped by purpose. "Applied by"
names where the tag originates. "Fires" names what HL automation should
trigger on it.

### Payment / entitlement tags

| Tag | Applied by | Fires |
|-----|-----------|-------|
| `swot_paid_47` | LC Payments on $47 success → HL workflow adds tag · Worker safety-net via `POST /payment-status` | Grants `/paid-47` access · Gates `swot_report_ready_paid_47` email · Unlocks $297 OTO funnel entry |
| `swot_paid_297` | LC Payments on $297 OR $150 Action Taker success → HL workflow adds tag · Worker safety-net via `POST /payment-status` · **REQUIRED by `/verify-bga-access`** | Grants `/bga-intake` access · Gates `swot_report_ready_paid_297` email · Shows BGA sections on `/report/<id>` |
| `swot_paid_297_pending` | Worker during paid_297 writeback when `swot_paid_297` not yet present | Gates HL delivery workflow: wait for both `swot_paid_297` AND `swot_playbook_written` before firing Email 03 |
| `swot_solomon50_applied` | Worker `POST /apply-solomon50` on beta coupon redemption | Parallel entitlement to `swot_paid_47` (coupon bypass); unlocks paid_47 report rendering |
| `swot_payment_failed_47` | Worker `POST /payment-status` on $47 failure (after writing `swot_retry_payment_url`) | Fires Email 07 (`07_payment_failed_retry.html`) |
| `swot_payment_failed_297` | Worker `POST /payment-status` on $297 failure (after writing `swot_retry_payment_url`) | Fires Email 15 (`15_bga_payment_failed.html`) |

### Report-ready delivery triggers (fire HL email workflows)

| Tag | Applied by | Fires |
|-----|-----------|-------|
| `swot_report_ready_free` | Worker after free-tier writeback OK | Email 01 (`01_free_report_delivery.html`) · 24h/72h follow-ups 08 + 12 if `swot_paid_47` not applied |
| `swot_report_ready_paid_47` | **HL workflow (NOT the Worker)** — the public POST endpoint intentionally refuses to apply this to prevent any contactId-aware caller from re-firing the delivery email | Email 02 (`02_partial_swot_delivery.html`) · 1d/3d follow-up Email 13 if 30-min consult not booked |
| `swot_report_ready_paid_297` | Worker only when BOTH `swot_paid_297` AND `swot_playbook_written` present; otherwise HL workflow applies it after both tags land | Email 03 (`03_deep_dive_part1.html`) · 1d/3d follow-ups 14 if `swot_financials_uploaded` not applied |
| `swot_growth_plan_ready` | **Manual by Miguel** after preparing Part 2 | Email 04 (`04_deep_dive_part2.html`) — Business Growth Plan delivery |
| `swot_marketing_audit_ready` | **Manual by Spark** after approving the audit | Email 05 (`05_marketing_audit.html`) — review-gated, keep workflow disabled until Spark confirms the add-on is active |

### Lifecycle signal tags

| Tag | Applied by | Fires |
|-----|-----------|-------|
| `swot_free_lead` | Worker on free assessment submit (lifecycle tag batch) | Opt-in confirmation workflows · free-tier nurture segmentation |
| `swot_playbook_written` | Worker after paid_297 writeback success | Signal to HL that `business_playbook` custom field has content; gates `swot_report_ready_paid_297` |
| `swot_bga_intake_complete` | GHL survey post-submit workflow on the BGA intake survey | Stops intake-pickup reminder sequence (prevents Emails 10 + 11) |
| `swot_financials_uploaded` | GHL trigger-link workflow when financials files land in HL file storage | Fires Email 06 (`06_financials_upload_received.html`) · stops Email 14 reminders |

### Path classification tags (dual-emitted via `pathTags()`)

See `worker/src/index.js` → `pathTags()` and the integration contract
in `docs/brand/PRODUCT_NAMING_AND_LADDER.md` Decision 1.

| Canonical tag | Legacy compat tag emitted alongside | Source classification |
|---|---|---|
| `swot_path_rehab` | — | `rehab` |
| `swot_path_needs-attention` | `swot_path_urgent` | `needs-attention` |
| `swot_path_growth` | — | `growth` |

`swot_path_strong` is historical only (pre-v3 rubric) and no longer
emitted. Any HL automation still bound to `swot_path_strong` should be
migrated to `swot_path_growth`.

### Opportunity flags (dynamic LLM output)

Tags ending in `_opp` — written to the contact for finding-specific HL
automations. The suffix `_opp` is reserved for this purpose. Example
flags: `MERCHANT_PROCESSING_OPP`, `DIGITAL_PRESENCE_OPP` (currently
filtered out of applied tags).

The `/reset-contact-tags` endpoint strips any tag matching
`TAG_SUFFIXES_TO_RESET = ["_opp"]`.

### Internal / testing tags

Should NOT drive customer workflows. If HL has automations bound to
these, they are for dev/testing visibility only.

| Tag | Applied by | Purpose |
|-----|-----------|---------|
| `swot_console_test` | Worker `/console-test` endpoint | Distinguishes dev/console-triggered runs |
| `swot_console_manual_send` | Worker `/console-manual-send` endpoint | Distinguishes manual-send-tool-triggered runs |

---

## Custom fields written by the Worker

| Field | Written by | Used by |
|-------|-----------|---------|
| `swot_free_report` / `swot_full_report` / `business_playbook` | Worker writeback (one per tier) | `/report/<id>` renderer · delivery email body merge |
| `swot_email_blurb` | Worker writeback | Delivery email opener (`{{contact.swot_email_blurb}}`) |
| `swot_strategist_brief` | Worker writeback | **INTERNAL ONLY** — never merged into customer emails |
| `swot_report_path` | Worker writeback (`${origin}/report/<id>`) | `{{contact.swot_report_path}}` in every delivery email's "View Online" button |
| `swot_retry_payment_url` | Worker writeback on payment failure (BEFORE applying failure tag, so email button always has an href) | `{{contact.swot_retry_payment_url}}` in Emails 07 + 15 |
| `swot_growth_plan` | **Manual by Miguel** | Email 04 Part 2 body |
| `swot_marketing_audit` | **Manual by Spark** | Email 05 body |
| `swot_path` | Worker writeback (classification string) | HL segmentation |
| `swot_rehab_flag` | Worker writeback (`"true"` / `"false"`) | Rehab-cohort HL automations |
| `swot_deep_dive_booked` | Worker writeback on paid_297 (`"true"`) | — |
| `swot_297_score` / `swot_last_event_type` / `swot_internal_notes` | Worker lifecycle writes | Internal segmentation |

---

## Required HL launch checks

Before opening the funnel to real buyers, confirm each of these in HL.

### 1. $47 LC Payments → `swot_paid_47` applied

Open any contact who completed a $47 purchase recently. Confirm
`swot_paid_47` is on their tags list. If missing, locate the HL
workflow that fires on the $47 Order Submitted event and verify its
"Add Contact Tag" action is set to `swot_paid_47`.

### 2. $150 Action Taker success → `swot_paid_297` applied

**This is the critical gap in the current five-lane plumbing.** The
Action Taker lane depends on this tag to grant BGA fulfillment access,
and no other tag is accepted by `/verify-bga-access`. Confirm by
inspecting any Action Taker contact (if one exists) or by reviewing the
HL workflow bound to the $150 LC Payments / coupon success event.

If the workflow currently applies a different tag (e.g.
`swot_action_taker`, `swot_paid_150`), update it to `swot_paid_297`
instead. The $150 price is simply alternate pricing for the SAME BGA
product — not a different fulfillment track.

### 3. $297 LC Payments → `swot_paid_297` applied

Same pattern as #1 but for $297. Confirm an HL workflow applies
`swot_paid_297` after the $297 Order Submitted event.

### 4. `swot_report_ready_paid_47` applied by an HL workflow

The Worker intentionally does NOT apply this tag from the public POST
endpoint (security policy — would let any contactId-aware caller
re-fire the delivery email). Confirm there is an HL workflow that
applies `swot_report_ready_paid_47` after:
- `swot_paid_47` is present AND
- the Worker's writeback has completed (one signal: the
  `swot_full_report` custom field is non-empty).

### 5. BGA intake survey post-submit → `swot_bga_intake_complete`

In HL funnel builder, open the BGA intake survey (the one at
`BGA_INTAKE_SURVEY_URL`). Confirm its post-submit workflow applies
`swot_bga_intake_complete` to the submitter. Without this, Emails 10
and 11 will keep firing on buyers who have already completed intake.

### 6. Financials upload trigger-link → `swot_financials_uploaded`

The financials-upload trigger link (referenced by `{{trigger_link.tD3BJjCv167YbZChSObD}}`
in `email-templates/09_deep_dive_intake_pickup_1.html`) must apply
`swot_financials_uploaded` on completion. Otherwise Email 06 (upload
received confirmation) won't fire and Email 14 reminders will continue
firing on buyers who have already uploaded.

### 7. Email 05 Marketing Audit workflow DISABLED

Per the review-gate note at the top of `email-templates/05_marketing_audit.html`,
the delivery workflow bound to `swot_marketing_audit_ready` should
stay disabled until Spark confirms the Marketing Audit add-on is
active.

---

## Change control

Updating this document requires:

1. A diff to the corresponding code path or HL workflow in the same PR
   (worker handler, email template, `/verify-bga-access` tag constant,
   `wrangler.toml` env var, etc.).
2. If a new tag or trigger is added: update the HL triggers inventory
   above AND add an entry to Required HL launch checks AND confirm the
   HL workflow is configured BEFORE merging.
3. Technical identifiers listed in
   `docs/brand/PRODUCT_NAMING_AND_LADDER.md` are stable and MUST NOT be
   renamed as part of a taxonomy update. Customer-facing labels follow
   that doc; integration contracts follow this one.
